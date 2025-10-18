import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calculateStepProgress,
  calculateOverallProgress,
  estimateTimeRemaining,
  formatTimeRemaining,
  formatProgressPercent,
  formatProgressMessage,
  createHeuristicProgress,
  ProgressTracker,
  DEFAULT_PROGRESS_WEIGHTS,
  type Step,
  type StepStatus,
  type ProgressWeights
} from "../../src/pipeline/progressTracking.js";

// ============================================================================
// calculateStepProgress Tests
// ============================================================================

test("calculateStepProgress returns 0 for pending step", () => {
  const progress = calculateStepProgress("transcribe", "pending");
  assert.equal(progress, 0);
});

test("calculateStepProgress returns full weight for success step", () => {
  const progress = calculateStepProgress("transcribe", "success");
  assert.equal(progress, DEFAULT_PROGRESS_WEIGHTS.transcribe);
});

test("calculateStepProgress returns 0 for error step", () => {
  const progress = calculateStepProgress("transcribe", "error");
  assert.equal(progress, 0);
});

test("calculateStepProgress calculates transcribe progress from chunks", () => {
  const progress = calculateStepProgress("transcribe", "running", 5, 10);
  assert.equal(progress, 20); // 50% of 40 = 20
});

test("calculateStepProgress caps transcribe progress at 100%", () => {
  const progress = calculateStepProgress("transcribe", "running", 15, 10);
  assert.equal(progress, 40); // Capped at full weight
});

test("calculateStepProgress returns 50% of weight for running non-transcribe steps", () => {
  const progress = calculateStepProgress("draft", "running");
  assert.equal(progress, DEFAULT_PROGRESS_WEIGHTS.draft * 0.5);
});

test("calculateStepProgress uses custom weights", () => {
  const customWeights: ProgressWeights = {
    transcribe: 50,
    draft: 25,
    review: 15,
    export: 10
  };
  const progress = calculateStepProgress("transcribe", "success", undefined, undefined, customWeights);
  assert.equal(progress, 50);
});

test("calculateStepProgress handles zero total chunks", () => {
  const progress = calculateStepProgress("transcribe", "running", 5, 0);
  assert.equal(progress, DEFAULT_PROGRESS_WEIGHTS.transcribe * 0.5);
});

// ============================================================================
// calculateOverallProgress Tests
// ============================================================================

test("calculateOverallProgress returns 0 for all pending steps", () => {
  const stepStatuses: Record<Step, StepStatus> = {
    transcribe: "pending",
    draft: "pending",
    review: "pending",
    export: "pending"
  };
  const progress = calculateOverallProgress(stepStatuses);
  assert.equal(progress, 0);
});

test("calculateOverallProgress returns 100 for all success steps", () => {
  const stepStatuses: Record<Step, StepStatus> = {
    transcribe: "success",
    draft: "success",
    review: "success",
    export: "success"
  };
  const progress = calculateOverallProgress(stepStatuses);
  assert.equal(progress, 100);
});

test("calculateOverallProgress calculates partial progress", () => {
  const stepStatuses: Record<Step, StepStatus> = {
    transcribe: "success",
    draft: "running",
    review: "pending",
    export: "pending"
  };
  const progress = calculateOverallProgress(stepStatuses);
  assert.equal(progress, 55); // 40 + 15 (50% of 30)
});

test("calculateOverallProgress uses transcription chunk progress", () => {
  const stepStatuses: Record<Step, StepStatus> = {
    transcribe: "running",
    draft: "pending",
    review: "pending",
    export: "pending"
  };
  const progress = calculateOverallProgress(stepStatuses, { processed: 5, total: 10 });
  assert.equal(progress, 20); // 50% of transcribe weight (40)
});

test("calculateOverallProgress clamps result to 0-100 range", () => {
  const stepStatuses: Record<Step, StepStatus> = {
    transcribe: "success",
    draft: "success",
    review: "success",
    export: "success"
  };
  const customWeights: ProgressWeights = {
    transcribe: 120, // Intentionally over 100
    draft: 30,
    review: 15,
    export: 15
  };
  const progress = calculateOverallProgress(stepStatuses, undefined, customWeights);
  assert.equal(progress, 100); // Clamped to 100
});

// ============================================================================
// estimateTimeRemaining Tests
// ============================================================================

test("estimateTimeRemaining returns null for 0% progress", () => {
  const remaining = estimateTimeRemaining(0, Date.now() - 60000);
  assert.equal(remaining, null);
});

test("estimateTimeRemaining returns 0 for 100% progress", () => {
  const remaining = estimateTimeRemaining(100, Date.now() - 60000);
  assert.equal(remaining, 0);
});

