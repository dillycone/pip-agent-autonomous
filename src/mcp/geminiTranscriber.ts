import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import mime from "mime";
import { cleanupTempDir } from "../utils/cleanup.js";
import { sanitizeError } from "../utils/sanitize.js";
import { mcpError } from "../utils/safe-stringify.js";
import { mcpSuccess } from "../utils/mcp-helpers.js";
import { AudioValidationError, TranscriptionError, ConfigurationError } from "../errors/index.js";
import { createChildLogger } from "../utils/logger.js";
import { validateFilePath } from "../utils/validation.js";
import { validateAudioFile, probeDuration } from "../transcription/audioValidation.js";
import { splitAudio, runWithConcurrency, type ChunkInfo } from "../transcription/chunker.js";
import { formatBytes } from "../transcription/utils.js";
import { transcribeChunk } from "../transcription/geminiChunkTranscriber.js";
import {
  GEMINI_API_KEY,
  MODELS,
  GEMINI_CHUNK_SECONDS,
  GEMINI_SINGLE_PASS_MAX,
  GEMINI_TRANSCRIBE_CONCURRENCY,
  GEMINI_TRANSCRIBE_RETRIES,
  ALLOWED_AUDIO_EXTENSIONS,
  GEMINI_INPUT_MODE,
  S3_PROFILE,
  S3_BUCKET,
  S3_PREFIX,
  S3_PRESIGN_TTL_SECONDS,
  S3_DELETE_AFTER
} from "../config.js";
import {
  IGeminiService,
  IFileSystemService,
  createGeminiService,
  createFileSystemService,
  IS3Service,
  createS3Service
} from "../services/index.js";

const logger = createChildLogger("gemini-transcriber");

/** Safe logging wrapper: avoids worker crashes if pretty transports fail. */
function safeLog(level: "info" | "warn" | "error", data: Record<string, unknown>, message: string): void {
  try {
    logger[level](data, message);
  } catch {
    console.log(`[${level}] ${message}`, data);
  }
}

// Singletons (created once per worker)
const fsService: IFileSystemService = createFileSystemService();
let geminiService: IGeminiService | null = null;
let s3Service: IS3Service | null = null;

function getGeminiService(): IGeminiService {
  if (!GEMINI_API_KEY) throw new ConfigurationError("Missing GEMINI_API_KEY");
  if (!geminiService) geminiService = createGeminiService(GEMINI_API_KEY);
  return geminiService;
}
function getS3Service(): IS3Service {
  if (!s3Service) s3Service = createS3Service(S3_PROFILE);
  return s3Service;
}

const MAX_AUDIO_FILE_BYTES = 200 * 1024 * 1024; // 200MB hard cap
const MAX_CHUNKS_PER_CALL = 1; // Stream-friendly: process one chunk per MCP call

function buildSuccess(
  transcript: string,
  segments: Array<{ start: string | null; end: string | null; speaker: string; text: string }>,
  nextChunk: number | null,
  info?: { totalChunks?: number; processedChunks?: number; startChunk?: number }
) {
  const payload: Record<string, unknown> = {
    transcript: transcript.trim(),
    segments
  };
  if (nextChunk !== null && Number.isFinite(nextChunk)) payload.nextChunk = nextChunk;
  if (info?.totalChunks !== undefined) payload.totalChunks = info.totalChunks;
  if (info?.processedChunks !== undefined) payload.processedChunks = info.processedChunks;
  if (info?.startChunk !== undefined) payload.startChunk = info.startChunk;
  return mcpSuccess(payload);
}

