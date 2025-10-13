import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import mime from "mime";
import { cleanupTempDir } from "../utils/cleanup.js";
import { sanitizeError, sanitizePath } from "../utils/sanitize.js";
import { mcpError } from "../utils/safe-stringify.js";
import { mcpSuccess } from "../utils/mcp-helpers.js";
import { AudioValidationError, TranscriptionError, ConfigurationError } from "../errors/index.js";
import { createChildLogger } from "../utils/logger.js";
import { safeSpawn } from "../utils/shell-safe.js";
import { validateFilePath } from "../utils/validation.js";
import {
  GEMINI_API_KEY,
  MODELS,
  GEMINI_CHUNK_SECONDS,
  GEMINI_SINGLE_PASS_MAX,
  GEMINI_TRANSCRIBE_CONCURRENCY,
  GEMINI_TRANSCRIBE_RETRIES,
  ALLOWED_AUDIO_EXTENSIONS
} from "../config.js";
import type {
  AudioProbeData,
  GeminiUploadResponse,
  GeminiGenerateResponse,
  GeminiTranscriptionResult,
  GeminiRawSegment
} from "../types/index.js";
import { isAudioProbeData } from "../types/index.js";
import {
  IGeminiService,
  IFileSystemService,
  createGeminiService,
  createFileSystemService
} from "../services/index.js";

const logger = createChildLogger("gemini-transcriber");

// Create filesystem service once at module level for reuse
const fsService: IFileSystemService = createFileSystemService();

const MAX_AUDIO_FILE_BYTES = 200 * 1024 * 1024;

/**
 * Format bytes to human-readable size (e.g., "200MB")
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i)) + sizes[i];
}

type ChunkInfo = { path: string; index: number; offsetSeconds: number };
type NormalizedSegment = {
  start: string | null;
  end: string | null;
  startSeconds: number | null;
  endSeconds: number | null;
  speaker: string;
  text: string;
};

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runWithConcurrency<T>(
  items: ChunkInfo[],
  worker: (item: ChunkInfo) => Promise<T>,
  onProgress?: (completed: number, total: number) => void
): Promise<T[]> {
  const results: T[] = new Array(items.length);
  let cursor = 0;
  let completed = 0;
  const runner = async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) break;
      const item = items[index];
      results[index] = await worker(item);
      completed++;
      if (onProgress) {
        onProgress(completed, items.length);
      }
    }
  };
  const workers = Array.from({ length: Math.min(GEMINI_TRANSCRIBE_CONCURRENCY, items.length) }, runner);
  await Promise.all(workers);
  return results;
}

/**
 * Secure wrapper for ffmpeg/ffprobe commands
 * Uses safeSpawn to prevent command injection
 *
 * @security This function replaces the unsafe spawn() usage (Issue #6)
 */
async function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await safeSpawn(command, args, {
      timeout: 300000, // 5 minutes
      validatePaths: true
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error: unknown) {
    // safeSpawn throws an error if the command fails
    // Extract the error message and re-throw in the expected format
    throw error;
  }
}

