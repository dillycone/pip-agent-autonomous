"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./styles.module.css";

type Step = "transcribe" | "draft" | "review" | "export";
type StepStatus = "pending" | "running" | "success" | "error";

type LogItem = {
  ts: number;
  type: string;
  payload: unknown;
};

type TimelineItem = {
  id: string;
  name: string;
  phase: Step | "unknown";
  status: StepStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  inputSummary?: unknown;
  contentSummary?: unknown;
  isError?: boolean;
};

type CostState = {
  tokens: number;
  usd: number;
  breakdown: Record<string, unknown>;
};

const ALLOWED_AUDIO_EXTENSIONS = [
  ".mp3",
  ".wav",
  ".flac",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".wma",
  ".aiff",
  ".ape",
  ".ac3"
];
const ALLOWED_TEMPLATE_EXTENSIONS = [".docx"];
const ALLOWED_OUTPUT_EXTENSIONS = [".docx"];
const PATH_TRAVERSAL_PATTERN = /(^|[\\/])\.\.([\\/]|$)/;

function hasAllowedExtension(value: string, allowed: string[]): boolean {
  const lower = value.toLowerCase();
  return allowed.some((ext) => lower.endsWith(ext));
}

const defaultSteps: Record<Step, StepStatus> = {
  transcribe: "pending",
  draft: "pending",
  review: "pending",
  export: "pending"
};

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export default function Page() {
  const [audio, setAudio] = useState("uploads/meeting.mp3");
  const [inLang, setInLang] = useState("auto");
  const [outLang, setOutLang] = useState("en");
  const [template, setTemplate] = useState("templates/pip-template.docx");
  const [outdoc, setOutdoc] = useState(() => `exports/pip-${Date.now()}.docx`);

  const [running, setRunning] = useState(false);
  const [runStartTime, setRunStartTime] = useState<number | null>(null);
  const [steps, setSteps] = useState<Record<Step, StepStatus>>({ ...defaultSteps });
  const [chunks, setChunks] = useState<{ processed: number; total: number }>({ processed: 0, total: 0 });
  const [transcriptPreview, setTranscriptPreview] = useState("");
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [finalDraft, setFinalDraft] = useState("");
  const [docxPath, setDocxPath] = useState("");
  const [docxRelativePath, setDocxRelativePath] = useState("");
  const [cost, setCost] = useState<CostState>({ tokens: 0, usd: 0, breakdown: {} });

  const [toasts, setToasts] = useState<Array<{ id: string; text: string; level: "info" | "warn" | "error" | "success" }>>([]);

  const logRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const closeEventSource = useCallback((source: EventSource | null) => {
    if (!source) return;
    if (source.readyState !== EventSource.CLOSED) {
      source.close();
    }
  }, []);

  useEffect(() => {
    return () => {
      closeEventSource(eventSourceRef.current);
      eventSourceRef.current = null;
    };
  }, [closeEventSource]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

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
    setSteps({ ...defaultSteps });
    setChunks({ processed: 0, total: 0 });
    setTranscriptPreview("");
    setLogs([]);
    setTimeline([]);
    setFinalDraft("");
    setDocxPath("");
    setDocxRelativePath("");
    setCost({ tokens: 0, usd: 0, breakdown: {} });
    setRunStartTime(null);
  }, []);

  const handleStreamError = useCallback((payload: unknown) => {
    pushLog("error", payload ?? "Stream error");
    setRunning(false);
    setSteps((prev) => {
      const updated: Record<Step, StepStatus> = { ...prev };
      (Object.keys(updated) as Step[]).forEach((step) => {
        if (updated[step] === "running") {
          updated[step] = "error";
        }
      });
      return updated;
    });
  }, [pushLog]);

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
        setRunStartTime(null);
        return;
      }

      const { runId } = payload as { runId: string };
      pushLog("run", payload);

      const es = new EventSource(`/api/run/${encodeURIComponent(runId)}/stream`);
      eventSourceRef.current = es;
      setRunStartTime(Date.now());

      es.addEventListener("status", (event) => {
        const data = safeJsonParse<{ step?: Step; status?: StepStatus; meta?: Record<string, unknown>; at?: string }>((event as MessageEvent<string>).data) ?? {};
        if (data.step && data.status) {
          setSteps((prev) => ({ ...prev, [data.step as Step]: data.status as StepStatus }));
          if (data.status === "running") pushToast(`${capitalize(data.step)} started`, "info");
          if (data.status === "success") pushToast(`${capitalize(data.step)} complete`, "success");
          if (data.status === "error") pushToast(`${capitalize(data.step)} error`, "error");
        }
        pushLog("status", data);
      });

      es.addEventListener("tool_use", (event) => {
        const data = safeJsonParse<{ id?: string; name?: string; startedAt?: string; inputSummary?: unknown }>((event as MessageEvent<string>).data) ?? {};
        if (data?.id && data?.name) {
          const phase: Step | "unknown" = data.name.includes("gemini-transcriber")
            ? "transcribe"
            : data.name.includes("pip-generator")
              ? "draft"
              : data.name.includes("docx-exporter")
                ? "export"
                : "unknown";
          setTimeline((prev) => ([
            ...prev,
            { id: data.id!, name: data.name!, phase, status: "running", startedAt: data.startedAt, inputSummary: data.inputSummary }
          ]).slice(-500));
        }
        pushLog("tool_use", data);
      });

      es.addEventListener("tool_result", (event) => {
        const data = safeJsonParse<{ id?: string; name?: string; isError?: boolean; content?: unknown; finishedAt?: string; durationMs?: number }>((event as MessageEvent<string>).data) ?? {};
        if (data?.id) {
          setTimeline((prev) => prev.map((t) => t.id === data.id ? ({
            ...t,
            status: data.isError ? "error" : "success",
            isError: data.isError,
            finishedAt: data.finishedAt,
            durationMs: data.durationMs,
            contentSummary: data.content
          }) : t));
        }
        if (data?.isError) pushToast(`Tool error: ${data.name ?? data.id}`, "error");
        pushLog("tool_result", data);
      });

      es.addEventListener("todo", (event) => {
        const data = safeJsonParse((event as MessageEvent<string>).data) ?? {};
        pushLog("todo", data);
      });

      es.addEventListener("transcript_chunk", (event) => {
        const data = safeJsonParse<{ transcript?: string; processedChunks?: number; totalChunks?: number; at?: string }>((event as MessageEvent<string>).data);
        if (data) {
          if (data.transcript && data.transcript.trim()) {
            setTranscriptPreview(data.transcript);
          }
          setChunks((prev) => {
            let processed = typeof data.processedChunks === "number" && Number.isFinite(data.processedChunks)
              ? data.processedChunks
              : prev.processed;
            if ((!processed || processed <= 0) && data.transcript) {
              processed = Math.max(prev.processed, 1);
            }
            let total = typeof data.totalChunks === "number" && Number.isFinite(data.totalChunks)
              ? data.totalChunks
              : prev.total;
            if ((!total || total <= 0) && processed && processed > 0) {
              total = processed;
            }
            if (!Number.isFinite(processed) || processed < 0) processed = 0;
            if (!Number.isFinite(total) || total < 0) total = 0;
            return { processed, total };
          });
          pushLog("transcript_chunk", data);
        }
      });

      es.addEventListener("cost", (event) => {
        const data = safeJsonParse<{ summary?: { totalTokens?: number; estimatedCostUSD?: number; breakdown?: Record<string, unknown> } }>((event as MessageEvent<string>).data);
        if (data?.summary) {
          setCost({
            tokens: data.summary.totalTokens ?? 0,
            usd: data.summary.estimatedCostUSD ?? 0,
            breakdown: data.summary.breakdown ?? {}
          });
        }
      });

      es.addEventListener("final", (event) => {
        const data = safeJsonParse<{ ok?: boolean; draft?: string; docx?: string; docxRelative?: string; at?: string }>((event as MessageEvent<string>).data);
        if (data?.ok) {
          setFinalDraft(data.draft ?? "");
          setDocxPath(data.docx ?? "");
          setDocxRelativePath(data.docxRelative ?? "");
          pushLog("final", data);
          pushToast("Export complete", "success");
        }
        setRunning(false);
        closeEventSource(es);
        if (eventSourceRef.current === es) {
          eventSourceRef.current = null;
        }
      });

      es.addEventListener("error", (event) => {
        const data = (event as MessageEvent<string>).data;
        const parsed = safeJsonParse(data ?? null);
        handleStreamError(parsed ?? data ?? null);
        closeEventSource(es);
        if (eventSourceRef.current === es) {
          eventSourceRef.current = null;
        }
      });

      es.onerror = () => {
        handleStreamError("Connection error");
        closeEventSource(es);
        if (eventSourceRef.current === es) {
          eventSourceRef.current = null;
        }
      };

      pushLog("info", `Stream opened for run ${runId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushToast(`Run failed: ${message}`, "error");
      pushLog("error", message);
      setRunning(false);
      setRunStartTime(null);
    }
  }, [audio, handleStreamError, inLang, outLang, outdoc, pushLog, pushToast, resetState, running, template, validateFormInputs, closeEventSource]);

  const pct = useMemo(() => {
    if (!chunks.total || chunks.total <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((chunks.processed / chunks.total) * 100)));
  }, [chunks]);

  const eta = useMemo(() => {
    if (!running || !chunks.total || chunks.total <= 0 || chunks.processed <= 0 || !runStartTime) return null;
    const elapsed = (Date.now() - runStartTime) / 1000;
    const rate = chunks.processed / Math.max(1, elapsed);
    if (rate <= 0) return null;
    const remaining = chunks.total - chunks.processed;
    return Math.round(remaining / rate);
  }, [running, chunks, runStartTime]);

  // Track elapsed time for long-running transcriptions
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!running || !runStartTime) {
      setElapsedSeconds(0);
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - runStartTime) / 1000);
      setElapsedSeconds(elapsed);
    }, 1000);

    return () => clearInterval(interval);
  }, [running, runStartTime]);

  const formatElapsedTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <main className={styles.page}>
      <Toasts toasts={toasts} onClose={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
      <header className={styles.header}>
        <h1>PIP Agent — Autonomous Run</h1>
        <p className={styles.sub}>
          Watch transcription → draft → policy review → export in real time.
          {running && steps.transcribe === "running" && elapsedSeconds > 30 && (
            <span style={{ display: "block", marginTop: "0.5rem", fontSize: "0.9em", opacity: 0.8 }}>
              Long audio files may take 5-10 minutes to transcribe. Progress updates appear periodically.
            </span>
          )}
        </p>
      </header>

      <section className={styles.formRow}>
        <label htmlFor="audio">Audio</label>
        <input id="audio" value={audio} onChange={(e) => setAudio(e.target.value)} placeholder="uploads/meeting.mp3" />
        <label htmlFor="inLang">Input</label>
        <input id="inLang" value={inLang} onChange={(e) => setInLang(e.target.value)} placeholder="auto" />
        <label htmlFor="outLang">Output</label>
        <input id="outLang" value={outLang} onChange={(e) => setOutLang(e.target.value)} placeholder="en" />
        <label htmlFor="template">Template</label>
        <input id="template" value={template} onChange={(e) => setTemplate(e.target.value)} />
        <label htmlFor="outdoc">Out Doc</label>
        <input id="outdoc" value={outdoc} onChange={(e) => setOutdoc(e.target.value)} />
        <button onClick={startRun} disabled={running} className={styles.runBtn}>
          {running ? "Running…" : "Start Run"}
        </button>
      </section>

      <section className={styles.grid}>
        <div className={styles.leftCol}>
          <Stepper
            steps={[
              {
                key: "transcribe",
                label: "Transcribe",
                status: steps.transcribe,
                meta: chunks.total
                  ? `${chunks.processed}/${chunks.total} chunks (${pct}%) • ${formatElapsedTime(elapsedSeconds)} elapsed${eta ? ` • ETA ${formatElapsedTime(eta)}` : ""}`
                  : steps.transcribe === "running" && elapsedSeconds > 5
                    ? `Processing... ${formatElapsedTime(elapsedSeconds)} elapsed`
                    : undefined,
                progress: chunks.total ? pct : undefined
              },
              { key: "draft", label: "Draft", status: steps.draft },
              { key: "review", label: "Review", status: steps.review },
              { key: "export", label: "Export", status: steps.export }
            ]}
          />

          <Tabs>
            <Tab title="Timeline">
              <ActivityTimeline items={timeline} />
            </Tab>
            <Tab title="Logs (Raw)">
              <div ref={logRef} className={styles.console}>
                {logs.length === 0 ? (
                  <div className={styles.logLinePlaceholder}>Stream output will appear here.</div>
                ) : (
                  logs.map((log, index) => (
                    <div key={`${log.ts}-${index}`} className={styles.logLine}>
                      <span className={styles.logTs}>{new Date(log.ts).toLocaleTimeString()}</span>
                      <span className={styles.logType}>{log.type}</span>
                      <span className={styles.logText}>
                        {typeof log.payload === "string" ? log.payload : JSON.stringify(log.payload)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Tab>
            <Tab title="Transcript">
              <pre className={styles.pre}>
                {transcriptPreview.trim() ? transcriptPreview : "Transcript preview will appear here (first 1,500 characters)."}
              </pre>
            </Tab>
            <Tab title="Cost">
              <CostCard tokens={cost.tokens} usd={cost.usd} breakdown={cost.breakdown} />
            </Tab>
          </Tabs>
        </div>

        <div className={styles.rightCol}>
          <Artifacts finalDraft={finalDraft} docxPath={docxPath} docxRelative={docxRelativePath} running={running} />
        </div>
      </section>
    </main>
  );
}

type StepperProps = {
  steps: Array<{ key: string; label: string; status: StepStatus; meta?: string; progress?: number }>;
};

function Stepper({ steps }: StepperProps) {
  return (
    <div className={styles.stepper}>
      {steps.map((step, index) => (
        <div key={step.key} className={`${styles.step} ${styles[`step${capitalize(step.status)}`] ?? ""}`}>
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
        </div>
      ))}
    </div>
  );
}

type TabsProps = {
  children: React.ReactNode;
};

type TabProps = {
  title: string;
  children: React.ReactNode;
};

function Tabs({ children }: TabsProps) {
  const nodes = useMemo(() => {
    return (Array.isArray(children) ? children : [children]) as React.ReactElement<TabProps>[];
  }, [children]);

  const [idx, setIdx] = useState(0);

  return (
    <div className={styles.tabs}>
      <div className={styles.tabBar} role="tablist">
        {nodes.map((child, i) => (
          <button
            key={child.props.title ?? i}
            type="button"
            role="tab"
            aria-selected={idx === i}
            className={`${styles.tabBtn} ${idx === i ? styles.active : ""}`}
            onClick={() => setIdx(i)}
          >
            {child.props.title}
          </button>
        ))}
      </div>
      <div className={styles.tabPanel} role="tabpanel">
        {nodes[idx]}
      </div>
    </div>
  );
}

function Tab({ children }: TabProps) {
  return <>{children}</>;
}

Tab.displayName = "Tab";

function CostCard({ tokens, usd, breakdown }: CostState) {
  return (
    <div className={styles.card}>
      <h3>Cost</h3>
      <div className={styles.kpis}>
        <div>
          <div className={styles.kpiLabel}>Total tokens</div>
          <div className={styles.kpiValue}>{Number.isFinite(tokens) ? tokens.toLocaleString() : "0"}</div>
        </div>
        <div>
          <div className={styles.kpiLabel}>Est. USD</div>
          <div className={styles.kpiValue}>${Number.isFinite(usd) ? usd.toFixed(4) : "0.0000"}</div>
        </div>
      </div>
      <pre className={styles.pre}>{JSON.stringify(breakdown, null, 2)}</pre>
    </div>
  );
}

type ArtifactsProps = {
  finalDraft: string;
  docxPath: string;
  docxRelative: string;
  running: boolean;
};

function Artifacts({ finalDraft, docxPath, docxRelative, running }: ArtifactsProps) {
  const href = docxRelative ? `/${docxRelative}` : docxPath ? docxPath : "";
  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitleCentered}>Draft PIP</h3>
      <div className={styles.artifacts}>
        <div>
          {finalDraft ? (
            <pre className={styles.pre}>{finalDraft.slice(0, 6000)}</pre>
          ) : running ? (
            <em className={styles.artifactStatus}>Waiting for approval…</em>
          ) : null}
        </div>
        <div className={styles.docxSection}>
          {href ? (
            <a className={styles.docxLink} href={href} download>
              <svg
                className={styles.docxIcon}
                viewBox="0 0 64 64"
                role="img"
                aria-label="Download DOCX"
              >
                <path
                  d="M20 6c-2.2 0-4 1.8-4 4v44c0 2.2 1.8 4 4 4h24c2.2 0 4-1.8 4-4V22L36 6H20z"
                  fill="#e2e8f0"
                />
                <path d="M36 6v14h12L36 6z" fill="#cbd5f5" />
                <path
                  d="M22 32h20M22 40h20M22 48h20"
                  stroke="#1d4ed8"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                <path
                  d="M32 54l8-10H24l8 10z"
                  fill="#1d4ed8"
                />
              </svg>
              <span className={styles.srOnly}>Download {docxRelative || docxPath}</span>
            </a>
          ) : running ? (
            <em className={styles.artifactStatus}>Export step pending…</em>
          ) : null}
          {(docxPath || docxRelative) && !href.startsWith("/") ? (
            <div className={styles.docxPathHint}>{docxPath || docxRelative}</div>
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

function ProgressRing({ percent, label }: { percent: number; label?: string }) {
  const p = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const progressColor = "var(--ring-progress-color, #22c55e)";
  const trackColor = "var(--ring-track-color, #e5e7eb)";
  const bg = `conic-gradient(${progressColor} ${p * 3.6}deg, ${trackColor} 0)`;
  return (
    <div className={styles.ring} style={{ backgroundImage: bg }} aria-label={`Progress ${p}%`} role="img">
      <div className={styles.ringInner}>{Number.isFinite(p) ? `${p}%` : "—"}{label ? <div className={styles.ringSub}>{label}</div> : null}</div>
    </div>
  );
}

function ActivityTimeline({ items }: { items: TimelineItem[] }) {
  if (!items.length) return <em>No tool activity yet.</em>;
  return (
    <div className={styles.timeline}>
      {items.map((it) => (
        <div key={it.id} className={`${styles.timelineCard} ${it.status === "running" ? styles.tlRun : it.status === "success" ? styles.tlOk : styles.tlErr}`}>
          <div className={styles.timelineHeader}>
            <span className={styles.tlStatus}>{it.status === "running" ? "RUN" : it.status === "success" ? "OK" : "ERR"}</span>
            <span className={styles.tlName}>{it.name}</span>
            <span className={styles.tlRight}>{it.durationMs ? `${(it.durationMs/1000).toFixed(1)}s` : it.status === "running" ? "…" : null}</span>
          </div>
          <div className={styles.timelineBody}>
            {it.inputSummary ? <div className={styles.tlLine}><strong>Input</strong> <code className={styles.tlCode}>{truncate(JSON.stringify(it.inputSummary), 140)}</code></div> : null}
            {it.contentSummary ? <div className={styles.tlLine}><strong>Result</strong> <code className={styles.tlCode}>{truncate(JSON.stringify(it.contentSummary), 140)}</code></div> : null}
            <div className={styles.tlMeta}>Start {it.startedAt ? new Date(it.startedAt).toLocaleTimeString() : "—"} {it.finishedAt ? `• End ${new Date(it.finishedAt).toLocaleTimeString()}` : ""}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function truncate(s: string, n = 140) {
  if (!s) return s as unknown as string;
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
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
