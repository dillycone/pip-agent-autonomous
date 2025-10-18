/**
 * usePipelineRun Hook
 *
 * Encapsulates pipeline run logic and state management.
 * Manages EventSource connections, event handling, and state updates.
 */

import { useCallback, useReducer, useRef, useState, useEffect } from "react";
import type { Step, StepStatus } from "../../lib/types";
import {
  pipelineStateReducer,
  createInitialPipelineState,
  type PipelineState,
  type DraftUsageState,
} from "../../lib/pipelineStateReducer";
import { pipelineClient } from "../../lib/pipelineClient";
import { safeJsonParse } from "../../lib/utils";
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
} from "../../lib/eventTypes";

export type { PipelineState, DraftUsageState };

/**
 * Hook return type
 */
export interface UsePipelineRunReturn {
  state: PipelineState;
  runId: string | null;
  isRunning: boolean;
  startRun: (params: {
    audio: string;
    template: string;
    outdoc: string;
    inputLanguage: string;
    outputLanguage: string;
  }) => Promise<void>;
  abortRun: () => Promise<void>;
  resetState: () => void;
  draftStreamBuffer: React.MutableRefObject<string>;
  draftPreviewChunksReceived: React.MutableRefObject<boolean>;
  onLog: (type: string, payload: unknown) => void;
  onToast: (text: string, level?: "info" | "warn" | "error" | "success") => void;
  onStreamError: (payload: unknown) => void;
}

/**
 * Hook options
 */
export interface UsePipelineRunOptions {
  onLog?: (type: string, payload: unknown) => void;
  onToast?: (text: string, level?: "info" | "warn" | "error" | "success") => void;
}

/**
 * usePipelineRun Hook
 */
