export interface GeminiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

function extractToolText(content: unknown): string | null {
  if (Array.isArray(content)) {
    const textPart = content.find(
      part =>
        typeof part === "object" &&
        part !== null &&
        typeof (part as { text?: unknown }).text === "string"
    ) as { text?: string } | undefined;
    return typeof textPart?.text === "string" ? textPart.text : null;
  }
  if (typeof content === "string") {
    return content;
  }
  return null;
}

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
 * Extract Gemini transcription usage information from a tool result payload.
 *
 * The Gemini MCP tool returns usage statistics inside a JSON blob embedded in
 * the tool's text content. The structure is not guaranteed, so we coerce both
 * numeric and string representations and fall back across multiple possible
 * field names emitted by different SDK versions.
 */
export function extractGeminiTokenUsage(content: unknown): GeminiTokenUsage | null {
  const rawText = extractToolText(content);
  if (!rawText) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawText) as { tokenUsage?: Record<string, unknown> } | null;
    const usage = parsed?.tokenUsage;
    if (!usage || typeof usage !== "object") {
      return null;
    }

    const input =
      toNumber((usage as Record<string, unknown>).inputTokens) ??
      toNumber((usage as Record<string, unknown>).promptTokenCount) ??
      toNumber((usage as Record<string, unknown>).promptTokens);

    const output =
      toNumber((usage as Record<string, unknown>).outputTokens) ??
      toNumber((usage as Record<string, unknown>).candidatesTokenCount) ??
      toNumber((usage as Record<string, unknown>).candidatesTokens);

    const total =
      toNumber((usage as Record<string, unknown>).totalTokens) ??
      toNumber((usage as Record<string, unknown>).totalTokenCount);

    if (input === null && output === null && total === null) {
      return null;
    }

    const inputTokens = input ?? 0;
    const outputTokens = output ?? 0;
    const totalTokens = total ?? inputTokens + outputTokens;

    return { inputTokens, outputTokens, totalTokens };
  } catch {
    return null;
  }
}