test("estimateTimeRemaining calculates remaining time correctly", () => {
  const startTime = Date.now() - 30000; // Started 30 seconds ago
  const remaining = estimateTimeRemaining(50, startTime); // 50% complete
  assert.ok(remaining !== null);
  assert.ok(remaining >= 28000 && remaining <= 32000); // ~30 seconds remaining
});

test("estimateTimeRemaining returns positive values only", () => {
  const startTime = Date.now() - 10000; // Started 10 seconds ago
  const remaining = estimateTimeRemaining(90, startTime);
  assert.ok(remaining !== null && remaining >= 0);
});

test("estimateTimeRemaining uses current time by default", () => {
  const startTime = Date.now() - 20000; // Started 20 seconds ago
  const remaining = estimateTimeRemaining(25, startTime);
  assert.ok(remaining !== null);
  assert.ok(remaining >= 55000 && remaining <= 65000); // ~60 seconds remaining
});

// ============================================================================
// formatTimeRemaining Tests
// ============================================================================

test("formatTimeRemaining formats seconds only", () => {
  const formatted = formatTimeRemaining(45000); // 45 seconds
  assert.equal(formatted, "45s");
});

test("formatTimeRemaining formats minutes and seconds", () => {
  const formatted = formatTimeRemaining(125000); // 2 minutes 5 seconds
  assert.equal(formatted, "2m 5s");
});

test("formatTimeRemaining formats hours and minutes", () => {
  const formatted = formatTimeRemaining(5400000); // 1 hour 30 minutes
  assert.equal(formatted, "1h 30m");
});

test("formatTimeRemaining formats exact minutes", () => {
  const formatted = formatTimeRemaining(120000); // 2 minutes
  assert.equal(formatted, "2m 0s");
});

test("formatTimeRemaining handles zero", () => {
  const formatted = formatTimeRemaining(0);
  assert.equal(formatted, "0s");
});

test("formatTimeRemaining handles small values", () => {
  const formatted = formatTimeRemaining(500); // Less than 1 second
  assert.equal(formatted, "0s");
});

// ============================================================================
// formatProgressPercent Tests
// ============================================================================

test("formatProgressPercent formats with default decimals", () => {
  const formatted = formatProgressPercent(42.567);
  assert.equal(formatted, "42.6%");
});

test("formatProgressPercent formats with custom decimals", () => {
  const formatted = formatProgressPercent(42.567, 2);
  assert.equal(formatted, "42.57%");
});

test("formatProgressPercent formats whole numbers", () => {
  const formatted = formatProgressPercent(50, 1);
  assert.equal(formatted, "50.0%");
});

test("formatProgressPercent handles 0 decimals", () => {
  const formatted = formatProgressPercent(42.567, 0);
  assert.equal(formatted, "43%");
});

// ============================================================================
// formatProgressMessage Tests
// ============================================================================

test("formatProgressMessage formats basic message", () => {
  const message = formatProgressMessage("transcribe", 25);
  assert.equal(message, "Transcribing audio - 25.0% complete");
});

test("formatProgressMessage includes time remaining", () => {
  const message = formatProgressMessage("draft", 50, 60000);
  assert.equal(message, "Generating PIP draft - 50.0% complete (1m 0s remaining)");
});

test("formatProgressMessage handles all step types", () => {
  const steps: Step[] = ["transcribe", "draft", "review", "export"];
  const messages = steps.map(step => formatProgressMessage(step, 50));

  assert.ok(messages[0].includes("Transcribing audio"));
  assert.ok(messages[1].includes("Generating PIP draft"));
  assert.ok(messages[2].includes("Reviewing with policy judge"));
  assert.ok(messages[3].includes("Exporting to DOCX"));
});

test("formatProgressMessage ignores null time remaining", () => {
  const message = formatProgressMessage("transcribe", 25, null);
  assert.equal(message, "Transcribing audio - 25.0% complete");
});

test("formatProgressMessage ignores zero time remaining", () => {
  const message = formatProgressMessage("transcribe", 25, 0);
  assert.equal(message, "Transcribing audio - 25.0% complete");
});

// ============================================================================
// createHeuristicProgress Tests
// ============================================================================

test("createHeuristicProgress returns 0 for no elapsed time", () => {
  const progress = createHeuristicProgress("transcribe", 0);
  assert.ok(progress >= 0 && progress < 5);
});

test("createHeuristicProgress increases with elapsed time", () => {
  const progress1 = createHeuristicProgress("transcribe", 30000);
  const progress2 = createHeuristicProgress("transcribe", 60000);
  assert.ok(progress2 > progress1);
});

test("createHeuristicProgress caps at 95%", () => {
  const progress = createHeuristicProgress("transcribe", 1000000); // Very long time
  assert.ok(progress <= 95);
});

test("createHeuristicProgress uses different durations for different steps", () => {
  const transcribeProgress = createHeuristicProgress("transcribe", 60000);
  const draftProgress = createHeuristicProgress("draft", 60000);
  assert.notEqual(transcribeProgress, draftProgress);
});

