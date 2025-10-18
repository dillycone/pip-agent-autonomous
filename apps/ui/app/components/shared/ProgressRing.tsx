import styles from "../../styles.module.css";

type ProgressRingProps = {
  percent?: number;
  label?: string;
};

/**
 * ProgressRing Component
 *
 * A circular progress indicator with a percentage display.
 *
 * @param {number} [percent] - The progress percentage (0-100). If undefined or not finite, displays "—"
 * @param {string} [label] - Optional label text to display below the percentage
 *
 * @example
 * ```tsx
 * <ProgressRing percent={75} label="3/4 chunks" />
 * <ProgressRing percent={50} />
 * <ProgressRing /> // Shows "—" when no percentage is provided
 * ```
 */
export default function ProgressRing({ percent, label }: ProgressRingProps) {
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
