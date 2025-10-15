export interface GeminiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
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

export function normalizeGeminiTokenUsage(source: unknown): GeminiTokenUsage | null {
  if (!source || typeof source !== "object") {
    return null;
  }

  const usage = source as Record<string, unknown>;

  const input =
    toNumber(usage.inputTokens) ??
    toNumber(usage.promptTokenCount) ??
    toNumber(usage.prompt_token_count) ??
    toNumber(usage.inputTokenCount) ??
    toNumber(usage.input_token_count) ??
    toNumber(usage.promptTokens);

  const output =
    toNumber(usage.outputTokens) ??
    toNumber(usage.candidatesTokenCount) ??
    toNumber(usage.candidates_token_count) ??
    toNumber(usage.outputTokenCount) ??
    toNumber(usage.output_token_count) ??
    toNumber(usage.candidatesTokens);

  const total =
    toNumber(usage.totalTokens) ??
    toNumber(usage.totalTokenCount) ??
    toNumber(usage.total_token_count);

  if (input === null && output === null && total === null) {
    return null;
  }

  const inputTokens = input ?? 0;
  const outputTokens = output ?? 0;
  const totalTokens = total ?? inputTokens + outputTokens;

  return { inputTokens, outputTokens, totalTokens };
}
