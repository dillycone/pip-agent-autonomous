/**
 * Pipeline State Reducer
 *
 * Centralized state management logic for pipeline execution.
 * Handles all state transitions and event processing.
 */

import type { Step, StepStatus, TimelineItem, CostState } from "./types";
import type {
  StatusEvent,
  ToolUseEvent,
  ToolResultEvent,
  TranscriptChunkEvent,
  JudgeRoundEvent,
  CostEvent,
  FinalEvent,
  DraftStreamResetEvent,
  DraftStreamDeltaEvent,
  DraftStreamCompleteEvent,
  DraftPreviewChunkEvent,
  DraftPreviewCompleteEvent,
} from "./eventTypes";
import { DEFAULT_STEPS } from "./constants";
import { safeJsonParse, normalizeUsageMetrics } from "./utils";
import { extractTextPayload } from "./eventTypes";

export type DraftPreviewStatus = "idle" | "streaming" | "complete";

export type DraftUsageState = {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
} | null;

/**
 * Pipeline State
 */
export interface PipelineState {
  steps: Record<Step, StepStatus>;
  chunks: { processed: number; total: number };
  transcriptPreview: string;
  transcriptLines: string[];
  progressMode: "explicit" | "heuristic";
  draftPreviewLines: string[];
  draftPreviewStatus: DraftPreviewStatus;
  draftUsage: DraftUsageState;
  timeline: TimelineItem[];
  reviewRounds: Array<{
    round: number;
    approved: boolean;
    reasons: string[];
    requiredChanges: string[];
    at?: string;
  }>;
  finalDraft: string;
  docxPath: string;
  docxRelativePath: string;
  cost: CostState;
  transcribeStartedAt: number | null;
  transcribeEndedAt: number | null;
  uploadStartedAt: number | null;
  uploadCompletedAt: number | null;
}

/**
 * State Actions
 */
export type PipelineStateAction =
  | { type: "reset" }
  | { type: "status"; event: StatusEvent }
  | { type: "tool_use"; event: ToolUseEvent }
  | { type: "tool_result"; event: ToolResultEvent }
  | { type: "transcript_chunk"; event: TranscriptChunkEvent }
  | { type: "judge_round"; event: JudgeRoundEvent }
  | { type: "cost"; event: CostEvent }
  | { type: "final"; event: FinalEvent }
  | { type: "draft_stream_reset"; event: DraftStreamResetEvent }
  | { type: "draft_stream_delta"; event: DraftStreamDeltaEvent }
  | { type: "draft_stream_complete"; event: DraftStreamCompleteEvent }
  | { type: "draft_preview_chunk"; event: DraftPreviewChunkEvent }
  | { type: "draft_preview_complete"; event: DraftPreviewCompleteEvent }
  | { type: "stream_error" };

/**
 * Create initial pipeline state
 */
export function createInitialPipelineState(): PipelineState {
  return {
    steps: { ...DEFAULT_STEPS },
    chunks: { processed: 0, total: 0 },
    transcriptPreview: "",
    transcriptLines: [],
    progressMode: "heuristic",
    draftPreviewLines: [],
    draftPreviewStatus: "idle",
    draftUsage: null,
    timeline: [],
    reviewRounds: [],
    finalDraft: "",
    docxPath: "",
    docxRelativePath: "",
    cost: { tokens: 0, usd: 0, breakdown: {} },
    transcribeStartedAt: null,
    transcribeEndedAt: null,
    uploadStartedAt: null,
    uploadCompletedAt: null,
  };
}

/**
 * Pipeline State Reducer
 */
export function pipelineStateReducer(
  state: PipelineState,
  action: PipelineStateAction
): PipelineState {
  switch (action.type) {
    case "reset":
      return createInitialPipelineState();

    case "status":
      return handleStatusEvent(state, action.event);

    case "tool_use":
      return handleToolUseEvent(state, action.event);

    case "tool_result":
      return handleToolResultEvent(state, action.event);

    case "transcript_chunk":
      return handleTranscriptChunkEvent(state, action.event);

    case "judge_round":
      return handleJudgeRoundEvent(state, action.event);

    case "cost":
      return handleCostEvent(state, action.event);

    case "final":
      return handleFinalEvent(state, action.event);

    case "draft_stream_reset":
      return handleDraftStreamResetEvent(state, action.event);

    case "draft_stream_delta":
      return handleDraftStreamDeltaEvent(state, action.event);

    case "draft_stream_complete":
      return handleDraftStreamCompleteEvent(state, action.event);

    case "draft_preview_chunk":
      return handleDraftPreviewChunkEvent(state, action.event);

    case "draft_preview_complete":
      return handleDraftPreviewCompleteEvent(state, action.event);

    case "stream_error":
      return handleStreamError(state);

    default:
      return state;
  }
}

