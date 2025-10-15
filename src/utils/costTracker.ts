import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  hasUsage,
  type CostSummary
} from "../types/index.js";
import { summarizeCost } from "./cost.js";

export interface TokenUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  geminiInputTokens: number;
  geminiOutputTokens: number;
}

export function createTokenUsageTotals(): TokenUsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    geminiInputTokens: 0,
    geminiOutputTokens: 0
  };
}

export function recordUsageFromMessage(
  totals: TokenUsageTotals,
  message: SDKMessage
): void {
  if (!hasUsage(message) || !message.usage) {
    return;
  }

  totals.inputTokens += message.usage.input_tokens || 0;
  totals.outputTokens += message.usage.output_tokens || 0;
  totals.cacheCreationTokens += message.usage.cache_creation_input_tokens || 0;
  totals.cacheReadTokens += message.usage.cache_read_input_tokens || 0;
}

export class TokenCostTracker {
  private totals: TokenUsageTotals = createTokenUsageTotals();
  private processedMessageIds = new Set<string>();

  recordMessage(message: SDKMessage): void {
    const messageId = (message as { id?: string }).id || (message as { messageId?: string }).messageId;
    if (messageId && this.processedMessageIds.has(messageId)) {
      return;
    }
    if (messageId) {
      this.processedMessageIds.add(messageId);
    }
    recordUsageFromMessage(this.totals, message);
  }

  recordTotals(partial: Partial<TokenUsageTotals>): void {
    this.totals.inputTokens += partial.inputTokens ?? 0;
    this.totals.outputTokens += partial.outputTokens ?? 0;
    this.totals.cacheCreationTokens += partial.cacheCreationTokens ?? 0;
    this.totals.cacheReadTokens += partial.cacheReadTokens ?? 0;
    this.totals.geminiInputTokens += partial.geminiInputTokens ?? 0;
    this.totals.geminiOutputTokens += partial.geminiOutputTokens ?? 0;
  }

  getSummary(): CostSummary {
    return summarizeCost(this.totals);
  }

  reset(): void {
    this.totals = createTokenUsageTotals();
    this.processedMessageIds.clear();
  }

  getTotals(): TokenUsageTotals {
    return { ...this.totals };
  }
}
