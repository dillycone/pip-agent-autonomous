"use client";

import type { Step, StepStatus } from "../../lib/types";
import { STEP_ORDER, STEP_LABELS } from "../../lib/constants";
import { formatDuration } from "../../lib/utils";
import ProgressRing from "./shared/ProgressRing";
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
              {STEP_LABELS[currentStep]}
              <span className={styles.elapsedTime}>{formatDuration(elapsedSeconds)}</span>
            </div>
          </div>
        </div>

        {/* Status Pills */}
        <div className={styles.statusPills}>
          {STEP_ORDER.map((step) => {
            const status = steps[step];
            const statusClass = getStatusClass(status);
            return (
              <div key={step} className={`${styles.statusPill} ${statusClass}`}>
                <span className={styles.pillDot}></span>
                <span className={styles.pillLabel}>{STEP_LABELS[step]}</span>
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