// We use the Google Gen AI SDK (@google/genai). Ensure GEMINI_API_KEY is set.
export const geminiTranscriber = createSdkMcpServer({
  name: "gemini-transcriber",
  version: "0.1.0",
  tools: [
    tool(
      "transcribe_audio",
      "Transcribe an audio file with Gemini 2.5 Pro; returns JSON with transcript and segments.",
      {
        audioPath: z.string().describe("Path to audio file (.mp3, .wav, .flac, etc.)"),
        inputLanguage: z.string().default("auto").describe("Audio language hint, e.g., 'en-US', 'es-ES', or 'auto'"),
        outputLanguage: z.string().default("en").describe("Transcript target language, e.g., 'en', 'fr'"),
        diarize: z.boolean().default(true),
        timestamps: z.boolean().default(true),
        startChunk: z.number().int().min(0).default(0).describe("Optional start chunk index for paginated transcription")
      },
      async ({ audioPath, inputLanguage, outputLanguage, diarize, timestamps, startChunk }) => {
        try {
          if (!GEMINI_API_KEY) throw new ConfigurationError("Missing GEMINI_API_KEY");

          // Validate audio path for security (Issue #11)
          const pathValidation = validateFilePath(audioPath, {
            mustExist: true,
            mustBeFile: true,
            extensions: [...ALLOWED_AUDIO_EXTENSIONS] as string[],
            allowAbsolute: true // Allow absolute paths in MCP context
          });

          if (!pathValidation.valid) {
            throw new AudioValidationError(
              pathValidation.error || "Audio path validation failed",
              { hint: pathValidation.hint }
            );
          }

          // Use the sanitized path from validation
          const validatedAudioPath = pathValidation.sanitizedPath!;

          const fileStats = await fsService.stat(validatedAudioPath);
          if (fileStats.size > MAX_AUDIO_FILE_BYTES) {
            throw new AudioValidationError(`Audio file exceeds maximum supported size of ${formatBytes(MAX_AUDIO_FILE_BYTES)}.`);
          }

          // Validate audio file content before processing
          const validation = await validateAudioFile(validatedAudioPath);
          if (!validation.isValid) {
            throw new AudioValidationError(
              validation.error || "Audio validation failed",
              { hint: validation.hint }
            );
          }

          // Log audio details if validation succeeded
          if (validation.details) {
            const { codec, bitrate, duration } = validation.details;
            if (duration !== undefined) {
              safeLog('info', { duration, codec, bitrate }, `Audio: ${duration.toFixed(1)}s, codec: ${codec}, bitrate: ${bitrate}`);
            } else {
              safeLog('info', { codec, bitrate }, `Audio: codec: ${codec}, bitrate: ${bitrate}`);
            }
          }

          const gemini = getGeminiService();

          const instructionsBase = [
            "You are a professional HR meeting transcriber.",
            `Audio language hint: ${inputLanguage}.`,
            `Output language: ${outputLanguage}.`,
            "Return ONLY JSON with keys: transcript (string), segments (array of {start, end, speaker, text}).",
            diarize
              ? "Perform speaker diarization; infer 'Manager'/'HRBP' if obvious else SPEAKER_1..n."
              : "No diarization; set speaker to 'SPEAKER_1'.",
            timestamps ? "Include start/end times HH:MM:SS." : "Set start/end to null."
          ];

          const modelId = MODELS.GEMINI_PRO;

          const duration = await probeDuration(validatedAudioPath);
          const chunkSeconds = GEMINI_CHUNK_SECONDS;
          const shouldChunkDefault = duration === null ? true : duration > GEMINI_SINGLE_PASS_MAX;

          // Only consider S3 path when explicitly requested AND a bucket is configured
          const preferPresigned = GEMINI_INPUT_MODE === "presigned" && Boolean(S3_BUCKET);
          safeLog('info', { GEMINI_INPUT_MODE, S3_BUCKET, preferPresigned }, 'Transcriber input-mode configuration');

          // Warn user about long processing times for larger files
          if (duration && duration > 120) {
            const estimatedMinutes = Math.ceil(duration / 60);
            safeLog(
              'info',
              { duration, estimatedMinutes },
              `⏱️  Audio is ${estimatedMinutes} minutes long. Transcription may take several minutes. Progress updates will appear periodically.`
            );
          }

          const runSingleViaS3AndUpload = async () => {
            // For audit: store on S3, then upload the local file to Gemini File API
            safeLog('info', { mode: 's3+upload' }, "🎤 Transcribing audio: store in S3, then Gemini upload (single pass)...");
            const s3 = getS3Service();
            const mimeType = mime.getType(validatedAudioPath) || "audio/wav";
            let uploadedKey: string | null = null;
            let uploadedBucket: string | null = null;
            try {
              const uploaded = await s3.uploadAndPresign({
                filePath: validatedAudioPath,
                mimeType,
                bucket: S3_BUCKET,
                prefix: S3_PREFIX,
                expiresInSeconds: S3_PRESIGN_TTL_SECONDS
              });
              uploadedKey = uploaded.key;
              uploadedBucket = uploaded.bucket;
            } catch (e) {
              const se = sanitizeError(e);
              safeLog('warn', { error: se }, "S3 upload/presign failed; continuing with direct Gemini upload");
            }

            const res = await transcribeChunk({
              filePath: validatedAudioPath,
              offsetSeconds: 0,
              gemini,
              modelId,
              instructionsBase,
              retries: GEMINI_TRANSCRIBE_RETRIES,
              thinkingBudget: 0
            });

            if (uploadedBucket && uploadedKey && S3_DELETE_AFTER) {
              try {
                await s3.deleteObject(uploadedBucket, uploadedKey);
              } catch {/* ignore */}
            }

            const transcript = res.transcript.trim() || res.segments.map(seg => seg.text).join("\n").trim();
            return buildSuccess(transcript, res.segments, null, {
              totalChunks: 1,
              processedChunks: 1,
              startChunk: 0
            });
          };

          const runSingleViaUpload = async () => {
            safeLog('info', { mode: 'upload' }, "🎤 Transcribing audio via SDK upload (single pass)...");
            const res = await transcribeChunk({
              filePath: validatedAudioPath,
              offsetSeconds: 0,
              gemini,
              modelId,
              instructionsBase,
              retries: GEMINI_TRANSCRIBE_RETRIES,
              thinkingBudget: 0
            });
            const transcript = res.transcript.trim() || res.segments.map(seg => seg.text).join("\n").trim();
            return buildSuccess(transcript, res.segments, null, {
              totalChunks: 1,
              processedChunks: 1,
              startChunk: 0
            });
          };

          const runSingle = async () => {
            if (preferPresigned) {
              try {
                return await runSingleViaS3AndUpload();
              } catch (e) {
                const se = sanitizeError(e);
                safeLog('warn', { error: se }, "Presigned single-pass failed; considering fallback");
                return await runSingleViaUpload();
              }
            }

            return await runSingleViaUpload();
          };

          // Prefer presigned single-pass regardless of duration; fallback to chunking on failure
          if (preferPresigned) {
            try {
              return await runSingle();
            } catch {
              // fall through to chunking
            }
          } else {
            if (!shouldChunkDefault) {
              return await runSingle();
            }
          }

          const normalizedStartChunk =
            Number.isFinite(startChunk) && startChunk > 0
              ? Math.floor(startChunk)
              : 0;

          // If we got here, we either prefer upload mode and need chunking, or presigned failed and we must chunk

          let tmpDir: string | null = null;
          try {
            const split = await splitAudio({ fsService, filePath: validatedAudioPath, chunkSeconds, log: safeLog });
            tmpDir = split.tmpDir;
            const totalChunks = split.chunks.length;

            if (!totalChunks) {
              return await runSingle();
            }

            if (normalizedStartChunk >= totalChunks) {
              return buildSuccess("", [], null, {
                totalChunks,
                processedChunks: 0,
                startChunk: normalizedStartChunk
              });
            }

            const remaining = totalChunks - normalizedStartChunk;
            const batchSize = Math.min(MAX_CHUNKS_PER_CALL, Math.max(1, remaining));
            const selectedChunks: ChunkInfo[] = split.chunks.slice(normalizedStartChunk, normalizedStartChunk + batchSize);

            const chunkResults = await runWithConcurrency(
              selectedChunks,
              (chunk) =>
                transcribeChunk({
                  filePath: chunk.path,
                  offsetSeconds: chunk.offsetSeconds,
                  gemini,
                  modelId,
                  instructionsBase,
                  retries: GEMINI_TRANSCRIBE_RETRIES,
                  thinkingBudget: 0
                }),
              { concurrency: 1, onProgress: (completed, total) => {
                const absoluteCompleted = normalizedStartChunk + completed;
                const percentage = Math.floor((absoluteCompleted / totalChunks) * 100);
                safeLog('info',
                  { completed: absoluteCompleted, total: totalChunks, percentage, chunkSeconds },
                  `📝 Transcribed ${absoluteCompleted}/${totalChunks} chunks (${percentage}%)`);
              }}
            );

            const transcriptParts = chunkResults.map(r => r.transcript.trim()).filter(Boolean);
            const mergedSegments = chunkResults
              .flatMap(r => r.segments)
              .sort((a, b) => (a.startSeconds ?? Infinity) - (b.startSeconds ?? Infinity));

            const transcript =
              transcriptParts.join("\n\n").trim() ||
              mergedSegments.map(seg => seg.text).join("\n").trim();

            const nextChunkIndex =
              normalizedStartChunk + selectedChunks.length < totalChunks
                ? normalizedStartChunk + selectedChunks.length
                : null;

            return buildSuccess(
              transcript,
              mergedSegments.map(s => ({ start: s.start, end: s.end, speaker: s.speaker, text: s.text })),
              nextChunkIndex,
              {
                totalChunks,
                processedChunks: selectedChunks.length,
                startChunk: normalizedStartChunk
              }
            );
          } finally {
            if (tmpDir) {
              await cleanupTempDir(tmpDir);
            }
          }
        } catch (error: unknown) {
          // MCP tool-level error handler - convert all errors to mcpError format
          if (error instanceof AudioValidationError ||
              error instanceof TranscriptionError ||
              error instanceof ConfigurationError) {
            return mcpError(error.message, error.metadata);
          }

          // Wrap other errors in TranscriptionError with helpful hints
          const sanitized = sanitizeError(error);
          const message = sanitized.message;

          let hint: string | undefined;
          if (sanitized.code === "ENOENT" && message.includes("ffmpeg")) {
            hint = "ffmpeg is required for chunked transcription. Please install ffmpeg or provide a shorter audio clip.";
          } else if (/ffmpeg/.test(message) && /exited with code/.test(message)) {
            // Extract exit code for more specific error messages
            const exitCodeMatch = message.match(/exited with code (\d+)/);
            const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1]) : null;

            if (exitCode === 1) {
              hint = "ffmpeg reported a generic error. The audio file may be corrupt or in an unsupported format. Try re-exporting as MP3 or WAV.";
            } else if (exitCode === 255) {
              hint = "ffmpeg processing was interrupted. This might indicate a timeout or the file may be too large/corrupt to process.";
            } else if (exitCode === -11 || message.includes("Segmentation fault")) {
              hint = "ffmpeg crashed (segmentation fault). The audio file is likely corrupt or severely damaged. Try re-downloading or re-exporting the file.";
            } else {
              hint = "ffmpeg reported an error while chunking audio. Verify ffmpeg is installed and the audio file is valid.";
            }
          }

          safeLog(
            'warn',
            {
              error: sanitized,
              hint
            },
            "Gemini transcription tool failed"
          );
          return mcpError(message, hint ? { ...sanitized, hint } : sanitized);
        }
      }
    )
  ]
});
