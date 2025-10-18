/**
 * Event Handlers Module
 *
 * This module extracts event handling logic from the main runCore function.
 * Each handler is a pure function that processes specific event types and
 * returns updated state or performs necessary side effects.
 *
 * Event types handled:
 * - ToolUseEvent: When the agent starts using a tool
 * - ToolResultEvent: When a tool completes with results
 * - TextDeltaEvent: Streaming text chunks from the assistant
 * - ContentBlockDeltaEvent: Content block updates
 * - ContentBlockStopEvent: End of content block
 * - Judge verdict events: Policy review decisions
 */

import { extractToolUsage } from "../utils/toolUsage.js";
import type { PipelineHandlers } from "./runPipeline.js";

export type Step = "transcribe" | "draft" | "review" | "export";
export type StepStatus = "pending" | "running" | "success" | "error";

export interface EventHandlerContext {
  emit: PipelineHandlers["emit"];
  sendStatus: (step: Step, status: StepStatus, meta?: Record<string, unknown>) => void;
  costTracker: {
    recordTotals: (tokens: {
      inputTokens?: number;
      outputTokens?: number;
      cacheCreationTokens?: number;
      cacheReadTokens?: number;
      geminiInputTokens?: number;
      geminiOutputTokens?: number;
    }) => void;
  };
  pushCost: () => void;
  updateDraftModel: (candidate: unknown) => void;
  logJsonParseFailure: (source: string, raw: string, error: unknown) => void;
}

export interface TranscriptionState {
  transcribeProcessed: number;
  transcribeTotal: number | null;
  transcriptAccumulator: string;
  chunkSnippets: Map<number, string>;
  processedProgressSource: "explicit" | "heuristic";
  totalProgressSource: "explicit" | "heuristic";
}

export interface DraftState {
  draftPreviewEmitted: boolean;
  previewTimeouts: NodeJS.Timeout[];
}

export interface JudgeState {
  judgeRound: number;
  maxRounds: number;
}

export interface InflightTracking {
  inflightMap: Map<string, { id: string; name?: string; startedAt: string }>;
  pushInflight: (candidateId: string | undefined, name?: string) => { id: string; name?: string; startedAt: string };
  takeInflight: (candidateId?: string, name?: string) => { id: string; name?: string; startedAt: string } | undefined;
}

/**
 * Handles tool_use events when the agent starts using a tool
 *
 * @param toolUse - The tool use block from the message
 * @param context - Event handler context with emit and state functions
 * @param inflight - Inflight tracking for matching tool results
 * @param draftStreamingEnabled - Whether draft streaming is enabled
 * @param emitDraftStreamEvent - Function to emit draft stream events
 * @param runId - Current pipeline run ID
 */
export function handleToolUseEvent(
  toolUse: { id: string; name: string; input: unknown },
  context: EventHandlerContext,
  inflight: InflightTracking,
  draftStreamingEnabled: boolean,
  emitDraftStreamEvent?: (event: "delta" | "complete" | "reset", data: Record<string, unknown>) => void,
  runId?: string
): void {
  const item = inflight.pushInflight(
    typeof toolUse.id === "string" ? toolUse.id : undefined,
    toolUse.name
  );

  context.emit("tool_use", {
    id: item.id,
    name: toolUse.name,
    startedAt: item.startedAt,
    inputSummary: toolUse.input
  });

  // Update step status based on tool name
  if (toolUse.name.includes("gemini-transcriber")) {
    context.sendStatus("transcribe", "running");
  } else if (toolUse.name.includes("pip-generator")) {
    context.sendStatus("transcribe", "success");
    context.sendStatus("draft", "running");

    if (draftStreamingEnabled && emitDraftStreamEvent && runId) {
      emitDraftStreamEvent("reset", { at: new Date().toISOString(), runId });
    }

    // Extract draft model from input if available
    if (toolUse.input && typeof toolUse.input === "object" && !Array.isArray(toolUse.input)) {
      const maybeModel = (toolUse.input as { model?: unknown }).model;
      context.updateDraftModel(maybeModel);
    }
  } else if (toolUse.name.includes("docx-exporter")) {
    context.sendStatus("draft", "success");
    context.sendStatus("review", "success");
    context.sendStatus("export", "running");
  }

  // Handle TodoWrite tool for progress tracking
  if (toolUse.name === "TodoWrite" && toolUse.input && typeof toolUse.input === "object") {
    const todos = (toolUse.input as { todos?: unknown }).todos;
    if (Array.isArray(todos)) {
      context.emit("todo", { todos });
    }
  }
}