async function validateAudioFile(filePath: string): Promise<{
  isValid: boolean;
  error?: string;
  hint?: string;
  details?: {
    codec?: string;
    bitrate?: string;
    duration?: number;
  }
}> {
  try {
    const { stdout } = await runCommand("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_name,codec_type,bit_rate,duration",
      "-show_entries",
      "format=duration,bit_rate",
      "-of",
      "json",
      filePath
    ]);

    let probeData: AudioProbeData;
    try {
      const parsed: unknown = JSON.parse(stdout.trim());
      if (!isAudioProbeData(parsed)) {
        return {
          isValid: false,
          error: "Unable to read audio file metadata",
          hint: "The file may be corrupt, encrypted, or an unsupported format. Try re-exporting as MP3 or WAV."
        };
      }
      probeData = parsed;
    } catch {
      return {
        isValid: false,
        error: "Unable to read audio file metadata",
        hint: "The file may be corrupt, encrypted, or an unsupported format. Try re-exporting as MP3 or WAV."
      };
    }

    const streams = probeData.streams || [];
    const format = probeData.format || {};

    // Find audio stream
    const audioStream = streams.find(s => s.codec_type === "audio");

    if (!audioStream) {
      // Check if there are any streams at all
      if (streams.length === 0) {
        return {
          isValid: false,
          error: "No streams found in file",
          hint: "The file appears to be corrupt or empty. Try downloading/exporting it again."
        };
      }

      // Check if it's video-only
      const hasVideo = streams.some(s => s.codec_type === "video");
      if (hasVideo) {
        return {
          isValid: false,
          error: "No audio stream found in file",
          hint: "This file appears to be video-only or has no audio track. Please provide a valid audio file."
        };
      }

      return {
        isValid: false,
        error: "No audio stream found in file",
        hint: "Audio file appears to be corrupt. Please provide a valid audio file (MP3, WAV, FLAC, etc.)."
      };
    }

    // Extract codec name
    const codec = audioStream.codec_name || "unknown";

    // Check for supported codecs (common ones that ffmpeg/Gemini handle well)
    const supportedCodecs = [
      "mp3", "aac", "opus", "vorbis", "wav", "flac", "pcm_s16le", "pcm_s24le",
      "pcm_s32le", "pcm_f32le", "pcm_f64le", "pcm_u8", "alac", "wmav2", "wmav1"
    ];

    const isKnownCodec = supportedCodecs.some(supported => codec.toLowerCase().includes(supported));

    if (!isKnownCodec) {
      return {
        isValid: false,
        error: `Audio codec '${codec}' may not be supported`,
        hint: "Try converting your audio to MP3, WAV, or FLAC format for better compatibility."
      };
    }

    // Get duration from stream or format
    let duration = parseFloat(audioStream.duration || "") || parseFloat(format.duration || "") || 0;

    if (!Number.isFinite(duration) || duration <= 0) {
      return {
        isValid: false,
        error: "Audio file has zero or invalid duration",
        hint: "The file may be corrupt, empty, or incomplete. Try re-exporting or downloading it again."
      };
    }

    // Get bitrate (prefer stream bitrate, fallback to format bitrate)
    const bitrate = audioStream.bit_rate || format.bit_rate;
    const bitrateFormatted = bitrate ? `${Math.round(parseInt(bitrate) / 1000)}k` : "unknown";

    // Success case - return validation details
    return {
      isValid: true,
      details: {
        codec,
        bitrate: bitrateFormatted,
        duration
      }
    };

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    // Handle specific ffprobe errors
    if (message.includes("Invalid data found")) {
      return {
        isValid: false,
        error: "File appears to be truncated or corrupted",
        hint: "The audio file is incomplete or damaged. Try downloading/exporting it again."
      };
    }

    if (message.includes("moov atom not found")) {
      return {
        isValid: false,
        error: "File is incomplete or improperly encoded",
        hint: "This MP4/M4A file is missing required metadata. Try re-exporting with a different tool."
      };
    }

    // Generic failure
    return {
      isValid: false,
      error: "Unable to read audio file",
      hint: "The file may be corrupt, encrypted, or an unsupported format. Try re-exporting as MP3 or WAV."
    };
  }
}

async function probeDuration(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await runCommand("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath
    ]);
    const value = parseFloat(stdout.trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

async function splitAudio(filePath: string, chunkSeconds: number): Promise<{ tmpDir: string; chunks: ChunkInfo[] }> {
  const tmpDir = await fsService.mkdtemp(path.join(os.tmpdir(), "gemini-chunks-"));
  const ext = path.extname(filePath) || ".mp3";
  const pattern = path.join(tmpDir, `chunk_%03d${ext}`);

  // Log chunk configuration before splitting
  const duration = await probeDuration(filePath);
  const estimatedChunks = duration ? Math.ceil(duration / chunkSeconds) : "unknown";
  logger.info({ estimatedChunks, chunkSeconds, duration }, `🎵 Splitting audio into ~${estimatedChunks} chunks (${chunkSeconds} seconds each)...`);

  await runCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    filePath,
    "-f",
    "segment",
    "-segment_time",
    String(chunkSeconds),
    "-c",
    "copy",
    pattern
  ]);
  const entries = await fsService.readdir(tmpDir);
  const chunks = entries
    .filter(name => name.startsWith("chunk_"))
    .sort()
    .map((name, index) => ({
      path: path.join(tmpDir, name),
      index,
      offsetSeconds: index * chunkSeconds
    }));

  // Log actual chunks created
  logger.info({ chunkCount: chunks.length }, `✂️  Created ${chunks.length} chunks from audio file`);

  return { tmpDir, chunks };
}

