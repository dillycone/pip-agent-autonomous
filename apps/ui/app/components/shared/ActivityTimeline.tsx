import styles from "../../styles.module.css";

type Step = "transcribe" | "draft" | "review" | "export";
type StepStatus = "pending" | "running" | "success" | "error";

export type TimelineItem = {
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

function truncate(s: string, n = 140) {
  if (!s) return s as unknown as string;
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export default function ActivityTimeline({ items }: { items: TimelineItem[] }) {
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
