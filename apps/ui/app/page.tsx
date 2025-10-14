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

type JudgeRound = {
  approved: boolean;
  reasons: string[];
  required_changes: string[];
  revised_draft: string | null;
  round: number;
};

type CostState = {
  tokens: number;
  usd: number;
  breakdown: Record<string, unknown>;
};

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
  const [judgeRounds, setJudgeRounds] = useState<JudgeRound[]>([]);
  const [transcriptPreview, setTranscriptPreview] = useState("");
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [finalDraft, setFinalDraft] = useState("");
  const [docxPath, setDocxPath] = useState("");
  const [docxRelativePath, setDocxRelativePath] = useState("");
  const [cost, setCost] = useState<CostState>({ tokens: 0, usd: 0, breakdown: {} });

  const logRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const pushLog = useCallback((type: string, payload: unknown) => {
    setLogs((prev) => [...prev, { ts: Date.now(), type, payload }].slice(-5000));
  }, []);

  const resetState = useCallback(() => {
    setSteps({ ...defaultSteps });
    setChunks({ processed: 0, total: 0 });
    setJudgeRounds([]);
    setTranscriptPreview("");
    setLogs([]);
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

  const startRun = useCallback(() => {
    if (running) return;

    eventSourceRef.current?.close();
    resetState();
    setRunning(true);
    setRunStartTime(Date.now());

    const url = `/api/run?audio=${encodeURIComponent(audio)}&in=${encodeURIComponent(inLang)}&out=${encodeURIComponent(outLang)}&template=${encodeURIComponent(template)}&outdoc=${encodeURIComponent(outdoc)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener("status", (event) => {
      const data = safeJsonParse<{ step?: Step; status?: StepStatus; meta?: Record<string, unknown> }>((event as MessageEvent<string>).data) ?? {};
      if (data.step && data.status) {
        setSteps((prev) => ({ ...prev, [data.step as Step]: data.status as StepStatus }));
      }
      pushLog("status", data);
    });

    es.addEventListener("tool_use", (event) => {
      const data = safeJsonParse((event as MessageEvent<string>).data) ?? {};
      pushLog("tool_use", data);
    });

    es.addEventListener("tool_result", (event) => {
      const data = safeJsonParse((event as MessageEvent<string>).data) ?? {};
      pushLog("tool_result", data);
    });

    es.addEventListener("todo", (event) => {
      const data = safeJsonParse((event as MessageEvent<string>).data) ?? {};
      pushLog("todo", data);
    });

    es.addEventListener("transcript_chunk", (event) => {
      const data = safeJsonParse<{ transcript?: string; processedChunks?: number; totalChunks?: number }>((event as MessageEvent<string>).data);
      if (data) {
        if (data.transcript) {
          setTranscriptPreview((prev) => (prev ? prev : data.transcript));
        }
        setChunks({
          processed: typeof data.processedChunks === "number" ? data.processedChunks : 0,
          total: typeof data.totalChunks === "number" ? data.totalChunks : 0
        });
        pushLog("transcript_chunk", data);
      }
    });

    es.addEventListener("judge_round", (event) => {
      const data = safeJsonParse<JudgeRound>((event as MessageEvent<string>).data);
      if (data) {
        setJudgeRounds((prev) => [...prev, data]);
        pushLog("judge_round", data);
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
      const data = safeJsonParse<{ ok?: boolean; draft?: string; docx?: string; docxRelative?: string }>((event as MessageEvent<string>).data);
      if (data?.ok) {
        setFinalDraft(data.draft ?? "");
        setDocxPath(data.docx ?? "");
        setDocxRelativePath(data.docxRelative ?? "");
        pushLog("final", data);
      }
      setRunning(false);
      es.close();
      eventSourceRef.current = null;
    });

    es.addEventListener("error", (event) => {
      const data = (event as MessageEvent<string>).data;
      const parsed = safeJsonParse(data ?? null);
      handleStreamError(parsed ?? data ?? null);
      es.close();
      eventSourceRef.current = null;
    });

    es.onerror = () => {
      handleStreamError("Connection error");
      es.close();
      eventSourceRef.current = null;
    };

    pushLog("info", "Stream opened");
  }, [audio, handleStreamError, inLang, outLang, outdoc, pushLog, resetState, running, template]);

  const pct = useMemo(() => {
    if (!chunks.total || chunks.total <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((chunks.processed / chunks.total) * 100)));
  }, [chunks]);

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
                  ? `${chunks.processed}/${chunks.total} chunks (${pct}%) • ${formatElapsedTime(elapsedSeconds)} elapsed`
                  : steps.transcribe === "running" && elapsedSeconds > 5
                    ? `Processing... ${formatElapsedTime(elapsedSeconds)} elapsed`
                    : undefined
              },
              { key: "draft", label: "Draft", status: steps.draft },
              { key: "review", label: "Review", status: steps.review, meta: `rounds ${judgeRounds.length}` },
              { key: "export", label: "Export", status: steps.export }
            ]}
          />

          <Tabs>
            <Tab title="Timeline Logs">
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
            <Tab title="Judge Rounds">
              {judgeRounds.length === 0 ? (
                <em>No rounds yet.</em>
              ) : (
                judgeRounds.map((round) => (
                  <details key={round.round} open className={styles.round}>
                    <summary>
                      Round {round.round} — {round.approved ? "Approved ✅" : "Needs changes ⚠️"}
                    </summary>
                    {round.reasons?.length ? (
                      <div>
                        <strong>Reasons</strong>
                        <ul>
                          {round.reasons.map((reason, idx) => (
                            <li key={idx}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {round.required_changes?.length ? (
                      <div>
                        <strong>Required changes</strong>
                        <ul>
                          {round.required_changes.map((change, idx) => (
                            <li key={idx}>{change}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {round.revised_draft ? (
                      <div>
                        <strong>Revised draft (excerpt)</strong>
                        <pre className={styles.pre}>{round.revised_draft.slice(0, 1500)}</pre>
                      </div>
                    ) : null}
                  </details>
                ))
              )}
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
  steps: Array<{ key: string; label: string; status: StepStatus; meta?: string }>;
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
      <h3>Artifacts</h3>
      <div className={styles.artifacts}>
        <div>
          <div className={styles.kpiLabel}>Approved draft</div>
          {finalDraft ? (
            <pre className={styles.pre}>{finalDraft.slice(0, 6000)}</pre>
          ) : (
            <em>{running ? "Waiting for approval…" : "Will appear when approved."}</em>
          )}
        </div>
        <div>
          <div className={styles.kpiLabel}>DOCX</div>
          {href ? (
            <a href={href} download>
              Download {docxRelative || docxPath}
            </a>
          ) : (
            <em>{running ? "Export step pending." : "Will appear when exported."}</em>
          )}
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
