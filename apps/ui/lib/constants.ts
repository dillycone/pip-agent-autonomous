import type { Step, StepStatus, StepRecord } from "./types";

/**
 * Step Order
 *
 * Defines the execution order of pipeline steps.
 */
export const STEP_ORDER: readonly Step[] = [
  "transcribe",
  "draft",
  "review",
  "export"
] as const;

/**
 * Step Labels
 *
 * Human-readable labels for each pipeline step.
 */
export const STEP_LABELS: Record<Step, string> = {
  transcribe: "Transcribe",
  draft: "Draft",
  review: "Review",
  export: "Export"
};

/**
 * Default Step States
 *
 * Initial state for all pipeline steps.
 */
export const DEFAULT_STEPS: StepRecord = {
  transcribe: "pending",
  draft: "pending",
  review: "pending",
  export: "pending"
};
