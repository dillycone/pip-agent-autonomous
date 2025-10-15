import { PRICING } from "../config.js";
import type { CostSummary, CostBreakdown } from "../types/index.js";

export interface UsageBuckets {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  geminiInputTokens?: number;
  geminiOutputTokens?: number;
}

export function summarizeCost(buckets: UsageBuckets): CostSummary {
  const inputTokens = buckets.inputTokens ?? 0;
  const outputTokens = buckets.outputTokens ?? 0;
  const cacheCreationTokens = buckets.cacheCreationTokens ?? 0;
  const cacheReadTokens = buckets.cacheReadTokens ?? 0;
  const geminiInputTokens = buckets.geminiInputTokens ?? 0;
  const geminiOutputTokens = buckets.geminiOutputTokens ?? 0;

  const inputCost = (inputTokens / 1_000_000) * PRICING.INPUT_PER_MTK;
  const outputCost = (outputTokens / 1_000_000) * PRICING.OUTPUT_PER_MTK;
  const cacheCreationCost = (cacheCreationTokens / 1_000_000) * PRICING.CACHE_CREATION_PER_MTK;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * PRICING.CACHE_READ_PER_MTK;
  const geminiInputCost = (geminiInputTokens / 1_000_000) * PRICING.GEMINI_TRANSCRIBE_INPUT_PER_MTK;
  const geminiOutputCost = (geminiOutputTokens / 1_000_000) * PRICING.GEMINI_TRANSCRIBE_OUTPUT_PER_MTK;

  const totalTokens =
    inputTokens +
    outputTokens +
    cacheCreationTokens +
    cacheReadTokens +
    geminiInputTokens +
    geminiOutputTokens;

  const estimatedCostUSD =
    inputCost +
    outputCost +
    cacheCreationCost +
    cacheReadCost +
    geminiInputCost +
    geminiOutputCost;

  const breakdown: CostBreakdown = {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    geminiInputTokens,
    geminiOutputTokens,
    inputCostUSD: Number(inputCost.toFixed(4)),
    outputCostUSD: Number(outputCost.toFixed(4)),
    cacheCreationCostUSD: Number(cacheCreationCost.toFixed(4)),
    cacheReadCostUSD: Number(cacheReadCost.toFixed(4)),
    geminiInputCostUSD: Number(geminiInputCost.toFixed(4)),
    geminiOutputCostUSD: Number(geminiOutputCost.toFixed(4))
  };

  return {
    totalTokens,
    estimatedCostUSD,
    breakdown
  };
}
