"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./styles.module.css";

type StepStatus = "pending" | "running" | "success" | "error";

type LogItem = {
  ts: number;
  type: string;
  payload: unknown;
};

type TimelineItem = {
  id: string;
  name: string;
  phase: string;
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

type RunMetadata = {
  runId: string;
  status: "pending" | "running" | "success" | "error" | "aborted";
  createdAt?: string;
};

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export default function DevToolsPage() {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [availableRuns, setAvailableRuns] = useState<RunMetadata[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [transcript, setTranscript] = useState("");
  const [cost, setCost] = useState<CostState>({ tokens: 0, usd: 0, breakdown: {} });
  const [loading, setLoading] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(true);

  const logRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const closeEventSource = useCallback((source: EventSource | null) => {
    if (!source) return;
    if (source.readyState !== EventSource.CLOSED) {
      source.close();
    }
  }, []);

  // Fetch available runs on mount
  useEffect(() => {
    const fetchRuns = async () => {
      try {
        const response = await fetch("/api/dev/runs");
        if (response.ok) {
          const data = await response.json();
          setAvailableRuns(data.runs || []);
        }
      } catch (error) {
        console.error("Failed to fetch runs:", error);
      } finally {
        setLoadingRuns(false);
      }
    };

    fetchRuns();
  }, []);

  // Clean up event source on unmount
  useEffect(() => {
    return () => {
      closeEventSource(eventSourceRef.current);
      eventSourceRef.current = null;
    };
  }, [closeEventSource]);

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const pushLog = useCallback((type: string, payload: unknown) => {
    setLogs((prev) => [...prev, { ts: Date.now(), type, payload }].slice(-5000));
  }, []);

  // When a run is selected, fetch its data and connect to stream if active
  useEffect(() => {
    if (!selectedRunId) {
      // Clear state when no run is selected
      setTimeline([]);
      setLogs([]);
      setTranscript("");
      setCost({ tokens: 0, usd: 0, breakdown: {} });
      closeEventSource(eventSourceRef.current);
      eventSourceRef.current = null;
      return;
    }

    const loadRun = async () => {
      setLoading(true);
      closeEventSource(eventSourceRef.current);
      eventSourceRef.current = null;

      // Reset state
      setTimeline([]);
      setLogs([]);
      setTranscript("");
      setCost({ tokens: 0, usd: 0, breakdown: {} });

      try {
        // Fetch run metadata
        const response = await fetch(`/api/dev/runs/${encodeURIComponent(selectedRunId)}`);
        if (!response.ok) {
          pushLog("error", "Failed to load run data");
          setLoading(false);
          return;
        }

        const data = await response.json();
        const runStatus = data.status;

        // If run is active, connect to SSE stream
        if (runStatus === "running" || runStatus === "pending") {
          const es = new EventSource(`/api/run/${encodeURIComponent(selectedRunId)}/stream`);
          eventSourceRef.current = es;

          es.addEventListener("status", (event) => {
            const data = safeJsonParse<{ step?: string; status?: StepStatus; meta?: Record<string, unknown>; at?: string }>((event as MessageEvent<string>).data) ?? {};
            pushLog("status", data);
          });

          es.addEventListener("tool_use", (event) => {
            const data = safeJsonParse<{ id?: string; name?: string; startedAt?: string; inputSummary?: unknown }>((event as MessageEvent<string>).data) ?? {};
            if (data?.id && data?.name) {
              setTimeline((prev) => ([
                ...prev,
                {
                  id: data.id!,
                  name: data.name!,
                  phase: "unknown",
                  status: "running",
                  startedAt: data.startedAt,
                  inputSummary: data.inputSummary
                }
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
            pushLog("tool_result", data);
          });

          es.addEventListener("transcript_chunk", (event) => {
            const data = safeJsonParse<{ transcript?: string; at?: string }>((event as MessageEvent<string>).data);
            if (data?.transcript) {
              setTranscript(data.transcript);
            }
            pushLog("transcript_chunk", data);
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
            pushLog("cost", data);
          });

          es.addEventListener("final", (event) => {
            const data = safeJsonParse((event as MessageEvent<string>).data);
            pushLog("final", data);
            closeEventSource(es);
            if (eventSourceRef.current === es) {
              eventSourceRef.current = null;
            }
          });

          es.addEventListener("error", (event) => {
            const data = (event as MessageEvent<string>).data;
            const parsed = safeJsonParse(data ?? null);
            pushLog("error", parsed ?? data ?? null);
            closeEventSource(es);
            if (eventSourceRef.current === es) {
              eventSourceRef.current = null;
            }
          });

          es.onerror = () => {
            pushLog("error", "Connection error");
            closeEventSource(es);
            if (eventSourceRef.current === es) {
              eventSourceRef.current = null;
            }
          };

          pushLog("info", `Stream opened for run ${selectedRunId}`);
        } else {
          // For completed runs, we'd load historical data here
          pushLog("info", `Loaded completed run ${selectedRunId} (status: ${runStatus})`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushLog("error", message);
      } finally {
        setLoading(false);
      }
    };

    loadRun();
  }, [selectedRunId, closeEventSource, pushLog]);

  const currentRun = useMemo(() => {
    return availableRuns.find(r => r.runId === selectedRunId);
  }, [availableRuns, selectedRunId]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Developer Tools</h1>
        <div className={styles.headerRow}>
          <select
            className={styles.runSelector}
            value={selectedRunId ?? ""}
            onChange={(e) => setSelectedRunId(e.target.value || null)}
            disabled={loadingRuns}
          >
            <option value="">Select a run...</option>
            {availableRuns.map((run) => (
              <option key={run.runId} value={run.runId}>
                {run.runId} ({run.status})
              </option>
            ))}
          </select>
          {currentRun && (
            <span className={`${styles.statusBadge} ${styles[`status${capitalize(currentRun.status)}`]}`}>
              {currentRun.status}
            </span>
          )}
        </div>
      </header>

      {!selectedRunId ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyStateTitle}>No run selected</div>
          <p>Select a run from the dropdown above to view its timeline, logs, transcript, and cost data.</p>
        </div>
      ) : loading ? (
        <div className={styles.loading}>Loading run data...</div>
      ) : (
        <Tabs>
          <Tab title="Timeline">
            <ActivityTimeline items={timeline} />
          </Tab>
          <Tab title="Logs (Raw)">
            <div ref={logRef} className={styles.console}>
              {logs.length === 0 ? (
                <div className={styles.logLinePlaceholder}>No logs yet. Stream output will appear here.</div>
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
              {transcript.trim() ? transcript : "No transcript data available yet."}
            </pre>
          </Tab>
          <Tab title="Cost">
            <CostCard tokens={cost.tokens} usd={cost.usd} breakdown={cost.breakdown} />
          </Tab>
        </Tabs>
      )}
    </main>
  );
}

// Component: Tabs and Tab
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

// Component: CostCard
function CostCard({ tokens, usd, breakdown }: CostState) {
  return (
    <div className={styles.card}>
      <h3>Cost Summary</h3>
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
      <details>
        <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: "8px" }}>Breakdown</summary>
        <pre className={styles.pre}>{JSON.stringify(breakdown, null, 2)}</pre>
      </details>
    </div>
  );
}

// Component: ActivityTimeline
function ActivityTimeline({ items }: { items: TimelineItem[] }) {
  if (!items.length) return <em>No tool activity yet.</em>;
  return (
    <div className={styles.timeline}>
      {items.map((it) => (
        <div key={it.id} className={`${styles.timelineCard} ${it.status === "running" ? styles.tlRun : it.status === "success" ? styles.tlOk : styles.tlErr}`}>
          <div className={styles.timelineHeader}>
            <span className={styles.tlStatus}>{it.status === "running" ? "RUN" : it.status === "success" ? "OK" : "ERR"}</span>
            <span className={styles.tlName}>{it.name}</span>
            <span className={styles.tlRight}>{it.durationMs ? `${(it.durationMs/1000).toFixed(1)}s` : it.status === "running" ? "&" : null}</span>
          </div>
          <div className={styles.timelineBody}>
            {it.inputSummary ? <div className={styles.tlLine}><strong>Input</strong> <code className={styles.tlCode}>{truncate(JSON.stringify(it.inputSummary), 140)}</code></div> : null}
            {it.contentSummary ? <div className={styles.tlLine}><strong>Result</strong> <code className={styles.tlCode}>{truncate(JSON.stringify(it.contentSummary), 140)}</code></div> : null}
            <div className={styles.tlMeta}>Start {it.startedAt ? new Date(it.startedAt).toLocaleTimeString() : ""} {it.finishedAt ? `" End ${new Date(it.finishedAt).toLocaleTimeString()}` : ""}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Utility functions
function truncate(s: string, n = 140) {
  if (!s) return s as unknown as string;
  return s.length > n ? s.slice(0, n - 1) + "&" : s;
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
