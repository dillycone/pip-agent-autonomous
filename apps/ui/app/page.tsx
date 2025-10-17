"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";
import allowedExtensions from "../../../src/config/allowedExtensions.json";
import styles from "./styles.module.css";
import StatusDashboard from "./components/StatusDashboard";
import { safeJsonParse, formatDuration, formatDurationMs } from "../lib/utils";
import type { LogItem, TimelineItem, CostState } from "../lib/types";

export type Step = "transcribe" | "draft" | "review" | "export";
export type StepStatus = "pending" | "running" | "success" | "error";

type DraftPreviewStatus = "idle" | "streaming" | "complete";

type DraftUsageState = { model?: string; inputTokens?: number; outputTokens?: number; cacheCreationTokens?: number; cacheReadTokens?: number } | null;

interface StreamState {
  steps: Record<Step, StepStatus>;
  chunks: { processed: number; total: number };
  transcriptPreview: string;
  transcriptLines: string[];
  progressMode: "explicit" | "heuristic";
  draftPreviewLines: string[];
  draftPreviewStatus: DraftPreviewStatus;
  draftUsage: DraftUsageState;
  timeline: TimelineItem[];
  reviewRounds: Array<{ round: number; approved: boolean; reasons: string[]; requiredChanges: string[]; at?: string }>;
  finalDraft: string;
  docxPath: string;
  docxRelativePath: string;
  cost: CostState;
  transcribeStartedAt: number | null;
  transcribeEndedAt: number | null;
  uploadStartedAt: number | null;
  uploadCompletedAt: number | null;
}

type StreamAction =
  | { type: "reset" }
  | { type: "apply"; updater: (state: StreamState) => StreamState };

const createInitialStreamState = (): StreamState => ({
  steps: { ...defaultSteps },
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
  uploadCompletedAt: null
});

function streamReducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case "reset":
      return createInitialStreamState();
    case "apply":
      return action.updater(state);
    default:
      return state;
  }
}


const extensionConfig = (allowedExtensions as {
  audioExtensions: readonly string[];
  templateExtensions: readonly string[];
  outputExtensions: readonly string[];
});

const ALLOWED_AUDIO_EXTENSIONS = extensionConfig.audioExtensions;
const ALLOWED_TEMPLATE_EXTENSIONS = extensionConfig.templateExtensions;
const ALLOWED_OUTPUT_EXTENSIONS = extensionConfig.outputExtensions;
const PATH_TRAVERSAL_PATTERN = /(^|[\\/])\.\.([\\/]|$)/;

function hasAllowedExtension(value: string, allowed: readonly string[]): boolean {
  const lower = value.toLowerCase();
  return allowed.some((ext) => lower.endsWith(ext));
}

const stepOrder: Step[] = ["transcribe", "draft", "review", "export"];

const defaultSteps: Record<Step, StepStatus> = {
  transcribe: "pending",
  draft: "pending",
  review: "pending",
  export: "pending"
};



function formatClock(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function describeToolName(name?: string): string {
  if (!name) return "Unknown tool";
  if (name.startsWith("mcp__")) {
    const parts = name.split("__").filter(Boolean);
    if (parts.length >= 3) {
      const server = parts[1]?.replace(/_/g, " ") ?? "";
      const method = parts.slice(2).join(" • ").replace(/_/g, " ");
      return `${server}${method ? ` • ${method}` : ""}`;
    }
    if (parts.length === 2) {
      return parts[1]?.replace(/_/g, " ") ?? name;
    }
  }
  return name.replace(/_/g, " ");
}

function summarizeValue(value: unknown, maxLength = 160): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
  }
  try {
    const json = JSON.stringify(value);
    if (!json || json === "{}") return null;
    return json.length > maxLength ? `${json.slice(0, maxLength)}…` : json;
  } catch {
    return String(value).slice(0, maxLength);
  }
}

function summarizeTranscribeInput(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const parts: string[] = [];
  const audioPath = typeof record.audioPath === "string" ? record.audioPath : null;
  if (audioPath) {
    const segments = audioPath.split(/[/\\]/);
    parts.push(segments[segments.length - 1] || audioPath);
  }
  if (typeof record.startChunk === "number" && Number.isFinite(record.startChunk)) {
    parts.push(`start ${record.startChunk}`);
  }
  if (typeof record.chunkCount === "number" && Number.isFinite(record.chunkCount)) {
    parts.push(`${record.chunkCount} chunk${record.chunkCount === 1 ? "" : "s"}`);
  }
  if (typeof record.totalChunks === "number" && Number.isFinite(record.totalChunks)) {
    parts.push(`total ${record.totalChunks}`);
  }
  return parts.length > 0 ? parts.join(" • ") : null;
}



function extractTextPayload(payload: unknown): string | null {
  if (typeof payload === "string") {
    return payload;
  }
  if (Array.isArray(payload)) {
    for (const part of payload) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text?: string }).text ?? null;
      }
    }
  }
  return null;
}

function normalizeUsageMetrics(raw: unknown): { model?: string; inputTokens?: number; outputTokens?: number; cacheCreationTokens?: number; cacheReadTokens?: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const toNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
  return {
    model: typeof data.model === "string" ? data.model : undefined,
    inputTokens: toNumber(data.input_tokens ?? data.inputTokens),
    outputTokens: toNumber(data.output_tokens ?? data.outputTokens),
    cacheCreationTokens: toNumber(data.cache_creation_input_tokens ?? data.cacheCreationTokens),
    cacheReadTokens: toNumber(data.cache_read_input_tokens ?? data.cacheReadTokens)
  };
}

