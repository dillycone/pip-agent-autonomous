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

const USAGE_DEDUPE_BUCKET_MS = 15_000;
const MAX_USAGE_HASH_ENTRIES = 2_000;

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value > 1e9 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > 1e12 ? numeric : numeric > 1e9 ? numeric * 1000 : numeric;
    }
  }
  return null;
}

function getMessageTimestamp(message: SDKMessage): number | null {
  const candidates: unknown[] = [
    (message as { timestamp?: unknown }).timestamp,
    (message as { created_at?: unknown }).created_at,
    (message as { createdAt?: unknown }).createdAt,
    (message as { at?: unknown }).at
  ];
  for (const value of candidates) {
    const parsed = parseTimestamp(value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

export function recordUsageFromMessage(
  totals: TokenUsageTotals,
  message: SDKMessage
): void {
  if (!hasUsage(message)) {
    return;
  }

  const usage = message.usage;
  if (!usage) return;

  totals.inputTokens += usage.input_tokens || 0;
  totals.outputTokens += usage.output_tokens || 0;
  totals.cacheCreationTokens += usage.cache_creation_input_tokens || 0;
  totals.cacheReadTokens += usage.cache_read_input_tokens || 0;
}

export class TokenCostTracker {
  private totals: TokenUsageTotals = createTokenUsageTotals();
  private processedMessageIds = new Set<string>();
  private processedUsageHashes = new Set<string>();
  private usageHashQueue: string[] = [];

  recordMessage(message: SDKMessage): void {
    const messageId = (message as { id?: string }).id || (message as { messageId?: string }).messageId;
    if (messageId && this.processedMessageIds.has(messageId)) {
      return;
    }
    if (messageId) {
      this.processedMessageIds.add(messageId);
    } else if (hasUsage(message) && message.usage) {
      const usageKey = JSON.stringify(message.usage);
      if (usageKey) {
        const timestamp = getMessageTimestamp(message) ?? Date.now();
        const bucket = Math.floor(timestamp / USAGE_DEDUPE_BUCKET_MS);
        const dedupeKey = hashString(`${bucket}:${usageKey}`);
        if (this.processedUsageHashes.has(dedupeKey)) {
          return;
        }
        this.processedUsageHashes.add(dedupeKey);
        this.usageHashQueue.push(dedupeKey);
        if (this.usageHashQueue.length > MAX_USAGE_HASH_ENTRIES) {
          const oldest = this.usageHashQueue.shift();
          if (oldest) {
            this.processedUsageHashes.delete(oldest);
          }
        }
      }
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
    this.processedUsageHashes.clear();
    this.usageHashQueue = [];
  }

  getTotals(): TokenUsageTotals {
    return { ...this.totals };
  }
}
