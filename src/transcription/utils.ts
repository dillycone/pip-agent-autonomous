import type { GeminiRawSegment } from "../types/index.js";
import { TranscriptionError } from "../errors/index.js";
import { normalizeUsageMetadata, type NormalizedUsage } from "../utils/usage-normalization.js";

export type GeminiTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

// Re-export for backward compatibility
export type { NormalizedUsage };

export type NormalizedSegment = {
  start: string | null;
  end: string | null;
  startSeconds: number | null;
  endSeconds: number | null;
  speaker: string;
  text: string;
};

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i)) + sizes[i];
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract token usage from metadata using the normalized utility.
 * @deprecated Use normalizeUsageMetadata from utils/usage-normalization.ts directly
 */
export function extractTokenUsageFromMetadata(metadata?: Record<string, unknown> | null): GeminiTokenUsage | null {
  return normalizeUsageMetadata(metadata);
}

export function hasTimeoutSignal(value: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    const lower = value.toLowerCase();
    return (
      lower.includes("timeout") ||
      lower.includes("timed out") ||
      lower.includes("deadline exceeded")
    );
  }

  if (typeof value === "number") {
    return value === 408;
  }

  if (value instanceof Error) {
    return hasTimeoutSignal(value.message, seen);
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) {
      return false;
    }
    seen.add(obj);

    const keysToInspect = ["message", "error", "status", "statusText", "code", "reason"];
    for (const key of keysToInspect) {
      const field = obj[key];
      if (typeof field === "string" || typeof field === "number") {
        if (hasTimeoutSignal(field, seen)) {
          return true;
        }
      }
    }

    const cause = (obj as { cause?: unknown }).cause;
    if (cause && hasTimeoutSignal(cause, seen)) {
      return true;
    }

    const metadata = (obj as { metadata?: unknown }).metadata;
    if (metadata && hasTimeoutSignal(metadata, seen)) {
      return true;
    }
  }

  return false;
}

export function isTimeoutLikeError(error: unknown): boolean {
  if (error instanceof TranscriptionError) {
    const metadata = error.metadata;
    if (metadata && typeof metadata === "object") {
      const reason = (metadata as { reason?: unknown }).reason;
      if (typeof reason === "string" && reason.toLowerCase() === "timeout") {
        return true;
      }
    }
  }

  return hasTimeoutSignal(error);
}

export function toSeconds(value: string | number | null | undefined): number | null {
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

export function formatTimestamp(seconds: number | null): string | null {
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

export function normalizeSegments(rawSegments: GeminiRawSegment[], offsetSeconds: number): NormalizedSegment[] {
  return rawSegments
    .map(seg => {
      const startSeconds = toSeconds(seg?.start ?? seg?.begin ?? seg?.from ?? null);
      const endSeconds = toSeconds(seg?.end ?? seg?.finish ?? seg?.to ?? null);
      const text = String(seg?.text ?? seg?.transcript ?? "").trim();
      const speaker = String(seg?.speaker ?? "SPEAKER_1");
      const start = formatTimestamp(startSeconds !== null ? startSeconds + offsetSeconds : null);
      const end = formatTimestamp(endSeconds !== null ? endSeconds + offsetSeconds : null);
      return {
        start,
        end,
        startSeconds: startSeconds !== null ? startSeconds + offsetSeconds : null,
        endSeconds: endSeconds !== null ? endSeconds + offsetSeconds : null,
        text,
        speaker
      };
    })
    .filter(seg => Boolean(seg.text));
}
