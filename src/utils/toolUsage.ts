/**
 * Shared helpers for extracting usage metadata from MCP tool results.
 *
 * Tool responses typically embed JSON inside a text content block. These utilities
 * safely unwrap that payload and normalize token counters across providers.
 */

export interface ToolUsageDetails {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  provider?: string;
  model?: string;
}

/**
 * Extract the first text payload from a tool result content block.
 */
export function extractToolText(content: unknown): string | null {
  if (Array.isArray(content)) {
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
    }
    return null;
  }

  return typeof content === "string" ? content : null;
}

/**
 * Parse the JSON payload from a tool response. Handles common Markdown fences.
 */
export function parseToolResponse(content: unknown): Record<string, unknown> | null {
  const rawText = extractToolText(content);
  if (!rawText) {
    return null;
  }

  const trimmed = rawText.trim();
  if (!trimmed) {
    return null;
  }

  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenceMatch ? fenceMatch[1].trim() : trimmed;

  try {
    const parsed = JSON.parse(jsonText);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Normalize usage counters extracted from a tool response payload.
 */
export function extractToolUsage(content: unknown): ToolUsageDetails | null {
  const parsed = parseToolResponse(content);
  if (!parsed) {
    return null;
  }

  const usageCandidates: Array<Record<string, unknown>> = [];
  const addCandidate = (candidate: unknown) => {
    if (candidate && typeof candidate === "object") {
      usageCandidates.push(candidate as Record<string, unknown>);
    }
  };

  addCandidate((parsed as Record<string, unknown>).tokenUsage);
  addCandidate((parsed as Record<string, unknown>).usage);

  const details = (parsed as { details?: unknown }).details;
  if (details && typeof details === "object") {
    addCandidate((details as Record<string, unknown>).usage);
    addCandidate((details as Record<string, unknown>).tokenUsage);
  }

  const toNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsedValue = Number(value);
      return Number.isFinite(parsedValue) ? parsedValue : null;
    }
    return null;
  };

  for (const usage of usageCandidates) {
    const provider =
      typeof usage.provider === "string"
        ? usage.provider
        : typeof (parsed as Record<string, unknown>).provider === "string"
          ? (parsed as Record<string, unknown>).provider as string
          : undefined;

    const model =
      typeof usage.model === "string"
        ? usage.model
        : typeof (parsed as Record<string, unknown>).model === "string"
          ? (parsed as Record<string, unknown>).model as string
          : undefined;

    const input =
      toNumber(usage.inputTokens) ??
      toNumber((usage as Record<string, unknown>).input_tokens) ??
      toNumber((usage as Record<string, unknown>).promptTokens) ??
      toNumber((usage as Record<string, unknown>).promptTokenCount);

    const output =
      toNumber(usage.outputTokens) ??
      toNumber((usage as Record<string, unknown>).output_tokens) ??
      toNumber((usage as Record<string, unknown>).candidatesTokens) ??
      toNumber((usage as Record<string, unknown>).candidatesTokenCount);

    const cacheCreation =
      toNumber(usage.cacheCreationTokens) ??
      toNumber((usage as Record<string, unknown>).cache_creation_input_tokens) ??
      toNumber((usage as Record<string, unknown>).cacheCreationInputTokens);

    const cacheRead =
      toNumber(usage.cacheReadTokens) ??
      toNumber((usage as Record<string, unknown>).cache_read_input_tokens) ??
      toNumber((usage as Record<string, unknown>).cacheReadInputTokens);

    const total =
      toNumber(usage.totalTokens) ??
      toNumber((usage as Record<string, unknown>).total_token_count) ??
      toNumber((usage as Record<string, unknown>).totalTokenCount);

    if (
      input === null &&
      output === null &&
      cacheCreation === null &&
      cacheRead === null &&
      total === null
    ) {
      continue;
    }

    const providerHint = (() => {
      if (provider) return provider;
      if (model) {
        const lower = model.toLowerCase();
        if (lower.includes("gemini")) return "gemini";
        if (lower.includes("claude")) return "claude";
      }
      return undefined;
    })();

    const detail: ToolUsageDetails = {
      inputTokens: input ?? 0,
      outputTokens: output ?? 0,
      cacheCreationTokens: cacheCreation ?? 0,
      cacheReadTokens: cacheRead ?? 0,
      totalTokens: total ?? (input ?? 0) + (output ?? 0),
      provider: providerHint,
      model
    };

    return detail;
  }

  return null;
}
