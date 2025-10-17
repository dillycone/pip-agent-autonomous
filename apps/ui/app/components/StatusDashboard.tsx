"use client";

import type { Step, StepStatus } from "../page";
import { formatDuration } from "../../lib/utils";
import styles from "../styles.module.css";

type StatusDashboardProps = {
  overallProgress: number;
  currentStep: Step;
  steps: Record<Step, StepStatus>;
  hasError: boolean;
  errorMessage?: string;
  elapsedSeconds: number;
  onCancel?: () => void;
  onRetry?: () => void;
  canRetry?: boolean;
};

export default function StatusDashboard({
  overallProgress,
  currentStep,
  steps,
  hasError,
  errorMessage,
  elapsedSeconds,
  onCancel,
  onRetry,
  canRetry
}: StatusDashboardProps) {

  const stepLabels: Record<Step, string> = {
    transcribe: "Transcribe",
    draft: "Draft",
    review: "Review",
    export: "Export"
  };

  const getStatusClass = (status: StepStatus): string => {
    switch (status) {
      case "success":
        return styles.statusSuccess;
      case "error":
        return styles.statusError;
      case "running":
        return styles.statusRunning;
      default:
        return styles.statusPending;
    }
  };

  const stepOrder: Step[] = ["transcribe", "draft", "review", "export"];

  return (
    <section className={styles.statusDashboard}>
      {/* Error Banner */}
      {hasError && (
        <div className={`${styles.errorBanner}`}>
          <div className={styles.errorContent}>
            <span className={styles.errorIcon}>⚠</span>
            <span>{errorMessage || "An error occurred during pipeline execution."}</span>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className={styles.statusContent}>
        {/* Progress Ring & Current Step */}
        <div className={styles.statusLeft}>
          <div className={styles.progressRingWrapper}>
            <ProgressRing percent={overallProgress} />
          </div>
          <div className={styles.statusInfo}>
            <div className={styles.statusLabel}>Overall Progress</div>
            <div className={styles.currentStep}>
              {stepLabels[currentStep]}
              <span className={styles.elapsedTime}>{formatDuration(elapsedSeconds)}</span>
            </div>
          </div>
        </div>

        {/* Status Pills */}
        <div className={styles.statusPills}>
          {stepOrder.map((step) => {
            const status = steps[step];
            const statusClass = getStatusClass(status);
            return (
              <div key={step} className={`${styles.statusPill} ${statusClass}`}>
                <span className={styles.pillDot}></span>
                <span className={styles.pillLabel}>{stepLabels[step]}</span>
              </div>
            );
          })}
        </div>

        {/* Action Buttons Placeholder (Phase 2) */}
        <div className={styles.statusActions}>
          {/* REPOMARK:SCOPE: 2 - Render cancel and retry buttons when provided by parent */}
          {onCancel && (
            <button
              onClick={onCancel}
              className={styles.actionBtn}
              title="Cancel this run"
            >
              Cancel
            </button>
          )}
          {canRetry && onRetry && (
            <button
              onClick={onRetry}
              className={`${styles.actionBtn} ${styles.actionBtnRetry}`}
              title="Retry with same inputs"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function ProgressRing({ percent }: { percent: number }) {
  const p = Math.max(0, Math.min(100, percent));
  const progressColor = "var(--ring-progress-color, #22c55e)";
  const trackColor = "var(--ring-track-color, #e5e7eb)";
  const bg = `conic-gradient(${progressColor} ${p * 3.6}deg, ${trackColor} 0)`;

  return (
    <div
      className={styles.ring}
      style={{ backgroundImage: bg }}
      aria-label={`Progress ${p}%`}
      role="img"
    >
      <div className={styles.ringInner}>{p}%</div>
    </div>
  );
}
