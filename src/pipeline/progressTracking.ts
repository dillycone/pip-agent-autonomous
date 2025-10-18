/**
 * Progress Tracking Module
 *
 * This module handles progress calculation and ETA estimation for the pipeline.
 * It provides utilities for:
 * - Calculating progress percentages for each step
 * - Estimating time remaining (ETA)
 * - Formatting progress messages for UI display
 * - Managing heuristic-based progress updates
 *
 * Progress is tracked across four main steps:
 * 1. Transcribe: Audio transcription (0-40%)
 * 2. Draft: PIP generation (40-70%)
 * 3. Review: Policy judge review (70-85%)
 * 4. Export: DOCX generation (85-100%)
 */

export type Step = "transcribe" | "draft" | "review" | "export";
export type StepStatus = "pending" | "running" | "success" | "error";

export interface ProgressWeights {
  transcribe: number;
  draft: number;
  review: number;
  export: number;
}

/**
 * Default progress weights for each pipeline step
 * These define how much of the total progress each step represents
 */
export const DEFAULT_PROGRESS_WEIGHTS: ProgressWeights = {
  transcribe: 40, // 0-40%
  draft: 30,      // 40-70%
  review: 15,     // 70-85%
  export: 15      // 85-100%
};

export interface StepProgress {
  step: Step;
  status: StepStatus;
  percentComplete: number;
  meta?: Record<string, unknown>;
}

export interface OverallProgress {
  percentComplete: number;
  currentStep: Step;
  stepProgress: StepProgress[];
  estimatedTimeRemaining?: number;
  startTime: number;
}

/**
 * Calculates the progress percentage for a specific step
 *
 * @param step - The pipeline step
 * @param status - Current status of the step
 * @param processedItems - Number of items processed (for transcription chunks)
 * @param totalItems - Total number of items (for transcription chunks)
 * @param weights - Custom progress weights (optional)
 * @returns Progress percentage (0-100)
 */
export function calculateStepProgress(
  step: Step,
  status: StepStatus,
  processedItems?: number,
  totalItems?: number,
  weights: ProgressWeights = DEFAULT_PROGRESS_WEIGHTS
): number {
  const stepWeight = weights[step];

  // Step hasn't started yet
  if (status === "pending") {
    return 0;
  }

  // Step is complete
  if (status === "success") {
    return stepWeight;
  }

  // Step failed
  if (status === "error") {
    return 0;
  }

  // Step is running - calculate partial progress
  if (step === "transcribe" && processedItems !== undefined && totalItems !== undefined && totalItems > 0) {
    // For transcription, use chunk progress
    const chunkProgress = Math.min(processedItems / totalItems, 1);
    return stepWeight * chunkProgress;
  }

  // For other steps, assume 50% complete when running
  return stepWeight * 0.5;
}

/**
 * Calculates overall pipeline progress across all steps
 *
 * @param stepStatuses - Map of step statuses
 * @param transcriptionProgress - Transcription chunk progress (optional)
 * @param weights - Custom progress weights (optional)
 * @returns Overall progress percentage (0-100)
 */
export function calculateOverallProgress(
  stepStatuses: Record<Step, StepStatus>,
  transcriptionProgress?: { processed: number; total: number },
  weights: ProgressWeights = DEFAULT_PROGRESS_WEIGHTS
): number {
  let cumulativeProgress = 0;
  const steps: Step[] = ["transcribe", "draft", "review", "export"];

  for (const step of steps) {
    const status = stepStatuses[step];
    const processedItems = step === "transcribe" ? transcriptionProgress?.processed : undefined;
    const totalItems = step === "transcribe" ? transcriptionProgress?.total : undefined;

    const stepProgress = calculateStepProgress(step, status, processedItems, totalItems, weights);
    cumulativeProgress += stepProgress;
  }

  return Math.min(Math.max(cumulativeProgress, 0), 100);
}

/**
 * Estimates time remaining based on current progress and elapsed time
 *
 * @param percentComplete - Current progress percentage (0-100)
 * @param startTime - Timestamp when the pipeline started (milliseconds)
 * @param currentTime - Current timestamp (milliseconds)
 * @returns Estimated time remaining in milliseconds, or null if cannot estimate
 */
export function estimateTimeRemaining(
  percentComplete: number,
  startTime: number,
  currentTime: number = Date.now()
): number | null {
  if (percentComplete <= 0) {
    return null; // Can't estimate with no progress
  }

  if (percentComplete >= 100) {
    return 0; // Already complete
  }

  const elapsedMs = currentTime - startTime;
  const estimatedTotal = (elapsedMs / percentComplete) * 100;
  const remainingMs = estimatedTotal - elapsedMs;

  return Math.max(0, Math.round(remainingMs));
}

/**
 * Formats time remaining in a human-readable format
 *
 * @param milliseconds - Time in milliseconds
 * @returns Formatted time string (e.g., "2m 30s", "1h 15m")
 */
