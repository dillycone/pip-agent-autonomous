import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeCost } from "../src/utils/cost.js";
import { normalizeGeminiTokenUsage } from "../src/utils/geminiUsage.js";

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

test("normalizeGeminiTokenUsage extracts numeric fields", () => {
  const usage = normalizeGeminiTokenUsage({
    inputTokens: "100",
    candidatesTokenCount: "40",
    totalTokenCount: "150"
  });

  if (!usage) {
    throw new Error("Expected usage to be parsed");
  }
  assert.equal(usage.inputTokens, 100);
  assert.equal(usage.outputTokens, 40);
  assert.equal(usage.totalTokens, 150);
});

test("normalizeGeminiTokenUsage falls back to sums when total missing", () => {
  const usage = normalizeGeminiTokenUsage({
    promptTokenCount: 25,
    output_token_count: 75
  });

  if (!usage) {
    throw new Error("Expected usage to be parsed");
  }
  assert.equal(usage.totalTokens, 100);
});

test("normalizeGeminiTokenUsage returns null for unusable payloads", () => {
  assert.equal(normalizeGeminiTokenUsage(null), null);
  assert.equal(normalizeGeminiTokenUsage({}), null);
  assert.equal(normalizeGeminiTokenUsage({ foo: "bar" }), null);
});