/**
 * Handles tool_result events when a tool completes
 *
 * @param resultData - Tool result data
 * @param context - Event handler context
 * @param inflight - Inflight tracking
 * @param transcriptionState - Current transcription state
 * @param draftState - Current draft state
 * @param draftStreamingEnabled - Whether draft streaming is enabled
 * @returns Updated transcription and draft states
 */
export function handleToolResultEvent(
  resultData: {
    id?: string;
    name?: string;
    isError?: boolean;
    content?: unknown;
  },
  context: EventHandlerContext,
  inflight: InflightTracking,
  transcriptionState: TranscriptionState,
  draftState: DraftState,
  draftStreamingEnabled: boolean
): { transcriptionState: TranscriptionState; draftState: DraftState } {
  const finishedAt = new Date().toISOString();
  const inflightItem = inflight.takeInflight(
    typeof resultData.id === "string" ? resultData.id : undefined,
    resultData.name
  );

  const fallbackToolId = (name?: string) =>
    `${name || "tool"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const id =
    inflightItem?.id ??
    (typeof resultData.id === "string" && resultData.id.trim().length > 0
      ? resultData.id
      : fallbackToolId(resultData.name));

  const startedAt = inflightItem?.startedAt;
  const durationMs = startedAt ? Date.parse(finishedAt) - Date.parse(startedAt) : undefined;

  context.emit("tool_result", {
    id,
    name: resultData.name,
    isError: resultData.isError,
    content: resultData.content,
    finishedAt,
    durationMs
  });

  const name = resultData.name;

  // Update step status based on tool completion
  if (name?.includes("gemini-transcriber")) {
    if (resultData.isError) {
      context.sendStatus("transcribe", "error");
    } else {
      context.sendStatus("transcribe", "success");
      context.sendStatus("draft", "running");
      draftState.draftPreviewEmitted = false;
    }
  } else if (name?.includes("pip-generator")) {
    if (resultData.isError) {
      context.sendStatus("draft", "error");
    } else {
      context.sendStatus("draft", "success");
      context.sendStatus("review", "running");
    }
  } else if (name?.includes("docx-exporter")) {
    if (resultData.isError) {
      context.sendStatus("export", "error");
    } else {
      context.sendStatus("review", "success");
      context.sendStatus("export", "success");
    }
  }

  // Extract and record token usage if available
  const payload = resultData.content;
  if (!resultData.isError) {
    const usage = extractToolUsage(payload);
    if (usage) {
      const provider = usage.provider?.toLowerCase();
      const isGeminiTool = name?.includes("gemini-transcriber") || provider === "gemini";

      if (isGeminiTool) {
        if (usage.inputTokens > 0 || usage.outputTokens > 0) {
          context.costTracker.recordTotals({
            geminiInputTokens: usage.inputTokens,
            geminiOutputTokens: usage.outputTokens
          });
          context.pushCost();
        }
      } else {
        if (
          usage.inputTokens > 0 ||
          usage.outputTokens > 0 ||
          usage.cacheCreationTokens > 0 ||
          usage.cacheReadTokens > 0
        ) {
          context.costTracker.recordTotals({
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheCreationTokens: usage.cacheCreationTokens,
            cacheReadTokens: usage.cacheReadTokens
          });
          context.pushCost();
        }
      }
    }
  }

  // Parse tool result content for transcription/draft data
  const textPart = Array.isArray(payload)
    ? payload.find((item) => typeof item?.text === "string")?.text
    : typeof payload === "string"
      ? payload
      : null;

  if (typeof textPart === "string") {
    try {
      const parsed = JSON.parse(textPart) as {
        transcript?: string;
        draft?: string;
        processedChunks?: number;
        totalChunks?: number;
        startChunk?: number;
        nextChunk?: number | null;
        segments?: Array<{ text?: unknown }>;
        model?: unknown;
        usage?: unknown;
      };

      // Extract draft model if available
      if (name?.includes("pip-generator")) {
        const directModel = typeof parsed.model === "string" ? parsed.model : undefined;
        if (directModel) {
          context.updateDraftModel(directModel);
        } else if (parsed.usage && typeof parsed.usage === "object" && !Array.isArray(parsed.usage)) {
          const usageModel = (parsed.usage as { model?: unknown }).model;
          context.updateDraftModel(usageModel);
        }
      }

      // Handle draft preview (non-streaming mode)
      if (
        !draftStreamingEnabled &&
        !resultData.isError &&
        name?.includes("pip-generator") &&
        !draftState.draftPreviewEmitted
      ) {
        const draftText = typeof parsed.draft === "string" ? parsed.draft.trim() : "";
        if (draftText) {
          draftState.draftPreviewEmitted = true;
          const snippetLines = draftText
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line): line is string => line.length > 0)
            .slice(0, 3);

          snippetLines.forEach((line, idx) => {
            const timeout = setTimeout(() => {
              context.emit("draft_preview_chunk", {
                text: line,
                index: idx,
                total: snippetLines.length,
                at: new Date().toISOString()
              });
            }, idx * 120);
            draftState.previewTimeouts.push(timeout);
          });

          const completionDelay = snippetLines.length * 120 + 80;
          draftState.previewTimeouts.push(
            setTimeout(() => {
              context.emit("draft_preview_complete", {
                total: snippetLines.length,
                at: new Date().toISOString()
              });
            }, completionDelay)
          );
        }
      }

      // Update transcription progress
      const updatedTranscriptionState = updateTranscriptionProgress(
        parsed,
        transcriptionState,
        context
      );
      transcriptionState = updatedTranscriptionState;
    } catch (error: unknown) {
      context.logJsonParseFailure("tool_result_content", textPart, error);
    }
  }

  // Handle tool errors
  if (resultData.isError) {
    const sanitized = sanitizeError(resultData.content);
    const { stack, ...rest } = sanitized;
    context.emit("error", {
      message: "Tool error",
      details: rest
    });
  }

  return { transcriptionState, draftState };
}

/**
 * Updates transcription progress based on parsed tool result
 *
 * @param parsed - Parsed JSON from tool result
 * @param state - Current transcription state
 * @param context - Event handler context
 * @returns Updated transcription state
 */
function updateTranscriptionProgress(
  parsed: {
    transcript?: string;
    processedChunks?: number;
    totalChunks?: number;
    startChunk?: number;
    nextChunk?: number | null;
    segments?: Array<{ text?: unknown }>;
  },
  state: TranscriptionState,
  context: EventHandlerContext
): TranscriptionState {
  const newState = { ...state };

  // Update total chunks
  if (typeof parsed.totalChunks === "number" && parsed.totalChunks > 0) {
    newState.transcribeTotal = Math.max(newState.transcribeTotal ?? 0, parsed.totalChunks);
    newState.totalProgressSource = "explicit";
  }

  // Update processed chunks
  if (typeof parsed.processedChunks === "number") {
    const start =
      typeof parsed.startChunk === "number" ? parsed.startChunk : newState.transcribeProcessed;
    const candidateProcessed = start + parsed.processedChunks;
    newState.transcribeProcessed = Math.max(newState.transcribeProcessed, candidateProcessed);
    newState.processedProgressSource = "explicit";
  }

  // Update from startChunk if no processedChunks
  if (typeof parsed.startChunk === "number" && typeof parsed.processedChunks !== "number") {
    newState.transcribeProcessed = Math.max(newState.transcribeProcessed, parsed.startChunk);
    newState.processedProgressSource = "explicit";
  }

  // Update from nextChunk
  if (typeof parsed.nextChunk === "number") {
    const inferredTotal = parsed.nextChunk + 1;
    newState.transcribeTotal = Math.max(newState.transcribeTotal ?? 0, inferredTotal);
    newState.totalProgressSource = "explicit";
  } else if (
    parsed.nextChunk === null &&
    newState.transcribeTotal === null &&
    newState.transcribeProcessed > 0
  ) {
    newState.transcribeTotal = newState.transcribeProcessed;
    newState.totalProgressSource = "heuristic";
  }

  // Extract transcript text
  const rawTranscript = typeof parsed.transcript === "string" ? parsed.transcript : "";
  let transcriptText = rawTranscript.trim();

  if (!transcriptText && Array.isArray(parsed.segments)) {
    transcriptText = parsed.segments
      .map((seg) => {
        if (!seg || typeof seg !== "object") return "";
        const text = (seg as { text?: unknown }).text;
        return typeof text === "string" ? text.trim() : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  // Heuristic fallbacks for progress
  if (newState.transcribeProcessed === 0 && transcriptText) {
    newState.transcribeProcessed = 1;
    newState.processedProgressSource = "heuristic";
  }
  if (newState.transcribeTotal === null && transcriptText) {
    newState.transcribeTotal = newState.transcribeProcessed > 0 ? newState.transcribeProcessed : 1;
    newState.totalProgressSource = "heuristic";
  }

  // Update transcript accumulator and emit progress
  if (transcriptText) {
    if (typeof parsed.startChunk === "number") {
      newState.chunkSnippets.set(parsed.startChunk, transcriptText);
      const ordered = Array.from(newState.chunkSnippets.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, text]) => text.trim())
        .filter(Boolean);
      newState.transcriptAccumulator = ordered.join("\n\n");
    } else {
      newState.transcriptAccumulator = transcriptText;
    }

    const preview = (newState.transcriptAccumulator || transcriptText).slice(0, 1500);
    const transcriptEvent: Record<string, unknown> = {
      transcript: preview,
      processedChunks: newState.transcribeProcessed || 1,
      totalChunks: newState.transcribeTotal ?? (newState.transcribeProcessed || 1),
      at: new Date().toISOString()
    };

    if (
      newState.processedProgressSource === "heuristic" ||
      newState.totalProgressSource === "heuristic"
    ) {
      transcriptEvent.meta = { progressMode: "heuristic" as const };
    }

    context.emit("transcript_chunk", transcriptEvent);
  } else if (newState.transcribeProcessed > 0 || newState.transcribeTotal !== null) {
    const transcriptEvent: Record<string, unknown> = {
      processedChunks: newState.transcribeProcessed || undefined,
      totalChunks: newState.transcribeTotal ?? undefined,
      at: new Date().toISOString()
    };

    if (
      newState.processedProgressSource === "heuristic" ||
      newState.totalProgressSource === "heuristic"
    ) {
      transcriptEvent.meta = { progressMode: "heuristic" as const };
    }

    context.emit("transcript_chunk", transcriptEvent);
  }

  return newState;
}

/**
 * Handles policy judge verdict events from streaming content
 *
 * @param candidate - Extracted JSON candidate string
 * @param judgeState - Current judge state
 * @param context - Event handler context
 * @returns Updated judge state
 */
export function handleJudgeVerdictEvent(
  candidate: string,
  judgeState: JudgeState,
  context: EventHandlerContext
): JudgeState {
  if (judgeState.judgeRound >= judgeState.maxRounds) {
    return judgeState;
  }

  try {
    const verdict = JSON.parse(candidate) as {
      approved?: boolean;
      reasons?: string[];
      required_changes?: string[];
      revised_draft?: string | null;
    };

    if (typeof verdict.approved === "boolean") {
      const newRound = judgeState.judgeRound + 1;

      context.emit("judge_round", {
        approved: verdict.approved,
        reasons: verdict.reasons ?? [],
        required_changes: verdict.required_changes ?? [],
        revised_draft: verdict.revised_draft ?? null,
        round: newRound,
        at: new Date().toISOString()
      });

      const reviewStatus = verdict.approved
        ? "success"
        : newRound >= judgeState.maxRounds
          ? "error"
          : "running";

      context.sendStatus("review", reviewStatus, { round: newRound });

      return { ...judgeState, judgeRound: newRound };
    }
  } catch (error: unknown) {
    context.logJsonParseFailure("policy_judge_verdict", candidate, error);
  }

  return judgeState;
}

/**
 * Extracts JSON blocks from streaming text content
 *
 * @param raw - Raw content to extract JSON from
 * @returns Extracted JSON string or null
 */
export function extractJsonBlock(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = trimmed.slice(start, end + 1).trim();
    if (candidate.startsWith("{") && candidate.endsWith("}")) {
      return candidate;
    }
  }

  return null;
}

/**
 * Sanitizes errors for safe serialization
 *
 * @param error - Error to sanitize
 * @returns Sanitized error object
 */
function sanitizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  if (error && typeof error === "object") {
    return error as Record<string, unknown>;
  }
  return { message: String(error) };
}