/**
 * Event Handlers
 */

function handleStatusEvent(
  state: PipelineState,
  event: StatusEvent
): PipelineState {
  const step = event.step as Step | undefined;
  const status = event.status as StepStatus | undefined;

  if (!step || !status) return state;

  const nextSteps: Record<Step, StepStatus> = { ...state.steps, [step]: status };
  let nextState: PipelineState = { ...state, steps: nextSteps };

  // Handle step-specific state transitions when status becomes "running"
  if (status === "running") {
    if (step === "transcribe") {
      const now = Date.now();
      nextState = {
        ...nextState,
        transcriptLines: [],
        transcriptPreview: "",
        chunks: { processed: 0, total: 0 },
        transcribeStartedAt: state.transcribeStartedAt ?? now,
        transcribeEndedAt: null,
        uploadStartedAt: state.uploadStartedAt ?? now,
      };
    }
    if (step === "draft") {
      nextState = {
        ...nextState,
        draftPreviewStatus: "streaming",
        draftPreviewLines: [],
        draftUsage: null,
      };
    }
    if (step === "review") {
      nextState = { ...nextState, reviewRounds: [] };
    }
  }

  // Handle step completion
  if ((status === "success" || status === "error") && step === "draft") {
    nextState = { ...nextState, draftPreviewStatus: "complete" };
  }

  if (step === "transcribe") {
    if (status === "running") {
      const now = Date.now();
      nextState = {
        ...nextState,
        transcribeStartedAt: state.transcribeStartedAt ?? now,
        transcribeEndedAt: null,
        uploadStartedAt: state.uploadStartedAt ?? now,
      };
    } else if (status === "success" || status === "error") {
      const now = Date.now();
      nextState = {
        ...nextState,
        transcribeEndedAt: state.transcribeEndedAt ?? now,
        uploadCompletedAt: state.uploadCompletedAt ?? now,
      };
    }
  }

  return nextState;
}

function handleToolUseEvent(
  state: PipelineState,
  event: ToolUseEvent
): PipelineState {
  if (!event.id || !event.name) return state;

  const phase: Step | "unknown" = event.name.includes("gemini-transcriber")
    ? "transcribe"
    : event.name.includes("pip-generator")
      ? "draft"
      : event.name.includes("docx-exporter")
        ? "export"
        : "unknown";

  const nextTimeline = [
    ...state.timeline,
    {
      id: event.id,
      name: event.name,
      phase,
      status: "running" as StepStatus,
      startedAt: event.startedAt,
      inputSummary: event.inputSummary,
    },
  ];

  // Keep timeline manageable
  if (nextTimeline.length > 500) {
    nextTimeline.splice(0, nextTimeline.length - 500);
  }

  return { ...state, timeline: nextTimeline };
}

function handleToolResultEvent(
  state: PipelineState,
  event: ToolResultEvent
): PipelineState {
  const isPipGenerator = Boolean(event.name?.includes("pip-generator"));
  const textPayload = isPipGenerator
    ? extractTextPayload(event.content)
    : null;
  const parsedPayload = isPipGenerator
    ? safeJsonParse<{ draft?: string; usage?: unknown; model?: unknown }>(
        textPayload ?? null
      )
    : null;
  const normalizedUsage =
    parsedPayload?.usage || parsedPayload?.model
      ? normalizeUsageMetrics(parsedPayload?.usage)
      : null;

  let nextState: PipelineState = { ...state };

  // Update timeline
  if (event.id) {
    nextState.timeline = state.timeline.map((t) =>
      t.id === event.id
        ? {
            ...t,
            status: event.isError ? "error" : "success",
            isError: event.isError,
            finishedAt: event.finishedAt,
            durationMs: event.durationMs,
            contentSummary: event.content,
          }
        : t
    );
  }

  // Handle pip-generator specific data
  if (isPipGenerator) {
    if (event.isError) {
      nextState.draftPreviewStatus = "complete";
    }
    if (parsedPayload?.usage || parsedPayload?.model) {
      nextState.draftUsage = {
        model:
          typeof parsedPayload?.model === "string"
            ? parsedPayload.model
            : normalizedUsage?.model,
        inputTokens: normalizedUsage?.inputTokens,
        outputTokens: normalizedUsage?.outputTokens,
        cacheCreationTokens: normalizedUsage?.cacheCreationTokens,
        cacheReadTokens: normalizedUsage?.cacheReadTokens,
      };
    }
    // Fallback draft preview if no streaming chunks were received
    if (parsedPayload?.draft) {
      const fallbackLines = parsedPayload.draft
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line): line is string => line.length > 0)
        .slice(0, 3);
      if (fallbackLines.length > 0) {
        nextState.draftPreviewLines = fallbackLines;
        nextState.draftPreviewStatus = "complete";
      }
    }
  }

  return nextState;
}

