/**
 * Safely parse JSON string with type safety
 * @template T The type to parse into
 * @param raw JSON string or null
 * @returns Parsed object or null if parsing fails
 */
export function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Format duration in seconds to HH:MM:SS or MM:SS format
 * @param rawSeconds Total seconds (may be NaN or negative)
 * @returns Formatted duration string
 */
export function formatDuration(rawSeconds: number): string {
  if (!Number.isFinite(rawSeconds)) return "0:00";
  const totalSeconds = Math.max(0, Math.floor(rawSeconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Format duration in milliseconds to HH:MM:SS or MM:SS format
 * @param ms Total milliseconds
 * @returns Formatted duration string
 */
export function formatDurationMs(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  return formatDuration(Math.round(ms / 1000));
}

/**
 * Normalized usage metadata structure
 */
export interface NormalizedUsage {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

/**
 * Normalizes usage metadata from various AI provider formats into a consistent structure.
 *
 * Handles field name variations from:
 * - Gemini SDK (promptTokenCount, candidatesTokenCount, responseTokenCount, totalTokenCount)
 * - Anthropic API (input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens)
 * - Generic formats (inputTokens, outputTokens, etc.)
 *
 * @param raw - Raw usage metadata object from any provider
 * @returns Normalized usage object with consistent field names, or null if no valid data
 */
export function normalizeUsageMetrics(raw: unknown): NormalizedUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const toNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
  return {
    model: typeof data.model === "string" ? data.model : undefined,
    inputTokens: toNumber(
      data.input_tokens ??
      data.inputTokens ??
      data.promptTokenCount ??
      data.prompt_token_count ??
      data.inputTokenCount ??
      data.input_token_count ??
      data.promptTokens
    ),
    outputTokens: toNumber(
      data.output_tokens ??
      data.outputTokens ??
      data.candidatesTokenCount ??
      data.candidates_token_count ??
      data.outputTokenCount ??
      data.output_token_count ??
      data.responseTokenCount ??
      data.response_token_count ??
      data.candidatesTokens ??
      data.responseTokens
    ),
    cacheCreationTokens: toNumber(
      data.cache_creation_input_tokens ??
      data.cacheCreationInputTokens ??
      data.cacheCreationTokens
    ),
    cacheReadTokens: toNumber(
      data.cache_read_input_tokens ??
      data.cacheReadInputTokens ??
      data.cacheReadTokens
    )
  };
}
