"use client";

import React from "react";
import type { Step, StepStatus } from "@/lib/types";
import { STEP_ORDER, STEP_LABELS } from "@/lib/constants";
import PhaseCard from "./PhaseCard";
import styles from "./pipeline.module.css";

type PipelineStatusCardProps = {
  overallProgress: number;
  currentStep: Step;
  steps: Record<Step, StepStatus>;
  elapsedSeconds: number;
  onCancel?: () => void;
};

const phaseOrder: Step[] = ["transcribe", "draft", "review", "export"];
const phaseLabels: Record<Step, string> = {
  transcribe: "Listen",
  draft: "Draft",
  review: "Review",
  export: "Export"
};

export default function PipelineStatusCard({
  overallProgress,
  currentStep,
  steps,
  elapsedSeconds,
  onCancel
}: PipelineStatusCardProps) {
  const remainingMinutes = overallProgress > 0
    ? Math.ceil((elapsedSeconds / (overallProgress / 100)) - elapsedSeconds) / 60
    : null;

  const progressText = remainingMinutes && remainingMinutes > 0
    ? `${Math.ceil(remainingMinutes)} minute${Math.ceil(remainingMinutes) > 1 ? "s" : ""} remaining`
    : "Completing...";

  // Use labels that are more specific for the pipeline view
  const phaseLabels: Record<Step, string> = {
    transcribe: "Listen",
    draft: "Draft",
    review: "Review",
    export: "Export"
  };

  return (
    <div className={styles.pipelineCard}>
      <div className={styles.pipelineHeader}>
        <h2 className={styles.pipelineTitle}>Pipeline Execution</h2>
        {onCancel && (
          <button className={styles.cancelBtn} onClick={onCancel}>
            Cancel Run
          </button>
        )}
      </div>

      <div className={styles.progressSection}>
        <div className={styles.progressLabel}>
          <span>Progress: {overallProgress}% Complete</span>
          <span>{progressText}</span>
        </div>
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>

      <div className={styles.phaseGrid}>
        {STEP_ORDER.map((phase) => (
          <PhaseCard
            key={phase}
            label={phaseLabels[phase]}
            status={steps[phase]}
            isActive={phase === currentStep}
          />
        ))}
      </div>
    </div>
  );
}