function handleTranscriptChunkEvent(
  state: PipelineState,
  event: TranscriptChunkEvent
): PipelineState {
  let processed = state.chunks.processed;
  let total = state.chunks.total;

  if (
    typeof event.processedChunks === "number" &&
    Number.isFinite(event.processedChunks)
  ) {
    processed = Math.max(processed, event.processedChunks);
  }
  if (
    (!processed || processed <= 0) &&
    typeof event.transcript === "string" &&
    event.transcript.trim()
  ) {
    processed = Math.max(processed, 1);
  }

  if (
    typeof event.totalChunks === "number" &&
    Number.isFinite(event.totalChunks)
  ) {
    total = Math.max(total, event.totalChunks);
  }
  if ((!total || total <= 0) && processed && processed > 0) {
    total = processed;
  }

  if (!Number.isFinite(processed) || processed < 0) processed = 0;
  if (!Number.isFinite(total) || total < 0) total = 0;

  let transcriptPreview = state.transcriptPreview;
  let transcriptLines = state.transcriptLines;

  if (typeof event.transcript === "string" && event.transcript.trim()) {
    transcriptPreview = event.transcript;
    transcriptLines = event.transcript
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line): line is string => line.length > 0)
      .slice(-3);
  }

  const metaMode = event.meta?.progressMode;
  const nextProgressMode: "explicit" | "heuristic" =
    metaMode === "explicit" || metaMode === "heuristic"
      ? metaMode
      : state.progressMode;

  return {
    ...state,
    transcriptPreview,
    transcriptLines,
    chunks: { processed, total },
    progressMode: nextProgressMode,
    uploadCompletedAt: state.uploadCompletedAt ?? Date.now(),
  };
}

function handleJudgeRoundEvent(
  state: PipelineState,
  event: JudgeRoundEvent
): PipelineState {
  if (typeof event.round !== "number") return state;

  const round = event.round;
  const filtered = state.reviewRounds.filter((item) => item.round !== round);
  const next = [
    ...filtered,
    {
      round,
      approved: Boolean(event.approved),
      reasons: Array.isArray(event.reasons)
        ? event.reasons.filter(
            (r): r is string => typeof r === "string" && r.trim().length > 0
          )
        : [],
      requiredChanges: Array.isArray(event.required_changes)
        ? event.required_changes.filter(
            (r): r is string => typeof r === "string" && r.trim().length > 0
          )
        : [],
      at: event.at,
    },
  ]
    .sort((a, b) => a.round - b.round)
    .slice(-4);

  return { ...state, reviewRounds: next };
}

function handleCostEvent(
  state: PipelineState,
  event: CostEvent
): PipelineState {
  if (!event.summary) return state;

  return {
    ...state,
    cost: {
      tokens: event.summary.totalTokens ?? 0,
      usd: event.summary.estimatedCostUSD ?? 0,
      breakdown: event.summary.breakdown ?? {},
    },
  };
}

function handleFinalEvent(
  state: PipelineState,
  event: FinalEvent
): PipelineState {
  if (!event.ok) return state;

  const finalText = event.draft ?? "";
  const hasContent = finalText.trim().length > 0;

  let nextState: PipelineState = {
    ...state,
    finalDraft: finalText,
    docxPath: event.docx ?? "",
    docxRelativePath: event.docxRelative ?? "",
  };

  if (hasContent) {
    const trailing = finalText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line): line is string => line.length > 0)
      .slice(-3);
    nextState = {
      ...nextState,
      draftPreviewLines: trailing,
      draftPreviewStatus: "complete",
    };
  }

  return nextState;
}