function toSeconds(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const num = parseFloat(trimmed);
      return Number.isFinite(num) ? num : null;
    }
    const parts = trimmed.split(":").map(p => parseFloat(p));
    if (parts.some(part => !Number.isFinite(part))) return null;
    return parts.reduce((acc, part) => acc * 60 + part, 0);
  }
  return null;
}

function formatTimestamp(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const totalMs = Math.round(seconds * 1000);
  const positiveMs = totalMs < 0 ? 0 : totalMs;
  const ms = positiveMs % 1000;
  const totalSeconds = Math.floor(positiveMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  const msPart = ms ? `.${ms.toString().padStart(3, "0")}` : "";
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}${msPart}`;
}

function normalizeSegments(rawSegments: GeminiRawSegment[], offsetSeconds: number): NormalizedSegment[] {
  return rawSegments
    .map(seg => {
      const startSeconds = toSeconds(seg?.start ?? seg?.begin ?? seg?.from ?? null);
      const endSeconds = toSeconds(seg?.end ?? seg?.finish ?? seg?.to ?? null);
      const text = String(seg?.text ?? seg?.transcript ?? "").trim();
      const speaker = String(seg?.speaker ?? "SPEAKER_1");
      const start = formatTimestamp(startSeconds !== null ? startSeconds + offsetSeconds : null);
      const end = formatTimestamp(endSeconds !== null ? endSeconds + offsetSeconds : null);
      return { start, end, startSeconds: startSeconds !== null ? startSeconds + offsetSeconds : null, endSeconds: endSeconds !== null ? endSeconds + offsetSeconds : null, text, speaker };
    })
    .filter(seg => Boolean(seg.text));
}

async function transcribeChunk(params: {
  filePath: string;
  offsetSeconds: number;
  ai: unknown;
  modelId: string;
  instructionsBase: string[];
}) {
  const { filePath, offsetSeconds, ai, modelId, instructionsBase } = params;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= GEMINI_TRANSCRIBE_RETRIES; attempt++) {
    try {
      const mimeType = mime.getType(filePath) || "audio/wav";

      // Type guard for Gemini AI instance
      const geminiAI = ai as {
        files: {
          upload: (options: { file: string; config: { mimeType: string } }) => Promise<unknown>;
        };
        models: {
          generateContent: (options: unknown) => Promise<unknown>;
        };
      };

      const uploaded = await geminiAI.files.upload({
        file: filePath,
        config: { mimeType }
      });

      const uploadResponse = uploaded as GeminiUploadResponse;
      const uploadedFile = uploadResponse.file ?? uploadResponse;
      const fileUri: string | undefined = uploadedFile.uri ?? uploadedFile.fileUri;
      const fileMime: string = uploadedFile.mimeType ?? uploadedFile.fileMimeType ?? mimeType;
      if (!fileUri) {
        throw new Error("Upload failed: missing file URI");
      }

      const offsetInstruction =
        offsetSeconds > 0
          ? `This audio chunk begins at timestamp ${formatTimestamp(offsetSeconds)}. Return timestamps as absolute times in the original recording.`
          : "Return timestamps as absolute times (HH:MM:SS) in the original recording.";

      const instructions = [...instructionsBase, offsetInstruction].join("\n");

      const result = await geminiAI.models.generateContent({
        model: modelId,
        contents: [
          {
            role: "user",
            parts: [
              { text: instructions },
              { fileData: { fileUri, mimeType: fileMime } }
            ]
          }
        ],
        config: { responseMimeType: "application/json" }
      });

      const geminiResponse = result as GeminiGenerateResponse;
      const text: string = geminiResponse.text ?? geminiResponse.response?.text?.() ?? "";
      const cleaned = String(text).replace(/```json|```/g, "").trim();

      let parsed: unknown;
      try {
        parsed = JSON.parse(cleaned);
      } catch (err) {
        throw new Error(`Failed to parse JSON from Gemini response: ${(err as Error).message}`);
      }

      // Validate and extract transcription data
      const transcriptionData = parsed as GeminiTranscriptionResult;
      const rawSegments: GeminiRawSegment[] = Array.isArray(transcriptionData?.segments)
        ? transcriptionData.segments
        : Array.isArray(parsed)
          ? parsed as GeminiRawSegment[]
          : [];

      const transcript: string =
        typeof transcriptionData?.transcript === "string" && transcriptionData.transcript.trim()
          ? transcriptionData.transcript.trim()
          : rawSegments
              .map(seg => String(seg?.text ?? seg?.transcript ?? "").trim())
              .filter(Boolean)
              .join("\n")
              .trim();

      const segments = normalizeSegments(rawSegments, offsetSeconds);

      return { transcript, segments };
    } catch (err) {
      lastError = err;
      if (attempt < GEMINI_TRANSCRIBE_RETRIES) {
        await delay(1000 * (attempt + 1));
        continue;
      }
      break;
    }
  }
  throw lastError;
}

function buildSuccess(transcript: string, segments: NormalizedSegment[]) {
  const printableSegments = segments
    .filter(seg => seg.text)
    .map(seg => ({
      start: seg.start,
      end: seg.end,
      speaker: seg.speaker,
      text: seg.text
    }));
  return mcpSuccess({
    transcript: transcript.trim(),
    segments: printableSegments
  });
}

// We use the new Google Gen AI SDK (@google/genai).
// Ensure GEMINI_API_KEY is set in your environment.

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
        timestamps: z.boolean().default(true)
      },
      async ({ audioPath, inputLanguage, outputLanguage, diarize, timestamps }) => {
        try {
          if (!GEMINI_API_KEY) {
            throw new ConfigurationError("Missing GEMINI_API_KEY");
          }

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
              logger.info({ duration, codec, bitrate }, `Audio: ${duration.toFixed(1)}s, codec: ${codec}, bitrate: ${bitrate}`);
            } else {
              logger.info({ codec, bitrate }, `Audio: codec: ${codec}, bitrate: ${bitrate}`);
            }
          }

          const { GoogleGenAI } = await import("@google/genai");
          const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

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
          const shouldChunk = duration === null ? true : duration > Math.min(GEMINI_SINGLE_PASS_MAX, chunkSeconds);

          const runSingle = async () => {
            logger.info("🎤 Transcribing audio (single pass)...");
            const res = await transcribeChunk({
              filePath: validatedAudioPath,
              offsetSeconds: 0,
              ai,
              modelId,
              instructionsBase
            });
            const transcript =
              res.transcript.trim() ||
              res.segments.map(seg => seg.text).join("\n").trim();
            return buildSuccess(transcript, res.segments);
          };

          if (!shouldChunk) {
            return await runSingle();
          }

          let tmpDir: string | null = null;
          try {
            const split = await splitAudio(validatedAudioPath, chunkSeconds);
            tmpDir = split.tmpDir;
            if (!split.chunks.length) {
              return await runSingle();
            }

            const chunkResults = await runWithConcurrency(
              split.chunks,
              chunk =>
                transcribeChunk({
                  filePath: chunk.path,
                  offsetSeconds: chunk.offsetSeconds,
                  ai,
                  modelId,
                  instructionsBase
                }),
              (completed, total) => {
                const percentage = Math.floor((completed / total) * 100);
                // Report every 10% or every 5 chunks, whichever is more frequent
                const reportInterval = Math.max(1, Math.min(5, Math.ceil(total * 0.1)));
                if (completed % reportInterval === 0 || completed === total) {
                  logger.info({ completed, total, percentage }, `📝 Transcribed ${completed}/${total} chunks (${percentage}%)`);
                }
              }
            );

            const transcriptParts = chunkResults.map(r => r.transcript.trim()).filter(Boolean);
            const mergedSegments = chunkResults
              .flatMap(r => r.segments)
              .sort((a, b) => (a.startSeconds ?? Infinity) - (b.startSeconds ?? Infinity));

            const transcript =
              transcriptParts.join("\n\n").trim() ||
              mergedSegments.map(seg => seg.text).join("\n").trim();

            return buildSuccess(transcript, mergedSegments);
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

          return mcpError(message, hint ? { ...sanitized, hint } : sanitized);
        }
      }
    )
  ]
});
