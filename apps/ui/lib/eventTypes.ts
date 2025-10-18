/**
 * Event Types
 *
 * Centralized event type definitions for pipeline streaming events.
 * Provides discriminated union types and type guards for each event type.
 */

import type { Step, StepStatus } from "./types";

/**
 * Status Event
 * Emitted when a pipeline step changes status
 */
export interface StatusEvent {
  step?: Step;
  status?: StepStatus;
  meta?: Record<string, unknown>;
  at?: string;
}

/**
 * Tool Use Event
 * Emitted when a tool is invoked
 */
export interface ToolUseEvent {
  id?: string;
  name?: string;
  startedAt?: string;
  inputSummary?: unknown;
}

/**
 * Tool Result Event
 * Emitted when a tool execution completes
 */
export interface ToolResultEvent {
  id?: string;
  name?: string;
  isError?: boolean;
  content?: unknown;
  finishedAt?: string;
  durationMs?: number;
}

/**
 * Draft Stream Events
 */
export interface DraftStreamResetEvent {
  at?: string;
}

export interface DraftStreamDeltaEvent {
  text?: string;
  seq?: number;
  length?: number;
  at?: string;
}

export interface DraftStreamCompleteEvent {
  total?: number;
  chunks?: number;
  at?: string;
}

export interface DraftPreviewChunkEvent {
  text?: string;
  index?: number;
  total?: number;
  at?: string;
}

export interface DraftPreviewCompleteEvent {
  total?: number;
  at?: string;
}

/**
 * Judge Round Event
 * Emitted when a review round completes
 */
export interface JudgeRoundEvent {
  approved?: boolean;
  reasons?: string[];
  required_changes?: string[];
  revised_draft?: string | null;
  round?: number;
  at?: string;
}

/**
 * Transcript Chunk Event
 * Emitted when transcript chunks are processed
 */
export interface TranscriptChunkEvent {
  transcript?: string;
  processedChunks?: number;
  totalChunks?: number;
  at?: string;
  meta?: {
    progressMode?: "explicit" | "heuristic";
  };
}

/**
 * Cost Event
 * Emitted when cost information is updated
 */
export interface CostEvent {
  summary?: {
    totalTokens?: number;
    estimatedCostUSD?: number;
    breakdown?: Record<string, unknown>;
  };
}

/**
 * Final Event
 * Emitted when the pipeline completes
 */
export interface FinalEvent {
  ok?: boolean;
  draft?: string;
  docx?: string;
  docxRelative?: string;
  at?: string;
}

/**
 * Generic Event
 * Catch-all for unknown events
 */
export interface GenericEvent {
  [key: string]: unknown;
}

/**
 * All Event Types
 * Discriminated union of all possible event types
 */
export type PipelineEvent =
  | { type: "status"; data: StatusEvent }
  | { type: "tool_use"; data: ToolUseEvent }
  | { type: "tool_result"; data: ToolResultEvent }
  | { type: "draft_stream_reset"; data: DraftStreamResetEvent }
  | { type: "draft_stream_delta"; data: DraftStreamDeltaEvent }
  | { type: "draft_stream_complete"; data: DraftStreamCompleteEvent }
  | { type: "draft_preview_chunk"; data: DraftPreviewChunkEvent }
  | { type: "draft_preview_complete"; data: DraftPreviewCompleteEvent }
  | { type: "judge_round"; data: JudgeRoundEvent }
  | { type: "transcript_chunk"; data: TranscriptChunkEvent }
  | { type: "cost"; data: CostEvent }
  | { type: "final"; data: FinalEvent }
  | { type: "todo"; data: GenericEvent }
  | { type: "error"; data: unknown };

/**
 * Type Guards
 */
export function isStatusEvent(data: unknown): data is StatusEvent {
  return (
    typeof data === "object" &&
    data !== null &&
    ("step" in data || "status" in data)
  );
}

export function isToolUseEvent(data: unknown): data is ToolUseEvent {
  return (
    typeof data === "object" &&
    data !== null &&
    "id" in data &&
    "name" in data
  );
}

export function isToolResultEvent(data: unknown): data is ToolResultEvent {
  return (
    typeof data === "object" &&
    data !== null &&
    "id" in data &&
    ("isError" in data || "content" in data)
  );
}

export function isJudgeRoundEvent(data: unknown): data is JudgeRoundEvent {
  return (
    typeof data === "object" &&
    data !== null &&
    "round" in data &&
    typeof (data as JudgeRoundEvent).round === "number"
  );
}

export function isTranscriptChunkEvent(
  data: unknown
): data is TranscriptChunkEvent {
  return (
    typeof data === "object" &&
    data !== null &&
    ("transcript" in data || "processedChunks" in data || "totalChunks" in data)
  );
}

export function isCostEvent(data: unknown): data is CostEvent {
  return (
    typeof data === "object" &&
    data !== null &&
    "summary" in data
  );
}

export function isFinalEvent(data: unknown): data is FinalEvent {
  return (
    typeof data === "object" &&
    data !== null &&
    "ok" in data
  );
}

/**
 * Extract text payload from various content formats
 */
export function extractTextPayload(payload: unknown): string | null {
  if (typeof payload === "string") {
    return payload;
  }
  if (Array.isArray(payload)) {
    for (const part of payload) {
      if (
        part &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text?: string }).text ?? null;
      }
    }
  }
  return null;
}