export function formatTimeRemaining(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${seconds}s`;
}

/**
 * Formats progress percentage for display
 *
 * @param percent - Progress percentage (0-100)
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted percentage string (e.g., "42.5%")
 */
export function formatProgressPercent(percent: number, decimals: number = 1): string {
  return `${percent.toFixed(decimals)}%`;
}

/**
 * Creates a progress message with all relevant information
 *
 * @param currentStep - The step currently being executed
 * @param percentComplete - Overall progress percentage
 * @param timeRemainingMs - Estimated time remaining in milliseconds
 * @returns Formatted progress message
 */
export function formatProgressMessage(
  currentStep: Step,
  percentComplete: number,
  timeRemainingMs?: number | null
): string {
  const stepNames: Record<Step, string> = {
    transcribe: "Transcribing audio",
    draft: "Generating PIP draft",
    review: "Reviewing with policy judge",
    export: "Exporting to DOCX"
  };

  const stepName = stepNames[currentStep];
  const percentStr = formatProgressPercent(percentComplete);

  if (timeRemainingMs !== null && timeRemainingMs !== undefined && timeRemainingMs > 0) {
    const timeStr = formatTimeRemaining(timeRemainingMs);
    return `${stepName} - ${percentStr} complete (${timeStr} remaining)`;
  }

  return `${stepName} - ${percentStr} complete`;
}

/**
 * Tracks progress state for the entire pipeline run
 */
export class ProgressTracker {
  private stepStatuses: Record<Step, StepStatus>;
  private transcriptionProgress: { processed: number; total: number };
  private startTime: number;
  private weights: ProgressWeights;

  constructor(weights: ProgressWeights = DEFAULT_PROGRESS_WEIGHTS) {
    this.stepStatuses = {
      transcribe: "pending",
      draft: "pending",
      review: "pending",
      export: "pending"
    };
    this.transcriptionProgress = { processed: 0, total: 0 };
    this.startTime = Date.now();
    this.weights = weights;
  }

  /**
   * Updates the status of a specific step
   */
  updateStepStatus(step: Step, status: StepStatus): void {
    this.stepStatuses[step] = status;
  }

  /**
   * Updates transcription progress
   */
  updateTranscriptionProgress(processed: number, total: number): void {
    this.transcriptionProgress = { processed, total };
  }

  /**
   * Gets the current step being executed
   */
  getCurrentStep(): Step {
    const steps: Step[] = ["transcribe", "draft", "review", "export"];

    // Find the first running or pending step
    for (const step of steps) {
      if (this.stepStatuses[step] === "running") {
        return step;
      }
    }

    // If no running step, find first pending
    for (const step of steps) {
      if (this.stepStatuses[step] === "pending") {
        return step;
      }
    }

    // Default to export if all complete
    return "export";
  }

  /**
   * Gets overall progress information
   */
  getProgress(): OverallProgress {
    const currentStep = this.getCurrentStep();
    const percentComplete = calculateOverallProgress(
      this.stepStatuses,
      this.transcriptionProgress,
      this.weights
    );

    const estimatedTimeRemaining = estimateTimeRemaining(
      percentComplete,
      this.startTime
    );

    const stepProgress: StepProgress[] = (["transcribe", "draft", "review", "export"] as Step[]).map(
      (step) => ({
        step,
        status: this.stepStatuses[step],
        percentComplete: calculateStepProgress(
          step,
          this.stepStatuses[step],
          step === "transcribe" ? this.transcriptionProgress.processed : undefined,
          step === "transcribe" ? this.transcriptionProgress.total : undefined,
          this.weights
        )
      })
    );

    return {
      percentComplete,
      currentStep,
      stepProgress,
      estimatedTimeRemaining: estimatedTimeRemaining ?? undefined,
      startTime: this.startTime
    };
  }

  /**
   * Gets a formatted progress message
   */
  getProgressMessage(): string {
    const progress = this.getProgress();
    return formatProgressMessage(
      progress.currentStep,
      progress.percentComplete,
      progress.estimatedTimeRemaining
    );
  }

  /**
   * Resets the progress tracker
   */
  reset(): void {
    this.stepStatuses = {
      transcribe: "pending",
      draft: "pending",
      review: "pending",
      export: "pending"
    };
    this.transcriptionProgress = { processed: 0, total: 0 };
    this.startTime = Date.now();
  }
}

/**
 * Creates a heuristic progress update based on time elapsed
 * Used when explicit progress information is not available
 *
 * @param step - Current step
 * @param elapsedMs - Time elapsed since step started
 * @returns Estimated progress percentage for the step
 */
export function createHeuristicProgress(step: Step, elapsedMs: number): number {
  // Heuristic: assume progress increases logarithmically with time
  // This creates a realistic "slowing down" effect as time increases

  const stepDurations: Record<Step, number> = {
    transcribe: 120000, // 2 minutes typical
    draft: 60000,       // 1 minute typical
    review: 30000,      // 30 seconds typical
    export: 15000       // 15 seconds typical
  };

  const expectedDuration = stepDurations[step];
  const timeRatio = Math.min(elapsedMs / expectedDuration, 1);

  // Use logarithmic curve: slower progress at the end
  const progress = Math.log(1 + timeRatio * (Math.E - 1)) / Math.log(Math.E);

  return Math.min(progress * 100, 95); // Cap at 95% to avoid showing 100% prematurely
}
