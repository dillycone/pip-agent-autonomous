import { z } from "zod";
import mime from "mime";
import { sanitizeError, sanitizePath } from "../utils/sanitize.js";
import { TranscriptionError } from "../errors/index.js";
import type { IGeminiService } from "../services/index.js";
import type { GeminiTranscriptionResult, GeminiRawSegment } from "../types/index.js";
import {
  delay,
  extractTokenUsageFromMetadata,
  formatTimestamp,
  normalizeSegments,
  hasTimeoutSignal,
  isTimeoutLikeError,
  type GeminiTokenUsage,
  type NormalizedSegment
} from "./utils.js";

const GeminiSegmentSchema = z.object({
  start: z.union([z.string(), z.number()]).optional(),
  end: z.union([z.string(), z.number()]).optional(),
  begin: z.union([z.string(), z.number()]).optional(),
  finish: z.union([z.string(), z.number()]).optional(),
  from: z.union([z.string(), z.number()]).optional(),
  to: z.union([z.string(), z.number()]).optional(),
  text: z.string().optional(),
  transcript: z.string().optional(),
  speaker: z.string().optional()
});

const GeminiTranscriptionSchema = z.object({
  transcript: z.string().optional(),
  segments: z.array(GeminiSegmentSchema).optional()
});

export type TranscribeChunkResult = {
  transcript: string;
  segments: NormalizedSegment[];
  usage: GeminiTokenUsage | null;
};

export async function transcribeChunk(params: {
  filePath: string;
  offsetSeconds: number;
  gemini: IGeminiService;
  modelId: string;
  instructionsBase: string[];
  retries: number;
  thinkingBudget: number;
}): Promise<TranscribeChunkResult> {
  const { filePath, offsetSeconds, gemini, modelId, instructionsBase, retries, thinkingBudget } = params;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const mimeType = mime.getType(filePath) || "audio/wav";
      const uploaded = await gemini.uploadFile(filePath, mimeType);
      const fileUri: string | undefined = uploaded.uri ?? uploaded.fileUri;
      const fileMime: string = uploaded.mimeType ?? uploaded.fileMimeType ?? mimeType;
      if (!fileUri) {
        throw new Error("Upload failed: missing file URI");
      }

      const offsetInstruction =
        offsetSeconds > 0
          ? `This audio chunk begins at timestamp ${formatTimestamp(offsetSeconds)}. Return timestamps as absolute times in the original recording.`
          : "Return timestamps as absolute times (HH:MM:SS) in the original recording.";

      const instructions = [...instructionsBase, offsetInstruction].join("\n");

      const result = await gemini.generateContent({
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
        config: {
          responseMimeType: "application/json",
          thinkingConfig: {
            thinkingBudget
          }
        }
      });

      const text: string = result.text ?? result.response?.text?.() ?? "";
      const cleaned = String(text).replace(/```json|```/g, "").trim();

      // Normalize usage metadata location across SDK shapes
      const rawUsageMeta = (result as any)?.usageMetadata
        ?? (result as any)?.response?.usageMetadata
        ?? (Array.isArray((result as any)?.response?.candidates)
              ? (result as any).response.candidates[0]?.usageMetadata
              : undefined);
      const usage = extractTokenUsageFromMetadata(rawUsageMeta);

      let parsed: unknown;
      try {
        parsed = JSON.parse(cleaned);
      } catch (err) {
        throw new Error(`Failed to parse JSON from Gemini response: ${(err as Error).message}`);
      }

      let transcriptionData: GeminiTranscriptionResult | null = null;
      let rawSegments: GeminiRawSegment[] = [];
      const schemaResult = GeminiTranscriptionSchema.safeParse(parsed);
      if (schemaResult.success) {
        transcriptionData = schemaResult.data as GeminiTranscriptionResult;
        rawSegments = Array.isArray(schemaResult.data.segments) ? schemaResult.data.segments : [];
      } else if (Array.isArray(parsed)) {
        rawSegments = parsed as GeminiRawSegment[];
      } else {
        const validationError = schemaResult.error.flatten();
        throw new TranscriptionError("Gemini response validation failed", {
          issues: validationError,
          chunkOffsetSeconds: offsetSeconds,
          rawResponse: parsed
        });
      }

      const transcript: string =
        typeof transcriptionData?.transcript === "string" && transcriptionData.transcript.trim()
          ? transcriptionData.transcript.trim()
          : rawSegments
              .map(seg => String(seg?.text ?? seg?.transcript ?? "").trim())
              .filter(Boolean)
              .join("\n")
              .trim();

      let segments = normalizeSegments(rawSegments, offsetSeconds);
      if (segments.length === 0 && transcript) {
        segments = [{
          start: formatTimestamp(offsetSeconds),
          end: null,
          startSeconds: offsetSeconds,
          endSeconds: null,
          speaker: "SPEAKER_1",
          text: transcript
        }];
      }

      return { transcript, segments, usage };
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await delay(1000 * (attempt + 1));
        continue;
      }
      break;
    }
  }

  const baseError = lastError ?? new Error("Unknown transcription failure");
  const sanitized = sanitizeError(baseError);
  const timeout = isTimeoutLikeError(baseError) || hasTimeoutSignal(sanitized);
  const metadata: Record<string, unknown> = {
    chunkOffsetSeconds: offsetSeconds,
    chunkPath: sanitizePath(filePath),
    attempts: retries + 1,
    cause: sanitized
  };

  if (timeout) {
    metadata.reason = "timeout";
  }

  throw new TranscriptionError(
    timeout ? "Transcription chunk timed out" : sanitized.message || "Transcription failed",
    metadata
  );
}