function computeOverallProgress(state: {
  steps: Record<Step, StepStatus>;
  chunks: { processed: number; total: number };
  draftPreviewStatus: DraftPreviewStatus;
  reviewRounds: Array<{ round: number; approved: boolean; reasons: string[]; requiredChanges: string[]; at?: string }>;
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

  return Math.round(transcribeProgress + draftProgress + reviewProgress + exportProgress);
}

export default function Page() {
  const [audio, setAudio] = useState("uploads/meeting.mp3");
  const [inLang, setInLang] = useState("auto");
  const [outLang, setOutLang] = useState("en");
  const [template, setTemplate] = useState("templates/pip-template.docx");
  const [outdoc, setOutdoc] = useState(() => `exports/pip-${Date.now()}.docx`);

  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [transcribeElapsedSeconds, setTranscribeElapsedSeconds] = useState(0);
  const [streamState, dispatchStream] = useReducer(streamReducer, undefined, createInitialStreamState);
  const {
    steps,
    chunks,
    transcriptPreview,
    transcriptLines,
    progressMode,
    draftPreviewLines,
    draftPreviewStatus,
    draftUsage,
    timeline,
    reviewRounds,
    finalDraft,
    docxPath,
    docxRelativePath,
    cost,
    transcribeStartedAt,
    transcribeEndedAt,
    uploadStartedAt,
    uploadCompletedAt
  } = streamState;
  const [focusedStep, setFocusedStep] = useState<Step | null>(null);
  const draftStreamBufferRef = useRef("");
  const [logs, setLogs] = useState<LogItem[]>([]);
  const draftPreviewChunksRef = useRef(false);

  const updateStreamState = useCallback(
    (updater: (state: StreamState) => StreamState) => {
      dispatchStream({ type: "apply", updater });
    },
    []
  );

  const [toasts, setToasts] = useState<Array<{ id: string; text: string; level: "info" | "warn" | "error" | "success" }>>([]);

  const eventSourceRef = useRef<EventSource | null>(null);
  const eventSourceListenersRef = useRef<Array<{ source: EventSource; type: string; listener: EventListenerOrEventListenerObject }>>([]);

  const detachEventSourceListeners = useCallback((source: EventSource | null) => {
    if (!source) return;
    eventSourceListenersRef.current = eventSourceListenersRef.current.filter((entry) => {
      if (entry.source !== source) return true;
      source.removeEventListener(entry.type, entry.listener);
      return false;
    });
  }, []);

  const trackEventSourceListener = useCallback(
    (source: EventSource, type: string, listener: any) => {
      source.addEventListener(type, listener);
      eventSourceListenersRef.current.push({ source, type, listener });
    },
    []
  );

  const closeEventSource = useCallback((source: EventSource | null) => {
    if (!source) return;
    detachEventSourceListeners(source);
    if (source.readyState !== EventSource.CLOSED) {
      source.close();
    }
  }, [detachEventSourceListeners]);

  useEffect(() => {
    return () => {
      closeEventSource(eventSourceRef.current);
      eventSourceRef.current = null;
    };
  }, [closeEventSource]);

  const pushLog = useCallback((type: string, payload: unknown) => {
    setLogs((prev) => [...prev, { ts: Date.now(), type, payload }].slice(-5000));
  }, []);

  const pushToast = useCallback((text: string, level: "info" | "warn" | "error" | "success" = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, text, level }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const validateFormInputs = useCallback((): string[] => {
    const issues: string[] = [];

    const audioValue = audio.trim();
    if (!audioValue) {
      issues.push("Audio path is required.");
    } else {
      if (PATH_TRAVERSAL_PATTERN.test(audioValue)) {
        issues.push("Audio path cannot contain '..' segments.");
      }
      if (!hasAllowedExtension(audioValue, ALLOWED_AUDIO_EXTENSIONS)) {
        issues.push(`Audio must be one of: ${ALLOWED_AUDIO_EXTENSIONS.join(", ")}`);
      }
    }

    const templateValue = template.trim();
    if (!templateValue) {
      issues.push("Template path is required.");
    } else {
      if (PATH_TRAVERSAL_PATTERN.test(templateValue)) {
        issues.push("Template path cannot contain '..' segments.");
      }
      if (!hasAllowedExtension(templateValue, ALLOWED_TEMPLATE_EXTENSIONS)) {
        issues.push("Template must be a .docx file.");
      }
    }

    const outdocValue = outdoc.trim();
    if (!outdocValue) {
      issues.push("Output document path is required.");
    } else {
      if (PATH_TRAVERSAL_PATTERN.test(outdocValue)) {
        issues.push("Output document path cannot contain '..' segments.");
      }
      if (!hasAllowedExtension(outdocValue, ALLOWED_OUTPUT_EXTENSIONS)) {
        issues.push("Output document must end with .docx.");
      }
    }

    return issues;
  }, [audio, template, outdoc]);

  const resetState = useCallback(() => {
    dispatchStream({ type: "reset" });
    setFocusedStep(null);
    draftStreamBufferRef.current = "";
    draftPreviewChunksRef.current = false;
    setLogs([]);
    setTranscribeElapsedSeconds(0);
    setRunId(null);
  }, [dispatchStream, setTranscribeElapsedSeconds]);

  const handleStreamError = useCallback((payload: unknown) => {
    pushLog("error", payload ?? "Stream error");
    setRunning(false);
    setRunId(null);
    updateStreamState((prev) => {
      const nextSteps: Record<Step, StepStatus> = { ...prev.steps };
      (Object.keys(nextSteps) as Step[]).forEach((step) => {
        if (nextSteps[step] === "running") {
          nextSteps[step] = "error";
        }
      });
      return { ...prev, steps: nextSteps };
    });
  }, [pushLog, updateStreamState]);

  const startRun = useCallback(async () => {
    if (running) return;

    const validationErrors = validateFormInputs();
    if (validationErrors.length > 0) {
      pushToast(validationErrors[0], "error");
      pushLog("validation", validationErrors);
      return;
    }

    closeEventSource(eventSourceRef.current);
    resetState();
    setRunning(true);

    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio,
          template,
          outdoc,
          inputLanguage: inLang,
          outputLanguage: outLang
        })
      });

      const payload = await response.json().catch(() => null) as { runId?: string } | { error?: string; details?: unknown } | null;

      if (!response.ok || !payload || typeof (payload as any).runId !== "string") {
        const message = typeof (payload as any)?.error === "string"
          ? (payload as any).error
          : `Run request failed (${response.status})`;
        pushToast(message, "error");
        pushLog("error", payload ?? message);
        setRunning(false);
        return;
      }

      const { runId: newRunId } = payload as { runId: string };
      setRunId(newRunId);
      pushLog("run", payload);

      const es = new EventSource(`/api/run/${encodeURIComponent(newRunId)}/stream`);
      eventSourceRef.current = es;

      trackEventSourceListener(es, "status", (event: MessageEvent<string>) => {
        const data = safeJsonParse<{ step?: Step; status?: StepStatus; meta?: Record<string, unknown>; at?: string }>(event.data) ?? {};
        const step = data.step as Step | undefined;
        const status = data.status as StepStatus | undefined;
        if (step && status) {
          updateStreamState((prev) => {
            const nextSteps: Record<Step, StepStatus> = { ...prev.steps, [step]: status };
            let nextState: StreamState = { ...prev, steps: nextSteps };

            if (status === "running") {
              if (step === "transcribe") {
                const now = Date.now();
                nextState = {
                  ...nextState,
                  transcriptLines: [],
                  transcriptPreview: "",
                  chunks: { processed: 0, total: 0 },
                  transcribeStartedAt: prev.transcribeStartedAt ?? now,
                  transcribeEndedAt: null,
                  uploadStartedAt: prev.uploadStartedAt ?? now
                };
              }
              if (step === "draft") {
                nextState = {
                  ...nextState,
                  draftPreviewStatus: "streaming",
                  draftPreviewLines: [],
                  draftUsage: null
                };
              }
              if (step === "review") {
                nextState = { ...nextState, reviewRounds: [] };
              }
            }

            if ((status === "success" || status === "error") && step === "draft") {
              nextState = { ...nextState, draftPreviewStatus: "complete" };
            }

            if (step === "transcribe") {
              if (status === "running") {
                const now = Date.now();
                nextState = {
                  ...nextState,
                  transcribeStartedAt: prev.transcribeStartedAt ?? now,
                  transcribeEndedAt: null,
                  uploadStartedAt: prev.uploadStartedAt ?? now
                };
              } else if (status === "success" || status === "error") {
                const now = Date.now();
                nextState = {
                  ...nextState,
                  transcribeEndedAt: prev.transcribeEndedAt ?? now,
                  uploadCompletedAt: prev.uploadCompletedAt ?? now
                };
              }
            }

            return nextState;
          });

          if (status === "running" && step === "draft") {
            draftStreamBufferRef.current = "";
            draftPreviewChunksRef.current = false;
          }

          if (status === "running") pushToast(`${capitalize(step)} started`, "info");
          if (status === "success") pushToast(`${capitalize(step)} complete`, "success");
          if (status === "error") pushToast(`${capitalize(step)} error`, "error");
        }
        pushLog("status", data);
      });

      trackEventSourceListener(es, "tool_use", (event: MessageEvent<string>) => {
        const data = safeJsonParse<{ id?: string; name?: string; startedAt?: string; inputSummary?: unknown }>(event.data) ?? {};
        if (data?.id && data?.name) {
          const phase: Step | "unknown" = data.name.includes("gemini-transcriber")
            ? "transcribe"
            : data.name.includes("pip-generator")
              ? "draft"
              : data.name.includes("docx-exporter")
                ? "export"
                : "unknown";
          updateStreamState((prev) => {
            const nextTimeline = [
              ...prev.timeline,
              { id: data.id!, name: data.name!, phase, status: "running" as StepStatus, startedAt: data.startedAt, inputSummary: data.inputSummary }
            ];
            if (nextTimeline.length > 500) {
              nextTimeline.splice(0, nextTimeline.length - 500);
            }
            return { ...prev, timeline: nextTimeline };
          });
        }
        pushLog("tool_use", data);
      });

      trackEventSourceListener(es, "tool_result", (event: MessageEvent<string>) => {
        const data = safeJsonParse<{ id?: string; name?: string; isError?: boolean; content?: unknown; finishedAt?: string; durationMs?: number }>(event.data) ?? {};
        const isPipGenerator = Boolean(data?.name?.includes("pip-generator"));
        const textPayload = isPipGenerator ? extractTextPayload(data.content) : null;
        const parsedPayload = isPipGenerator ? safeJsonParse<{ draft?: string; usage?: unknown; model?: unknown }>(textPayload ?? null) : null;
        const normalizedUsage = parsedPayload?.usage || parsedPayload?.model ? normalizeUsageMetrics(parsedPayload?.usage) : null;

        updateStreamState((prev) => {
          let nextState: StreamState = { ...prev };

          if (data?.id) {
            nextState.timeline = prev.timeline.map((t) =>
              t.id === data.id
                ? {
                    ...t,
                    status: data.isError ? "error" : "success",
                    isError: data.isError,
                    finishedAt: data.finishedAt,
                    durationMs: data.durationMs,
                    contentSummary: data.content
                  }
                : t
            );
          }

          if (isPipGenerator) {
            if (data?.isError) {
              nextState.draftPreviewStatus = "complete";
            }
            if (parsedPayload?.usage || parsedPayload?.model) {
              nextState.draftUsage = {
                model: typeof parsedPayload?.model === "string" ? parsedPayload.model : normalizedUsage?.model,
                inputTokens: normalizedUsage?.inputTokens,
                outputTokens: normalizedUsage?.outputTokens,
                cacheCreationTokens: normalizedUsage?.cacheCreationTokens,
                cacheReadTokens: normalizedUsage?.cacheReadTokens
              };
            }
            if (parsedPayload?.draft && !draftPreviewChunksRef.current) {
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
        });

        if (data?.isError) pushToast(`Tool error: ${data.name ?? data.id}`, "error");
        pushLog("tool_result", data);
      });

      trackEventSourceListener(es, "draft_stream_reset", (event: MessageEvent<string>) => {
        const data = safeJsonParse<{ at?: string }>(event.data);
        draftPreviewChunksRef.current = true;
        draftStreamBufferRef.current = "";
        updateStreamState((prev) => ({
          ...prev,
          draftPreviewStatus: "streaming",
          draftPreviewLines: []
        }));
      });

      trackEventSourceListener(es, "draft_stream_delta", (event: MessageEvent<string>) => {
        const data = safeJsonParse<{ text?: string; seq?: number; length?: number; at?: string }>(event.data);
        if (typeof data?.text === "string" && data.text.length > 0) {
          draftPreviewChunksRef.current = true;
          const combined = `${draftStreamBufferRef.current}${data.text}`;
          draftStreamBufferRef.current = combined.length > 12000 ? combined.slice(-12000) : combined;
          const trailing = draftStreamBufferRef.current
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line): line is string => line.length > 0)
            .slice(-3);
          updateStreamState((prev) => ({
            ...prev,
            draftPreviewStatus: "streaming",
            draftPreviewLines: trailing
          }));
        }
      });

      trackEventSourceListener(es, "draft_stream_complete", (event: MessageEvent<string>) => {
        const data = safeJsonParse<{ total?: number; chunks?: number; at?: string }>(event.data);
        if (data) {
          draftPreviewChunksRef.current = true;
          updateStreamState((prev) => ({
            ...prev,
            draftPreviewStatus: "complete"
          }));
        }
      });

      trackEventSourceListener(es, "draft_preview_chunk", (event: MessageEvent<string>) => {
        const data = safeJsonParse<{ text?: string; index?: number; total?: number; at?: string }>(event.data);
        if (data?.text) {
          draftPreviewChunksRef.current = true;
          updateStreamState((prev) => {
            const nextLines = [...prev.draftPreviewLines];
            const text = data.text!; // Safe to assert since we checked above
            if (typeof data.index === "number" && data.index >= 0) {
              nextLines[data.index] = text;
            } else {
              nextLines.push(text);
            }
            const filtered = nextLines
              .filter((line): line is string => typeof line === "string" && line.length > 0)
              .slice(-3);
            return {
              ...prev,
              draftPreviewStatus: "streaming",
              draftPreviewLines: filtered
            };
          });
        }
      });

      trackEventSourceListener(es, "draft_preview_complete", (event: MessageEvent<string>) => {
        const data = safeJsonParse<{ total?: number; at?: string }>(event.data);
        if (data) {
          updateStreamState((prev) => ({
            ...prev,
            draftPreviewStatus: "complete"
          }));
        }
      });

      trackEventSourceListener(es, "judge_round", (event: MessageEvent<string>) => {
        const data = safeJsonParse<{ approved?: boolean; reasons?: string[]; required_changes?: string[]; revised_draft?: string | null; round?: number; at?: string }>(event.data);
        if (typeof data?.round === "number") {
          updateStreamState((prev) => {
            const round = data.round!; // Safe to assert since we checked type above
            const filtered = prev.reviewRounds.filter((item) => item.round !== round);
            const next = [
              ...filtered,
              {
                round,
                approved: Boolean(data.approved),
                reasons: Array.isArray(data.reasons) ? data.reasons.filter((r): r is string => typeof r === "string" && r.trim().length > 0) : [],
                requiredChanges: Array.isArray(data.required_changes) ? data.required_changes.filter((r): r is string => typeof r === "string" && r.trim().length > 0) : [],
                at: data.at
              }
            ]
              .sort((a, b) => a.round - b.round)
              .slice(-4);
            return { ...prev, reviewRounds: next };
          });
        }
      });

      trackEventSourceListener(es, "todo", (event: MessageEvent<string>) => {
        const data = safeJsonParse(event.data) ?? {};
        pushLog("todo", data);
      });

      trackEventSourceListener(es, "transcript_chunk", (event: MessageEvent<string>) => {
        const data = safeJsonParse<{ transcript?: string; processedChunks?: number; totalChunks?: number; at?: string; meta?: { progressMode?: "explicit" | "heuristic" } }>(event.data);
        if (data) {
          updateStreamState((prev) => {
            let processed = prev.chunks.processed;
            let total = prev.chunks.total;

            if (typeof data.processedChunks === "number" && Number.isFinite(data.processedChunks)) {
              processed = Math.max(processed, data.processedChunks);
            }
            if ((!processed || processed <= 0) && typeof data.transcript === "string" && data.transcript.trim()) {
              processed = Math.max(processed, 1);
            }

            if (typeof data.totalChunks === "number" && Number.isFinite(data.totalChunks)) {
              total = Math.max(total, data.totalChunks);
            }
            if ((!total || total <= 0) && processed && processed > 0) {
              total = processed;
            }

            if (!Number.isFinite(processed) || processed < 0) processed = 0;
            if (!Number.isFinite(total) || total < 0) total = 0;

            let transcriptPreview = prev.transcriptPreview;
            let transcriptLines = prev.transcriptLines;

            if (typeof data.transcript === "string" && data.transcript.trim()) {
              transcriptPreview = data.transcript;
              transcriptLines = data.transcript
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line): line is string => line.length > 0)
                .slice(-3);
            }

            const metaMode = data.meta?.progressMode;
            const nextProgressMode: "explicit" | "heuristic" =
              metaMode === "explicit" || metaMode === "heuristic" ? metaMode : prev.progressMode;

            return {
              ...prev,
              transcriptPreview,
              transcriptLines,
              chunks: { processed, total },
              progressMode: nextProgressMode,
              uploadCompletedAt: prev.uploadCompletedAt ?? Date.now()
            };
          });
          pushLog("transcript_chunk", data);
        }
      });

      trackEventSourceListener(es, "cost", (event: MessageEvent<string>) => {
        const data = safeJsonParse<{ summary?: { totalTokens?: number; estimatedCostUSD?: number; breakdown?: Record<string, unknown> } }>(event.data);
        if (data?.summary) {
          updateStreamState((prev) => ({
            ...prev,
            cost: {
              tokens: data.summary?.totalTokens ?? 0,
              usd: data.summary?.estimatedCostUSD ?? 0,
              breakdown: data.summary?.breakdown ?? {}
            }
          }));
        }
      });

      trackEventSourceListener(es, "final", (event: MessageEvent<string>) => {
        const data = safeJsonParse<{ ok?: boolean; draft?: string; docx?: string; docxRelative?: string; at?: string }>(event.data);
        if (data?.ok) {
          const finalText = data.draft ?? "";
          const hasContent = finalText.trim().length > 0;
          updateStreamState((prev) => {
            let nextState: StreamState = {
              ...prev,
              finalDraft: finalText,
              docxPath: data.docx ?? "",
              docxRelativePath: data.docxRelative ?? ""
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
                draftPreviewStatus: "complete"
              };
            }
            return nextState;
          });
          if (hasContent) {
            draftStreamBufferRef.current = finalText;
          }
          pushLog("final", data);
          pushToast("Export complete", "success");
        }
        setRunning(false);
        closeEventSource(es);
        if (eventSourceRef.current === es) {
          eventSourceRef.current = null;
        }
      });

      trackEventSourceListener(es, "error", (event: MessageEvent<string>) => {
        const data = event.data;
        const parsed = safeJsonParse(data ?? null);
        handleStreamError(parsed ?? data ?? null);
        closeEventSource(es);
        if (eventSourceRef.current === es) {
          eventSourceRef.current = null;
        }
      });

      es.onerror = async (_event: Event) => {
        if (!runId) {
          pushLog("resync-error", "Run ID unavailable, cannot resync connection");
          pushToast("Connection lost and run ID missing; cannot resync.", "error");
          return;
        }

        pushLog("stream-error", "Connection lost, attempting resync...");
        pushToast("Connection lost, resyncing…", "warn");

        try {
          const response = await fetch(`/api/run/${encodeURIComponent(runId)}/stream`);

          if (!response.ok) {
            throw new Error(`Resync failed: ${response.status}`);
          }

          const stateResponse = await fetch(
            `/api/run/${encodeURIComponent(runId)}/state`
          ).catch(() => null);

          if (stateResponse?.ok) {
            const stateSnapshot = await stateResponse.json().catch(() => null);
            if (stateSnapshot) {
              updateStreamState((prev) => ({
                ...prev,
                ...stateSnapshot
              }));
              pushLog("resync", "State restored from server");
              pushToast("Reconnected and synced", "success");
            }
          }

          closeEventSource(es);
          const newEs = new EventSource(
            `/api/run/${encodeURIComponent(runId)}/stream`
          );
          eventSourceRef.current = newEs;

          // Re-attach all listeners to new connection
          // (This is simplified - in production you'd want to refactor this)
          pushLog("resync", "New connection established");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          pushLog("resync-error", message);
          handleStreamError({ error: message, context: "resync" });
        }
      };

      pushLog("info", `Stream opened for run ${newRunId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushToast(`Run failed: ${message}`, "error");
      pushLog("error", message);
      setRunning(false);
    }
  }, [audio, handleStreamError, inLang, outLang, outdoc, pushLog, pushToast, resetState, running, template, validateFormInputs, closeEventSource, trackEventSourceListener, runId, updateStreamState]);

  const handleCancelRun = useCallback(async () => {
    if (!runId) {
      pushToast("No active run to cancel", "warn");
      return;
    }

    try {
      const response = await fetch(
        `/api/run/${encodeURIComponent(runId)}/abort`,
        { method: "POST" }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Unknown error" }));
        pushToast(`Cancel failed: ${error.error || response.statusText}`, "error");
        return;
      }

      pushToast("Run cancelled", "success");
      pushLog("cancel", { runId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushToast(`Cancel error: ${message}`, "error");
      pushLog("cancel_error", message);
    }
  }, [runId, pushToast, pushLog]);

  const handleRetryRun = useCallback(() => {
    resetState();
    startRun();
  }, [resetState, startRun]);

  const pct = useMemo(() => {
    if (!chunks.total || chunks.total <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((chunks.processed / chunks.total) * 100)));
  }, [chunks]);

  useEffect(() => {
    if (!transcribeStartedAt) {
      setTranscribeElapsedSeconds(0);
      return;
    }

    const compute = () => {
      const end = transcribeEndedAt ?? Date.now();
      const elapsed = Math.max(0, Math.floor((end - transcribeStartedAt) / 1000));
      setTranscribeElapsedSeconds(elapsed);
    };

    compute();

    if (transcribeEndedAt) {
      return;
    }

    const interval = setInterval(compute, 1000);
    return () => clearInterval(interval);
  }, [transcribeStartedAt, transcribeEndedAt]);

  const eta = useMemo(() => {
    if (!chunks.total || chunks.total <= 0 || chunks.processed <= 0) return null;
    if (!transcribeStartedAt) return null;
    if (transcribeElapsedSeconds <= 0) return null;
    if (transcribeEndedAt) return 0;
    const remaining = chunks.total - chunks.processed;
    if (remaining <= 0) return 0;
    const rate = chunks.processed / Math.max(1, transcribeElapsedSeconds);
    if (rate <= 0) return null;
    return Math.max(0, Math.round(remaining / rate));
  }, [chunks, transcribeElapsedSeconds, transcribeStartedAt, transcribeEndedAt]);

  const autoStep = useMemo<Step>(() => {
    const runningStep = stepOrder.find((key) => steps[key] === "running");
    if (runningStep) return runningStep;
    const completed = [...stepOrder].reverse().find((key) => steps[key] === "success" || steps[key] === "error");
    if (completed) return completed;
    return "transcribe";
  }, [steps]);

  const visibleStep = focusedStep && steps[focusedStep] ? focusedStep : autoStep;

  const stepTimeline = useMemo(() => {
    return timeline
      .filter((item) => (visibleStep === "review" ? item.phase === "review" || item.phase === "unknown" : item.phase === visibleStep))
      .slice(-6);
  }, [timeline, visibleStep]);

  const transcriptStreamLines = useMemo(() => {
    if (transcriptLines.length > 0) return transcriptLines;
    const fallback = transcriptPreview
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line): line is string => line.length > 0)
      .slice(-3);
    return fallback;
  }, [transcriptLines, transcriptPreview]);

  return (
    <main className={styles.page}>
      <Toasts toasts={toasts} onClose={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
      <header className={styles.header}>
        <h1>PIP Agent — Autonomous Run</h1>
        <p className={styles.sub}>
          Watch transcription → draft → policy review → export in real time.
          {steps.transcribe === "running" && transcribeElapsedSeconds > 30 && (
            <span style={{ display: "block", marginTop: "0.5rem", fontSize: "0.9em", opacity: 0.8 }}>
              Long audio files may take 5-10 minutes to transcribe. Progress updates appear periodically.
            </span>
          )}
        </p>
      </header>

      <section className={styles.formRow}>
        <label htmlFor="audio">Audio</label>
        <div className={styles.inputField}>
          <input id="audio" value={audio} onChange={(e) => setAudio(e.target.value)} placeholder="uploads/meeting.mp3" />
          <div className={styles.inputHint}>MP3, WAV supported. Path cannot contain ..</div>
        </div>
        <label htmlFor="inLang">Input</label>
        <div className={styles.inputField}>
          <input id="inLang" value={inLang} onChange={(e) => setInLang(e.target.value)} placeholder="auto" />
          <div className={styles.inputHint}>Language code or &quot;auto&quot; for detection</div>
        </div>
        <label htmlFor="outLang">Output</label>
        <div className={styles.inputField}>
          <input id="outLang" value={outLang} onChange={(e) => setOutLang(e.target.value)} placeholder="en" />
          <div className={styles.inputHint}>Target language code (e.g., en, es, fr)</div>
        </div>
        <label htmlFor="template">Template</label>
        <div className={styles.inputField}>
          <input id="template" value={template} onChange={(e) => setTemplate(e.target.value)} />
          <div className={styles.inputHint}>.docx file path. Path cannot contain ..</div>
        </div>
        <label htmlFor="outdoc">Out Doc</label>
        <div className={styles.inputField}>
          <input id="outdoc" value={outdoc} onChange={(e) => setOutdoc(e.target.value)} />
          <div className={styles.inputHint}>Output .docx path. Path cannot contain ..</div>
        </div>
        <button onClick={startRun} disabled={running} className={styles.runBtn}>
          {running ? "Running…" : "Start Run"}
        </button>
      </section>

      {running && (
        <StatusDashboard
          overallProgress={computeOverallProgress(streamState)}
          currentStep={autoStep}
          steps={steps}
          hasError={Object.values(steps).some((s) => s === "error")}
          errorMessage={(() => {
            const errorStep = (Object.entries(steps) as Array<[Step, StepStatus]>).find(([_, s]) => s === "error")?.[0];
            if (errorStep) {
              const messages: Record<Step, string> = {
                transcribe: "Transcription failed — check tool output for details.",
                draft: "Draft generation failed — check tool output for details.",
                review: "Review process failed — check tool output for details.",
                export: "Export failed — check tool output for details."
              };
              return messages[errorStep];
            }
            return undefined;
          })()}
          elapsedSeconds={transcribeElapsedSeconds}
          onCancel={handleCancelRun}
          onRetry={handleRetryRun}
          canRetry={!running && Object.values(steps).some((s) => s === "error")}
        />
      )}

      <section className={styles.grid}>
        <div className={styles.leftCol}>
          <div className={styles.stepperRow}>
            <Stepper
              steps={[
                {
                  key: "transcribe",
                  label: "Transcribe",
                  status: steps.transcribe,
                  meta: chunks.total
                    ? `${progressMode === "heuristic" ? "≈" : ""}${chunks.processed}/${chunks.total} chunks (${pct}%) • ${formatDuration(transcribeElapsedSeconds)} elapsed${steps.transcribe === "running" && eta !== null ? ` • ETA ${formatDuration(eta)}` : ""}${progressMode === "heuristic" ? " • estimated" : ""}`
                    : steps.transcribe === "running" && transcribeElapsedSeconds > 5
                      ? `Processing... ${formatDuration(transcribeElapsedSeconds)} elapsed`
                      : undefined,
                  progress: chunks.total ? pct : undefined
                },
                { key: "draft", label: "Draft", status: steps.draft },
                { key: "review", label: "Review", status: steps.review },
                { key: "export", label: "Export", status: steps.export }
              ]}
              activeStep={visibleStep}
              focusedStep={focusedStep}
              onSelect={(stepKey) => setFocusedStep((prev) => (prev === stepKey ? null : stepKey))}
            />
            {focusedStep ? (
              <button type="button" className={styles.followBtn} onClick={() => setFocusedStep(null)}>
                Follow live step
              </button>
            ) : null}
          </div>
          <StepDetailPanel
            step={visibleStep}
            status={steps[visibleStep]}
            running={running}
            transcribe={{
              processed: chunks.processed,
              total: chunks.total,
              percent: chunks.total ? pct : undefined,
              elapsedSeconds: transcribeElapsedSeconds,
              etaSeconds: eta,
              uploadStartedAt,
              uploadCompletedAt,
              progressMode
            }}
            transcriptLines={transcriptStreamLines}
            draft={{ lines: draftPreviewLines, previewStatus: draftPreviewStatus, usage: draftUsage }}
            reviewRounds={reviewRounds}
            exportData={{ docxPath, docxRelativePath, hasDocx: Boolean(docxPath || docxRelativePath) }}
            timeline={stepTimeline}
          />
        </div>

        <div className={styles.rightCol}>
          <Artifacts finalDraft={finalDraft} docxPath={docxPath} docxRelative={docxRelativePath} />
        </div>
      </section>
    </main>
  );
}

type StepperProps = {
  steps: Array<{ key: Step; label: string; status: StepStatus; meta?: string; progress?: number }>;
  activeStep: Step;
  focusedStep: Step | null;
  onSelect: (step: Step) => void;
};

function Stepper({ steps, activeStep, focusedStep, onSelect }: StepperProps) {
  return (
    <div className={styles.stepper}>
      {steps.map((step, index) => {
        const statusClass = styles[`step${capitalize(step.status)}`] ?? "";
        const isActive = step.key === activeStep;
        const isFocused = focusedStep === step.key;
        const className = [styles.step, statusClass, isActive ? styles.stepActive : "", isFocused ? styles.stepFocused : ""]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={step.key}
            type="button"
            className={className}
            onClick={() => onSelect(step.key)}
            aria-pressed={isFocused}
          >
            <div className={styles.stepIndex}>{index + 1}</div>
            <div className={styles.stepBody}>
              <div className={styles.stepLabel}>{step.label}</div>
              {step.meta ? <div className={styles.stepMeta}>{step.meta}</div> : null}
              {typeof step.progress === "number" ? (
                <div className={styles.progressBarOuter} aria-valuemin={0} aria-valuemax={100} aria-valuenow={step.progress} role="progressbar">
                  <div className={styles.progressBarInner} style={{ width: `${step.progress}%` }} />
                </div>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}

type StepDetailPanelProps = {
  step: Step;
  status: StepStatus;
  running: boolean;
  transcribe: {
    processed: number;
    total: number;
    percent?: number;
    elapsedSeconds: number;
    etaSeconds: number | null;
    uploadStartedAt: number | null;
    uploadCompletedAt: number | null;
    progressMode: "explicit" | "heuristic";
  };
  transcriptLines: string[];
  draft: {
    lines: string[];
    previewStatus: "idle" | "streaming" | "complete";
    usage: { model?: string; inputTokens?: number; outputTokens?: number; cacheCreationTokens?: number; cacheReadTokens?: number } | null;
  };
  reviewRounds: Array<{ round: number; approved: boolean; reasons: string[]; requiredChanges: string[]; at?: string }>;
  exportData: {
    docxPath: string;
    docxRelativePath: string;
    hasDocx: boolean;
  };
  timeline: TimelineItem[];
};

function StepDetailPanel({
  step,
  status,
  running,
  transcribe,
  transcriptLines,
  draft,
  reviewRounds,
  exportData,
  timeline
}: StepDetailPanelProps) {
  if (step === "transcribe") {
    const { processed, total, percent, elapsedSeconds, etaSeconds, uploadStartedAt, uploadCompletedAt, progressMode } = transcribe;
    const hasTotals = typeof total === "number" && total > 0;
    const approxPrefix = progressMode === "heuristic" ? "≈" : "";
    const chunksLabel = hasTotals
      ? `${approxPrefix}${processed}/${total}`
      : processed > 0
        ? `${approxPrefix}${processed}`
        : "—";
    const remainingChunks = hasTotals ? Math.max(0, total - processed) : null;
    const elapsedLabel = formatDuration(elapsedSeconds);
    const remainingLabel = etaSeconds !== null && etaSeconds >= 0
      ? formatDuration(etaSeconds)
      : status === "success" || status === "error"
        ? "0:00"
        : "—";
    const modeTag = progressMode === "heuristic" ? " (est.)" : "";
    const ringLabel = hasTotals
      ? `${total} chunk${total === 1 ? "" : "s"}${modeTag}`
      : processed > 0
        ? `${processed} processed${modeTag}`
        : undefined;
    const uploadValue = uploadCompletedAt
      ? formatClock(new Date(uploadCompletedAt).toISOString())
      : uploadStartedAt
        ? formatClock(new Date(uploadStartedAt).toISOString())
        : "—";
    const uploadStatus = uploadCompletedAt
      ? "Upload complete"
      : uploadStartedAt
        ? "Uploading audio…"
        : status === "running"
          ? "Uploading soon"
          : "Not started";
    const message = (() => {
      if (status === "success") return "All audio chunks processed.";
      if (status === "error") return "Transcription failed — check tool output for details.";
      if (status === "running") {
        if (hasTotals) {
          const estimateNote = progressMode === "heuristic" ? " (estimated)" : "";
          return `${chunksLabel} chunks complete${remainingChunks && remainingChunks > 0 ? ` • ${remainingChunks} remaining` : ""}${estimateNote}`;
        }
        if (processed > 0) {
          const estimateNote = progressMode === "heuristic" ? " (estimated)" : "";
          return `${chunksLabel} chunk${processed === 1 ? "" : "s"} complete${estimateNote}.`;
        }
        return uploadStartedAt ? "Uploading audio…" : "Initializing transcription…";
      }
      if (status === "pending") {
        if (uploadStartedAt) {
          return "Preparing transcription request…";
        }
        return running ? "Waiting to start transcription…" : "Transcription pending.";
      }
      return uploadCompletedAt ? "Upload complete. Awaiting next steps…" : "Transcription status updated.";
    })();

    return (
      <StepCard title="Transcription Progress" status={status} message={message}>
        <div className={styles.progressRow}>
          <ProgressRing percent={percent} label={ringLabel} />
          <div className={styles.kpis}>
            <div>
              <div className={styles.kpiLabel}>Chunks</div>
              <div className={styles.kpiValue}>{chunksLabel}</div>
            </div>
            <div>
              <div className={styles.kpiLabel}>Elapsed</div>
              <div className={styles.kpiValue}>{elapsedLabel}</div>
            </div>
            <div>
              <div className={styles.kpiLabel}>Remaining</div>
              <div className={styles.kpiValue}>{remainingLabel}</div>
            </div>
            <div>
              <div className={styles.kpiLabel}>Upload</div>
              <div className={styles.kpiValue}>{uploadValue}</div>
              <div className={styles.kpiHint}>{uploadStatus}</div>
            </div>
          </div>
        </div>
        <StreamingLines
          label="Latest transcript lines"
          lines={transcriptLines}
          placeholder={status === "running" ? "Waiting for transcript output…" : "Transcript preview will appear here."}
          status={status === "running" && transcriptLines.length > 0 ? "streaming" : undefined}
        />
        <StepActivity items={timeline} />
      </StepCard>
    );
  }

  if (step === "draft") {
    const { lines, previewStatus, usage } = draft;
    const usageItems = [
      usage?.model ? { label: "Model", value: usage.model } : null,
      typeof usage?.inputTokens === "number" ? { label: "Input tokens", value: usage.inputTokens.toLocaleString() } : null,
      typeof usage?.outputTokens === "number" ? { label: "Output tokens", value: usage.outputTokens.toLocaleString() } : null,
      typeof usage?.cacheCreationTokens === "number" ? { label: "Cache create", value: usage.cacheCreationTokens.toLocaleString() } : null,
      typeof usage?.cacheReadTokens === "number" ? { label: "Cache read", value: usage.cacheReadTokens.toLocaleString() } : null
    ].filter((item): item is { label: string; value: string } => Boolean(item));

    const message = (() => {
      if (status === "error") return "Draft failed — open activity below for details.";
      if (status === "success") return "Draft ready. Policy review will start automatically.";
      if (status === "running") {
        return previewStatus === "streaming"
          ? "Drafting PIP… streaming lines appear below."
          : "Drafting PIP…";
      }
      if (status === "pending") {
        return running ? "Waiting to start drafting…" : "Draft pending.";
      }
      return "Draft status updated.";
    })();

    return (
      <StepCard title="Draft Progress" status={status} message={message}>
        {usageItems.length > 0 ? (
          <div className={styles.kpis}>
            {usageItems.map((item) => (
              <div key={item.label}>
                <div className={styles.kpiLabel}>{item.label}</div>
                <div className={styles.kpiValue}>{item.value}</div>
              </div>
            ))}
          </div>
        ) : null}
        <StreamingLines
          label="Draft excerpt"
          lines={lines}
          placeholder={status === "running" ? "Waiting for first lines…" : "Draft lines will appear here."}
          status={previewStatus === "streaming" ? "streaming" : undefined}
        />
        <StepActivity items={timeline} />
      </StepCard>
    );
  }

  if (step === "review") {
    const message = (() => {
      const latest = reviewRounds.at(-1) ?? null;
      if (status === "error") return "Review blocked — see required changes below.";
      if (status === "success") return "Review complete.";
      if (latest) {
        return latest.approved
          ? `Round ${latest.round}: approved.`
          : `Round ${latest.round}: changes required.`;
      }
      if (status === "running") return "Policy judge is reviewing the draft…";
      if (status === "pending") return running ? "Waiting to start review…" : "Review pending.";
      return "Review status updated.";
    })();

    return (
      <StepCard title="Review Progress" status={status} message={message}>
        {reviewRounds.length > 0 ? (
          <div className={styles.reviewList}>
            {[...reviewRounds].sort((a, b) => a.round - b.round).map((round) => (
              <div key={round.round} className={styles.reviewItem}>
                <div className={styles.reviewHeading}>
                  <span className={styles.reviewBadge}>Round {round.round}</span>
                  <span className={round.approved ? styles.reviewApproved : styles.reviewChanges}>
                    {round.approved ? "Approved" : "Changes required"}
                  </span>
                </div>
                {round.reasons.length > 0 ? (
                  <ul className={styles.reviewListBullets}>
                    {round.reasons.map((reason, idx) => (
                      <li key={`reason-${round.round}-${idx}`}>{reason}</li>
                    ))}
                  </ul>
                ) : null}
                {!round.approved && round.requiredChanges.length > 0 ? (
                  <ul className={styles.reviewListBullets}>
                    {round.requiredChanges.map((item, idx) => (
                      <li key={`change-${round.round}-${idx}`}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>Judge updates will appear here.</div>
        )}
        <StepActivity items={timeline} />
      </StepCard>
    );
  }

  const { docxPath, docxRelativePath, hasDocx } = exportData;
  const message = (() => {
    if (status === "error") return "Export failed — review tool activity for details.";
    if (status === "success") return hasDocx ? "Export complete. Download is ready." : "Export complete.";
    if (status === "running") return "Exporting draft to DOCX…";
    if (status === "pending") return running ? "Waiting to start export…" : "Export pending.";
    return "Export status updated.";
  })();
  const pathLabel = (docxRelativePath || docxPath || "").trim();

  return (
    <StepCard title="Export Progress" status={status} message={message}>
      <div className={styles.exportInfo}>
        <div className={styles.kpiLabel}>Output path</div>
        <div className={styles.exportPath}>{pathLabel || "—"}</div>
      </div>
      {!hasDocx && status === "success" ? (
        <div className={styles.kpiHint}>Final document saved, but path could not be determined.</div>
      ) : null}
      <StepActivity items={timeline} />
    </StepCard>
  );
}

type StepCardProps = {
  title: string;
  status: StepStatus;
  message?: string;
  children: ReactNode;
};

function StepCard({ title, status, message, children }: StepCardProps) {
  const pillClass = `${styles.statusPill} ${
    status === "success"
      ? styles.statusSuccess
      : status === "error"
        ? styles.statusError
        : status === "running"
          ? styles.statusRunning
          : styles.statusPending
  }`;

  // Error guidance by step type
  const getErrorGuidance = (stepTitle: string): string | null => {
    if (status !== "error") return null;
    if (stepTitle.includes("Transcription")) {
      return "💡 Common issues: Check audio file exists and is supported format (MP3, WAV, etc.). Verify API has sufficient quota. Large files may take 5-10 minutes.";
    }
    if (stepTitle.includes("Draft")) {
      return "💡 Common issues: Check token limits haven't been exceeded. Verify API key is valid. Ensure prompt configuration is correct.";
    }
    if (stepTitle.includes("Review")) {
      return "💡 Common issues: Draft may violate policies. Check policy configuration. Increase max review rounds if needed.";
    }
    if (stepTitle.includes("Export")) {
      return "💡 Common issues: Template file may not exist or be corrupted. Output path may have permission issues. Verify paths are correct.";
    }
    return null;
  };

  const errorGuidance = getErrorGuidance(title);

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardHeading}>{title}</h3>
        <span className={pillClass}>{capitalize(status)}</span>
      </div>
      {message ? <p className={styles.cardSub}>{message}</p> : null}
      {errorGuidance ? <p className={styles.errorGuidance}>{errorGuidance}</p> : null}
      <div className={styles.cardBody}>{children}</div>
    </div>
  );
}

type StepActivityProps = {
  items: TimelineItem[];
};

function StepActivity({ items }: StepActivityProps) {
  const ordered = [...items]
    .sort((a, b) => {
      const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 4);

  if (ordered.length === 0) {
    return (
      <div className={styles.section}>
        <div className={styles.sectionHeading}>Tool Activity</div>
        <div className={styles.emptyState}>Tool calls will appear here once this step runs.</div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeading}>Tool Activity</div>
      <div className={`${styles.timeline} ${styles.timelineCompact}`}>
        {ordered.map((item) => {
          const statusStyle =
            item.status === "error"
              ? styles.tlErr
              : item.status === "success"
                ? styles.tlOk
                : styles.tlRun;
          const headerClass = `${styles.timelineCard} ${statusStyle}`;
          const inferredDuration =
            item.durationMs ??
            (item.status === "running" && item.startedAt
              ? Math.max(0, Date.now() - new Date(item.startedAt).getTime())
              : undefined);
          const phaseLabel = item.phase === "unknown" ? "—" : capitalize(item.phase);
          const startLabel = formatClock(item.startedAt);
          const finishLabel =
            item.finishedAt && (item.status === "success" || item.status === "error")
              ? formatClock(item.finishedAt)
              : undefined;
          const chunkDetails =
            item.phase === "transcribe" ? summarizeTranscribeInput(item.inputSummary) : null;
          const inputText =
            item.phase === "transcribe"
              ? chunkDetails
              : summarizeValue(item.inputSummary, 120);
          const outputText = item.isError ? summarizeValue(item.contentSummary, 120) : null;

          return (
            <div key={item.id} className={headerClass}>
              <div className={styles.timelineHeader}>
                <div className={styles.tlStatus}>{capitalize(item.status)}</div>
                <div className={styles.tlName}>{describeToolName(item.name)}</div>
                <div className={styles.tlRight}>{formatDurationMs(inferredDuration)}</div>
              </div>
              <div className={styles.timelineBody}>
                <div className={styles.tlLine}>
                  <span className={styles.tlMeta}>Phase</span>
                  <span>{phaseLabel}</span>
                </div>
                {startLabel !== "—" ? (
                  <div className={styles.tlLine}>
                    <span className={styles.tlMeta}>Start</span>
                    <span>{startLabel}</span>
                  </div>
                ) : null}
                {finishLabel ? (
                  <div className={styles.tlLine}>
                    <span className={styles.tlMeta}>Finish</span>
                    <span>{finishLabel}</span>
                  </div>
                ) : null}
                {chunkDetails && item.phase === "transcribe" ? (
                  <div className={styles.tlLine}>
                    <span className={styles.tlMeta}>Details</span>
                    <span>{chunkDetails}</span>
                  </div>
                ) : null}
                {inputText && item.phase !== "transcribe" ? (
                  <div className={styles.tlLine}>
                    <span className={styles.tlMeta}>Input</span>
                    <span className={styles.tlCode} title={inputText}>{inputText}</span>
                  </div>
                ) : null}
                {outputText ? (
                  <div className={styles.tlLine}>
                    <span className={styles.tlMeta}>Output</span>
                    <span className={styles.tlCode} title={outputText}>{outputText}</span>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type StreamingLinesProps = {
  label: string;
  lines: string[];
  placeholder: string;
  status?: "streaming" | "complete" | undefined;
};

function StreamingLines({ label, lines, placeholder, status }: StreamingLinesProps) {
  const hasLines = lines.length > 0;
  return (
    <div className={styles.streamSection} aria-live="polite" aria-atomic="false">
      <div className={styles.kpiLabel}>{label}</div>
      {hasLines ? (
        <div className={styles.streamLines}>
          {lines.map((line, index) => (
            <div key={`${line}-${index}`} className={styles.streamLine}>{line}</div>
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>{placeholder}</div>
      )}
      {status === "streaming" ? <div className={styles.streamBadge}>Streaming…</div> : null}
    </div>
  );
}

type ArtifactsProps = {
  finalDraft: string;
  docxPath: string;
  docxRelative: string;
};

function Artifacts({ finalDraft, docxPath, docxRelative }: ArtifactsProps) {
  const downloadHref = useMemo(() => {
    const candidate = (docxRelative || docxPath || "").trim();
    if (!candidate) {
      return "";
    }
    const normalized = candidate.replace(/^\/+/, "");
    return `/api/download?path=${encodeURIComponent(normalized)}`;
  }, [docxPath, docxRelative]);
  // Default: open preview if no DOCX yet; collapse when DOCX exists
  const [showPreview, setShowPreview] = useState<boolean>(() => !downloadHref);
  const userToggledRef = useRef(false);
  const previewId = useMemo(
    () => `draft-preview-${Math.random().toString(36).slice(2, 8)}`,
    []
  );

  useEffect(() => {
    // Auto-collapse when a DOCX becomes available unless the user has toggled manually
    if (downloadHref && !userToggledRef.current) {
      setShowPreview(false);
    }
  }, [downloadHref]);

  const onTogglePreview = () => {
    userToggledRef.current = true;
    setShowPreview((v) => !v);
  };

  return (
    <div className={styles.card}>
      <h3 className={styles.centeredHeading}>Draft PIP</h3>
      <div className={styles.artifacts}>
        <div>
          {finalDraft ? (
            <>
              <button
                type="button"
                className={styles.toggleBtn}
                aria-expanded={showPreview}
                aria-controls={previewId}
                onClick={onTogglePreview}
              >
                {showPreview ? "Hide preview" : "Show preview"}
              </button>
              {showPreview ? (
                <pre id={previewId} className={styles.pre}>
                  {finalDraft.slice(0, 6000)}
                </pre>
              ) : null}
            </>
          ) : null}
        </div>
        <div>
          {downloadHref ? (
            <a
              href={downloadHref}
              download
              className={styles.downloadBtn}
              aria-label={`Download ${docxRelative || docxPath}`}
              title={`Download ${docxRelative || docxPath}`}
            >
              <svg
                className={styles.downloadIcon}
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M12 11v6" />
                <path d="M9 14l3 3 3-3" />
              </svg>
              <span className={styles.srOnly}>Download {docxRelative || docxPath}</span>
            </a>
          ) : null}
          {(docxPath || docxRelative) ? (
            <div className={styles.docxPathHint}>{docxRelative || docxPath}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ProgressRing({ percent, label }: { percent?: number; label?: string }) {
  const hasValue = typeof percent === "number" && Number.isFinite(percent);
  const p = hasValue ? Math.max(0, Math.min(100, percent)) : 0;
  const progressColor = "var(--ring-progress-color, #22c55e)";
  const trackColor = "var(--ring-track-color, #e5e7eb)";
  const bg = `conic-gradient(${progressColor} ${p * 3.6}deg, ${trackColor} 0)`;
  return (
    <div
      className={styles.ring}
      style={{ backgroundImage: bg }}
      aria-label={hasValue ? `Progress ${p}%` : "Progress unavailable"}
      role="img"
    >
      <div className={styles.ringInner}>
        {hasValue ? `${p}%` : "—"}
        {label ? <div className={styles.ringSub}>{label}</div> : null}
      </div>
    </div>
  );
}

function Toasts({ toasts, onClose }: { toasts: Array<{ id: string; text: string; level: string }>; onClose: (id: string) => void }) {
  return (
    <div className={styles.toasts} aria-live="polite" aria-atomic="true">
      {toasts.map((t) => (
        <div key={t.id} className={`${styles.toast} ${t.level === "error" ? styles.toastErr : t.level === "success" ? styles.toastOk : t.level === "warn" ? styles.toastWarn : styles.toastInfo}`} onClick={() => onClose(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