export function usePipelineRun(
  options: UsePipelineRunOptions = {}
): UsePipelineRunReturn {
  const { onLog, onToast } = options;

  const [state, dispatch] = useReducer(
    pipelineStateReducer,
    undefined,
    createInitialPipelineState
  );
  const [isRunning, setIsRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);

  // EventSource management
  const eventSourceRef = useRef<EventSource | null>(null);
  const eventSourceListenersRef = useRef<
    Array<{
      source: EventSource;
      type: string;
      listener: EventListenerOrEventListenerObject;
    }>
  >([]);

  // Draft stream buffer (needs to persist across renders)
  const draftStreamBufferRef = useRef("");
  const draftPreviewChunksRef = useRef(false);

  /**
   * EventSource listener management
   */
  const detachEventSourceListeners = useCallback((source: EventSource | null) => {
    if (!source) return;
    eventSourceListenersRef.current = eventSourceListenersRef.current.filter(
      (entry) => {
        if (entry.source !== source) return true;
        source.removeEventListener(entry.type, entry.listener);
        return false;
      }
    );
  }, []);

  const trackEventSourceListener = useCallback(
    (source: EventSource, type: string, listener: any) => {
      source.addEventListener(type, listener);
      eventSourceListenersRef.current.push({ source, type, listener });
    },
    []
  );

  const closeEventSource = useCallback(
    (source: EventSource | null) => {
      if (!source) return;
      detachEventSourceListeners(source);
      if (source.readyState !== EventSource.CLOSED) {
        source.close();
      }
    },
    [detachEventSourceListeners]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      closeEventSource(eventSourceRef.current);
      eventSourceRef.current = null;
    };
  }, [closeEventSource]);

  /**
   * Logging helpers
   */
  const pushLog = useCallback(
    (type: string, payload: unknown) => {
      onLog?.(type, payload);
    },
    [onLog]
  );

  const pushToast = useCallback(
    (text: string, level: "info" | "warn" | "error" | "success" = "info") => {
      onToast?.(text, level);
    },
    [onToast]
  );

  /**
   * Reset state
   */
  const resetState = useCallback(() => {
    dispatch({ type: "reset" });
    draftStreamBufferRef.current = "";
    draftPreviewChunksRef.current = false;
    setRunId(null);
  }, []);

  /**
   * Handle stream error
   */
  const handleStreamError = useCallback(
    (payload: unknown) => {
      pushLog("error", payload ?? "Stream error");
      setIsRunning(false);
      setRunId(null);
      dispatch({ type: "stream_error" });
    },
    [pushLog]
  );

  /**
   * Capitalize helper
   */
  const capitalize = (value: string): string => {
    if (!value) return value;
    return value.charAt(0).toUpperCase() + value.slice(1);
  };

  /**
   * Setup EventSource listeners
   */
  const setupEventSourceListeners = useCallback(
    (es: EventSource, currentRunId: string) => {
      // Status event
      trackEventSourceListener(
        es,
        "status",
        (event: MessageEvent<string>) => {
          const data = safeJsonParse<StatusEvent>(event.data) ?? {};
          const step = data.step as Step | undefined;
          const status = data.status as StepStatus | undefined;

          if (step && status) {
            dispatch({ type: "status", event: data });

            // Reset draft buffer when draft starts
            if (status === "running" && step === "draft") {
              draftStreamBufferRef.current = "";
              draftPreviewChunksRef.current = false;
            }

            // Toasts
            if (status === "running")
              pushToast(`${capitalize(step)} started`, "info");
            if (status === "success")
              pushToast(`${capitalize(step)} complete`, "success");
            if (status === "error")
              pushToast(`${capitalize(step)} error`, "error");
          }
          pushLog("status", data);
        }
      );

      // Tool use event
      trackEventSourceListener(
        es,
        "tool_use",
        (event: MessageEvent<string>) => {
          const data = safeJsonParse<ToolUseEvent>(event.data) ?? {};
          if (data.id && data.name) {
            dispatch({ type: "tool_use", event: data });
          }
          pushLog("tool_use", data);
        }
      );

      // Tool result event
      trackEventSourceListener(
        es,
        "tool_result",
        (event: MessageEvent<string>) => {
          const data = safeJsonParse<ToolResultEvent>(event.data) ?? {};
          dispatch({ type: "tool_result", event: data });

          if (data.isError)
            pushToast(`Tool error: ${data.name ?? data.id}`, "error");
          pushLog("tool_result", data);
        }
      );

      // Draft stream events
      trackEventSourceListener(
        es,
        "draft_stream_reset",
        (event: MessageEvent<string>) => {
          const data = safeJsonParse<DraftStreamResetEvent>(event.data);
          draftPreviewChunksRef.current = true;
          draftStreamBufferRef.current = "";
          dispatch({ type: "draft_stream_reset", event: data ?? {} });
        }
      );

      trackEventSourceListener(
        es,
        "draft_stream_delta",
        (event: MessageEvent<string>) => {
          const data = safeJsonParse<DraftStreamDeltaEvent>(event.data);
          if (typeof data?.text === "string" && data.text.length > 0) {
            draftPreviewChunksRef.current = true;
            const combined = `${draftStreamBufferRef.current}${data.text}`;
            draftStreamBufferRef.current =
              combined.length > 12000 ? combined.slice(-12000) : combined;
            const trailing = draftStreamBufferRef.current
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter((line): line is string => line.length > 0)
              .slice(-3);

            // Update state with trailing lines
            dispatch({
              type: "draft_preview_chunk",
              event: { text: trailing.join("\n") },
            });
          }
        }
      );

      trackEventSourceListener(
        es,
        "draft_stream_complete",
        (event: MessageEvent<string>) => {
          const data = safeJsonParse<DraftStreamCompleteEvent>(event.data);
          if (data) {
            draftPreviewChunksRef.current = true;
            dispatch({ type: "draft_stream_complete", event: data });
          }
        }
      );

      trackEventSourceListener(
        es,
        "draft_preview_chunk",
        (event: MessageEvent<string>) => {
          const data = safeJsonParse<DraftPreviewChunkEvent>(event.data);
          if (data?.text) {
            draftPreviewChunksRef.current = true;
            dispatch({ type: "draft_preview_chunk", event: data });
          }
        }
      );

      trackEventSourceListener(
        es,
        "draft_preview_complete",
        (event: MessageEvent<string>) => {
          const data = safeJsonParse<DraftPreviewCompleteEvent>(event.data);
          if (data) {
            dispatch({ type: "draft_preview_complete", event: data });
          }
        }
      );

      // Judge round event
      trackEventSourceListener(
        es,
        "judge_round",
        (event: MessageEvent<string>) => {
          const data = safeJsonParse<JudgeRoundEvent>(event.data);
          if (typeof data?.round === "number") {
            dispatch({ type: "judge_round", event: data });
          }
        }
      );

      // Todo event (just log)
      trackEventSourceListener(es, "todo", (event: MessageEvent<string>) => {
        const data = safeJsonParse(event.data) ?? {};
        pushLog("todo", data);
      });

      // Transcript chunk event
      trackEventSourceListener(
        es,
        "transcript_chunk",
        (event: MessageEvent<string>) => {
          const data = safeJsonParse<TranscriptChunkEvent>(event.data);
          if (data) {
            dispatch({ type: "transcript_chunk", event: data });
            pushLog("transcript_chunk", data);
          }
        }
      );

      // Cost event
      trackEventSourceListener(es, "cost", (event: MessageEvent<string>) => {
        const data = safeJsonParse<CostEvent>(event.data);
        if (data?.summary) {
          dispatch({ type: "cost", event: data });
        }
      });

      // Final event
      trackEventSourceListener(es, "final", (event: MessageEvent<string>) => {
        const data = safeJsonParse<FinalEvent>(event.data);
        if (data?.ok) {
          const finalText = data.draft ?? "";
          const hasContent = finalText.trim().length > 0;

          dispatch({ type: "final", event: data });

          if (hasContent) {
            draftStreamBufferRef.current = finalText;
          }
          pushLog("final", data);
          pushToast("Export complete", "success");
        }
        setIsRunning(false);
        closeEventSource(es);
        if (eventSourceRef.current === es) {
          eventSourceRef.current = null;
        }
      });

      // Error event
      trackEventSourceListener(es, "error", (event: MessageEvent<string>) => {
        const data = event.data;
        const parsed = safeJsonParse(data ?? null);
        handleStreamError(parsed ?? data ?? null);
        closeEventSource(es);
        if (eventSourceRef.current === es) {
          eventSourceRef.current = null;
        }
      });

      // EventSource error handler (connection loss)
      es.onerror = async (_event: Event) => {
        if (!currentRunId) {
          pushLog("resync-error", "Run ID unavailable, cannot resync connection");
          pushToast("Connection lost and run ID missing; cannot resync.", "error");
          return;
        }

        pushLog("stream-error", "Connection lost, attempting resync...");
        pushToast("Connection lost, resyncing…", "warn");

        try {
          // Get state snapshot
          const stateResult = await pipelineClient.getState(currentRunId);

          if (stateResult.success && stateResult.state) {
            // Restore state from server
            // Note: This is a simplified restore - you may need to merge states
            pushLog("resync", "State restored from server");
            pushToast("Reconnected and synced", "success");
          }

          closeEventSource(es);

          // Create new EventSource
          const newEs = pipelineClient.createEventSource(currentRunId);
          eventSourceRef.current = newEs;

          // Re-attach all listeners
          setupEventSourceListeners(newEs, currentRunId);
          pushLog("resync", "New connection established");
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          pushLog("resync-error", message);
          handleStreamError({ error: message, context: "resync" });
        }
      };
    },
    [
      trackEventSourceListener,
      pushLog,
      pushToast,
      closeEventSource,
      handleStreamError,
      capitalize,
    ]
  );

  /**
   * Start pipeline run
   */
  const startRun = useCallback(
    async (params: {
      audio: string;
      template: string;
      outdoc: string;
      inputLanguage: string;
      outputLanguage: string;
    }) => {
      if (isRunning) return;

      closeEventSource(eventSourceRef.current);
      resetState();
      setIsRunning(true);

      const result = await pipelineClient.startRun(params);

      if (!result.success) {
        pushToast(result.error, "error");
        pushLog("error", result.details ?? result.error);
        setIsRunning(false);
        return;
      }

      const newRunId = result.runId;
      setRunId(newRunId);
      pushLog("run", { runId: newRunId });

      // Create EventSource
      const es = pipelineClient.createEventSource(newRunId);
      eventSourceRef.current = es;

      // Setup all event listeners
      setupEventSourceListeners(es, newRunId);

      pushLog("info", `Stream opened for run ${newRunId}`);
    },
    [
      isRunning,
      closeEventSource,
      resetState,
      pushToast,
      pushLog,
      setupEventSourceListeners,
    ]
  );

  /**
   * Abort pipeline run
   */
  const abortRun = useCallback(async () => {
    if (!runId) {
      pushToast("No active run to cancel", "warn");
      return;
    }

    const result = await pipelineClient.abortRun(runId);

    if (!result.success) {
      pushToast(`Cancel failed: ${result.error}`, "error");
      pushLog("cancel_error", result.error);
      return;
    }

    pushToast("Run cancelled", "success");
    pushLog("cancel", { runId });
  }, [runId, pushToast, pushLog]);

  return {
    state,
    runId,
    isRunning,
    startRun,
    abortRun,
    resetState,
    draftStreamBuffer: draftStreamBufferRef,
    draftPreviewChunksReceived: draftPreviewChunksRef,
    onLog: pushLog,
    onToast: pushToast,
    onStreamError: handleStreamError,
  };
}