test("createHeuristicProgress follows logarithmic curve", () => {
  const progress25 = createHeuristicProgress("transcribe", 30000);
  const progress50 = createHeuristicProgress("transcribe", 60000);
  const progress75 = createHeuristicProgress("transcribe", 90000);

  // Progress should slow down over time (logarithmic)
  const firstHalf = progress50 - progress25;
  const secondHalf = progress75 - progress50;
  assert.ok(firstHalf > secondHalf);
});

// ============================================================================
// ProgressTracker Tests
// ============================================================================

test("ProgressTracker initializes with default state", () => {
  const tracker = new ProgressTracker();
  const progress = tracker.getProgress();

  assert.equal(progress.percentComplete, 0);
  assert.equal(progress.currentStep, "transcribe");
  assert.equal(progress.stepProgress.length, 4);
});

test("ProgressTracker updates step status", () => {
  const tracker = new ProgressTracker();
  tracker.updateStepStatus("transcribe", "running");

  const progress = tracker.getProgress();
  assert.equal(progress.currentStep, "transcribe");

  const transcribeProgress = progress.stepProgress.find(s => s.step === "transcribe");
  assert.equal(transcribeProgress?.status, "running");
});

test("ProgressTracker updates transcription progress", () => {
  const tracker = new ProgressTracker();
  tracker.updateStepStatus("transcribe", "running");
  tracker.updateTranscriptionProgress(5, 10);

  const progress = tracker.getProgress();
  assert.equal(progress.percentComplete, 20); // 50% of 40%
});

test("ProgressTracker calculates current step correctly", () => {
  const tracker = new ProgressTracker();

  tracker.updateStepStatus("transcribe", "success");
  assert.equal(tracker.getCurrentStep(), "draft");

  tracker.updateStepStatus("draft", "running");
  assert.equal(tracker.getCurrentStep(), "draft");

  tracker.updateStepStatus("draft", "success");
  assert.equal(tracker.getCurrentStep(), "review");
});

test("ProgressTracker estimates time remaining", () => {
  const tracker = new ProgressTracker();
  tracker.updateStepStatus("transcribe", "running");
  tracker.updateTranscriptionProgress(5, 10);

  // Wait a bit to ensure some time has elapsed
  const start = Date.now();
  while (Date.now() - start < 100) {
    // Small delay
  }

  const progress = tracker.getProgress();
  assert.ok(progress.estimatedTimeRemaining !== undefined);
});

test("ProgressTracker generates formatted progress message", () => {
  const tracker = new ProgressTracker();
  tracker.updateStepStatus("transcribe", "running");
  tracker.updateTranscriptionProgress(5, 10);

  const message = tracker.getProgressMessage();
  assert.ok(message.includes("Transcribing audio"));
  assert.ok(message.includes("20.0%"));
});

test("ProgressTracker resets state", () => {
  const tracker = new ProgressTracker();
  tracker.updateStepStatus("transcribe", "success");
  tracker.updateStepStatus("draft", "running");

  tracker.reset();

  const progress = tracker.getProgress();
  assert.equal(progress.percentComplete, 0);
  assert.equal(progress.currentStep, "transcribe");

  const transcribeProgress = progress.stepProgress.find(s => s.step === "transcribe");
  assert.equal(transcribeProgress?.status, "pending");
});

test("ProgressTracker uses custom weights", () => {
  const customWeights: ProgressWeights = {
    transcribe: 50,
    draft: 25,
    review: 15,
    export: 10
  };
  const tracker = new ProgressTracker(customWeights);

  tracker.updateStepStatus("transcribe", "success");
  const progress = tracker.getProgress();
  assert.equal(progress.percentComplete, 50);
});

test("ProgressTracker handles all steps complete", () => {
  const tracker = new ProgressTracker();
  tracker.updateStepStatus("transcribe", "success");
  tracker.updateStepStatus("draft", "success");
  tracker.updateStepStatus("review", "success");
  tracker.updateStepStatus("export", "success");

  const progress = tracker.getProgress();
  assert.equal(progress.percentComplete, 100);
  assert.equal(progress.currentStep, "export");
});

test("ProgressTracker returns all step progress details", () => {
  const tracker = new ProgressTracker();
  tracker.updateStepStatus("transcribe", "success");
  tracker.updateStepStatus("draft", "running");

  const progress = tracker.getProgress();
  assert.equal(progress.stepProgress.length, 4);

  const transcribeStep = progress.stepProgress.find(s => s.step === "transcribe");
  assert.equal(transcribeStep?.status, "success");
  assert.equal(transcribeStep?.percentComplete, 40);

  const draftStep = progress.stepProgress.find(s => s.step === "draft");
  assert.equal(draftStep?.status, "running");
  assert.equal(draftStep?.percentComplete, 15);
});
