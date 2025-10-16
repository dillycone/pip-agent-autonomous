import styles from "../../styles.module.css";

export type CostState = {
  tokens: number;
  usd: number;
  breakdown: Record<string, unknown>;
};

export default function CostCard({ tokens, usd, breakdown }: CostState) {
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
