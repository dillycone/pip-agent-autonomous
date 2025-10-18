/**
 * Consolidated usage metadata normalization utilities.
 * This module handles the various field name conventions used by different AI providers
 * and normalizes them into a consistent format for tracking and display.
 */

export interface NormalizedUsage extends Record<string, unknown> {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

/**
 * Converts an unknown value to a number, handling both number and string types.
 * @param value - The value to convert
 * @returns A finite number or null if conversion fails
 */
function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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
export function normalizeUsageMetadata(raw: unknown): NormalizedUsage | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const data = raw as Record<string, unknown>;

  // Extract input tokens (various field name conventions)
  const input =
    toNumber(data.promptTokenCount) ??
    toNumber(data.prompt_token_count) ??
    toNumber(data.inputTokenCount) ??
    toNumber(data.input_token_count) ??
    toNumber(data.input_tokens) ??
    toNumber(data.promptTokens) ??
    toNumber(data.inputTokens);

  // Extract output tokens (various field name conventions)
  const output =
    toNumber(data.candidatesTokenCount) ??
    toNumber(data.candidates_token_count) ??
    toNumber(data.outputTokenCount) ??
    toNumber(data.output_token_count) ??
    toNumber(data.output_tokens) ??
    toNumber(data.responseTokenCount) ??
    toNumber(data.response_token_count) ??
    toNumber(data.candidatesTokens) ??
    toNumber(data.outputTokens) ??
    toNumber(data.responseTokens);

  // Extract total tokens
  const total =
    toNumber(data.totalTokenCount) ??
    toNumber(data.total_token_count) ??
    toNumber(data.totalTokens);

  // Extract cache-related tokens (Anthropic-specific)
  const cacheCreation =
    toNumber(data.cache_creation_input_tokens) ??
    toNumber(data.cacheCreationInputTokens) ??
    toNumber(data.cacheCreationTokens);

  const cacheRead =
    toNumber(data.cache_read_input_tokens) ??
    toNumber(data.cacheReadInputTokens) ??
    toNumber(data.cacheReadTokens);

  // Extract model name if available
  const model = typeof data.model === "string" ? data.model : undefined;

  // If no valid token counts found, return null
  if (input === null && output === null && total === null) {
    return null;
  }

  // Calculate final values with defaults
  const inputTokens = input ?? 0;
  const outputTokens = output ?? 0;
  const totalTokens = total ?? inputTokens + outputTokens;

  const result: NormalizedUsage = {
    inputTokens,
    outputTokens,
    totalTokens
  };

  if (model !== undefined) {
    result.model = model;
  }

  if (cacheCreation !== null) {
    result.cacheCreationTokens = cacheCreation;
  }

  if (cacheRead !== null) {
    result.cacheReadTokens = cacheRead;
  }

  return result;
}
