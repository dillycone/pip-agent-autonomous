import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeCost } from "../src/utils/cost.js";
import { extractGeminiTokenUsage } from "../src/utils/geminiTokenUsage.js";

test("summarizeCost calculates totals with all buckets", () => {
  const result = summarizeCost({
    inputTokens: 100_000,
    outputTokens: 200_000,
    cacheCreationTokens: 50_000,
    cacheReadTokens: 25_000,
    geminiInputTokens: 10_000,
    geminiOutputTokens: 5_000
  });

  assert.equal(result.totalTokens, 390_000);
  assert.ok(result.estimatedCostUSD > 0);
  assert.equal(result.breakdown.inputTokens, 100_000);
  assert.equal(result.breakdown.geminiOutputTokens, 5_000);
  assert.ok(result.breakdown.inputCostUSD >= 0);
});

test("summarizeCost handles missing buckets", () => {
  const result = summarizeCost({});
  assert.equal(result.totalTokens, 0);
  assert.equal(result.estimatedCostUSD, 0);
});

test("extractGeminiTokenUsage parses usage details from tool result", () => {
  const content = [
    {
      text: JSON.stringify({ tokenUsage: { inputTokens: "123", outputTokens: 456 } })
    }
  ];
  const usage = extractGeminiTokenUsage(content);
  assert.ok(usage);
  assert.equal(usage?.inputTokens, 123);
  assert.equal(usage?.outputTokens, 456);
  assert.equal(usage?.totalTokens, 579);
});