function handleDraftStreamResetEvent(
  state: PipelineState,
  _event: DraftStreamResetEvent
): PipelineState {
  return {
    ...state,
    draftPreviewStatus: "streaming",
    draftPreviewLines: [],
  };
}

function handleDraftStreamDeltaEvent(
  state: PipelineState,
  event: DraftStreamDeltaEvent
): PipelineState {
  if (typeof event.text !== "string" || event.text.length === 0) return state;

  // This is handled externally via ref in the component
  // We just update the preview status
  return {
    ...state,
    draftPreviewStatus: "streaming",
  };
}

function handleDraftStreamCompleteEvent(
  state: PipelineState,
  _event: DraftStreamCompleteEvent
): PipelineState {
  return {
    ...state,
    draftPreviewStatus: "complete",
  };
}

function handleDraftPreviewChunkEvent(
  state: PipelineState,
  event: DraftPreviewChunkEvent
): PipelineState {
  if (!event.text) return state;

  const nextLines = [...state.draftPreviewLines];
  const text = event.text;

  if (typeof event.index === "number" && event.index >= 0) {
    nextLines[event.index] = text;
  } else {
    nextLines.push(text);
  }

  const filtered = nextLines
    .filter((line): line is string => typeof line === "string" && line.length > 0)
    .slice(-3);

  return {
    ...state,
    draftPreviewStatus: "streaming",
    draftPreviewLines: filtered,
  };
}

function handleDraftPreviewCompleteEvent(
  state: PipelineState,
  _event: DraftPreviewCompleteEvent
): PipelineState {
  return {
    ...state,
    draftPreviewStatus: "complete",
  };
}

function handleStreamError(state: PipelineState): PipelineState {
  const nextSteps: Record<Step, StepStatus> = { ...state.steps };
  (Object.keys(nextSteps) as Step[]).forEach((step) => {
    if (nextSteps[step] === "running") {
      nextSteps[step] = "error";
    }
  });
  return { ...state, steps: nextSteps };
}

/**
 * Progress Calculation
 */
export function computeOverallProgress(state: {
  steps: Record<Step, StepStatus>;
  chunks: { processed: number; total: number };
  draftPreviewStatus: DraftPreviewStatus;
  reviewRounds: Array<{
    round: number;
    approved: boolean;
    reasons: string[];
    requiredChanges: string[];
    at?: string;
  }>;
}): number {
  // Weighted blend algorithm:
  // - Transcribe: 50% weight based on chunks processed
  // - Draft: 25% weight based on streaming status
  // - Review: 15% weight based on rounds completed (max 4)
  // - Export: 10% weight based on step status

  // Transcribe progress: 0→50% based on chunks processed
  const transcribeProgress = (() => {
    const status = state.steps.transcribe;
    if (status === "success" || status === "error") return 50;
    if (status === "running") {
      if (!state.chunks.total || state.chunks.total <= 0) return 0;
      const ratio = state.chunks.processed / state.chunks.total;
      return Math.min(50, Math.round(ratio * 50));
    }
    return 0;
  })();

  // Draft progress: 0→25% based on streaming status
  const draftProgress = (() => {
    const status = state.steps.draft;
    if (status === "success" || status === "error") return 25;
    if (status === "running") {
      if (state.draftPreviewStatus === "streaming") return 20;
      if (state.draftPreviewStatus === "complete") return 25;
      return 10;
    }
    return 0;
  })();

  // Review progress: 0→15% based on rounds completed (max 4 rounds)
  const reviewProgress = (() => {
    const status = state.steps.review;
    if (status === "success" || status === "error") return 15;
    if (status === "running") {
      const roundCount = Math.min(state.reviewRounds.length, 4);
      return Math.round((roundCount / 4) * 15);
    }
    return 0;
  })();

  // Export progress: 0→10%
  const exportProgress = (() => {
    const status = state.steps.export;
    if (status === "success" || status === "error") return 10;
    if (status === "running") return 5;
    return 0;
  })();

  return Math.round(
    transcribeProgress + draftProgress + reviewProgress + exportProgress
  );
}
