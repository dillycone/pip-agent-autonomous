"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import allowedExtensions from "../../../src/config/allowedExtensions.json";
import styles from "./styles.module.css";
import PipelineStatusCard from "./components/pipeline/PipelineStatusCard";
import ErrorAlert from "./components/pipeline/ErrorAlert";
import CurrentActivityCard from "./components/pipeline/CurrentActivityCard";
import DocumentOutputCard from "./components/pipeline/DocumentOutputCard";
import ProgressRing from "@/app/components/shared/ProgressRing";
import { formatDuration, formatDurationMs, normalizeUsageMetrics } from "../lib/utils";
import type { Step, StepStatus, LogItem, TimelineItem, CostState } from "../lib/types";
import { STEP_ORDER } from "../lib/constants";
import { usePipelineRun } from "./hooks/usePipelineRun";
import { computeOverallProgress } from "../lib/pipelineStateReducer";
import { FileUp, Globe, FileText, FolderOpen, Play } from "lucide-react";


const extensionConfig = (allowedExtensions as {
  audioExtensions: readonly string[];
  templateExtensions: readonly string[];
  outputExtensions: readonly string[];
});

const ALLOWED_AUDIO_EXTENSIONS = extensionConfig.audioExtensions;
const ALLOWED_TEMPLATE_EXTENSIONS = extensionConfig.templateExtensions;
const ALLOWED_OUTPUT_EXTENSIONS = extensionConfig.outputExtensions;
const PATH_TRAVERSAL_PATTERN = /(^|[\\/])\.\.([\\/]|$)/;

function hasAllowedExtension(value: string, allowed: readonly string[]): boolean {
  const lower = value.toLowerCase();
  return allowed.some((ext) => lower.endsWith(ext));
}

function formatClock(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function describeToolName(name?: string): string {
  if (!name) return "Unknown tool";
  if (name.startsWith("mcp__")) {
    const parts = name.split("__").filter(Boolean);
    if (parts.length >= 3) {
      const server = parts[1]?.replace(/_/g, " ") ?? "";
      const method = parts.slice(2).join(" • ").replace(/_/g, " ");
      return `${server}${method ? ` • ${method}` : ""}`;
    }
    if (parts.length === 2) {
      return parts[1]?.replace(/_/g, " ") ?? name;
    }
  }
  return name.replace(/_/g, " ");
}

function summarizeValue(value: unknown, maxLength = 160): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
  }
  try {
    const json = JSON.stringify(value);
    if (!json || json === "{}") return null;
    return json.length > maxLength ? `${json.slice(0, maxLength)}…` : json;
  } catch {
    return String(value).slice(0, maxLength);
  }
}

function summarizeTranscribeInput(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const parts: string[] = [];
  const audioPath = typeof record.audioPath === "string" ? record.audioPath : null;
  if (audioPath) {
    const segments = audioPath.split(/[/\\]/);
    parts.push(segments[segments.length - 1] || audioPath);
  }
  if (typeof record.startChunk === "number" && Number.isFinite(record.startChunk)) {
    parts.push(`start ${record.startChunk}`);
  }
  if (typeof record.chunkCount === "number" && Number.isFinite(record.chunkCount)) {
    parts.push(`${record.chunkCount} chunk${record.chunkCount === 1 ? "" : "s"}`);
  }
  if (typeof record.totalChunks === "number" && Number.isFinite(record.totalChunks)) {
    parts.push(`total ${record.totalChunks}`);
  }
  return parts.length > 0 ? parts.join(" • ") : null;
}




export default function Page() {
  // Form state
  const [audio, setAudio] = useState("uploads/meeting.mp3");
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [inLang, setInLang] = useState("Auto");
  const [outLang, setOutLang] = useState("En");
  const [template, setTemplate] = useState("templates/pip-template.docx");
  const [outdoc, setOutdoc] = useState(() => `exports/pip-${Date.now()}.docx`);
  const audioFileInputRef = useRef<HTMLInputElement>(null);

  // UI state
  const [transcribeElapsedSeconds, setTranscribeElapsedSeconds] = useState(0);
  const [focusedStep, setFocusedStep] = useState<Step | null>(null);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [toasts, setToasts] = useState<Array<{ id: string; text: string; level: "info" | "warn" | "error" | "success" }>>([]);

  // Logging helpers
  const pushLog = useCallback((type: string, payload: unknown) => {
    setLogs((prev) => [...prev, { ts: Date.now(), type, payload }].slice(-5000));
  }, []);

  const pushToast = useCallback((text: string, level: "info" | "warn" | "error" | "success" = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, text, level }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  // Pipeline run hook
  const {
    state: pipelineState,
    runId,
    isRunning,
    startRun: startPipelineRun,
    abortRun,
    resetState: resetPipelineState,
  } = usePipelineRun({
    onLog: pushLog,
    onToast: pushToast,
  });

  // Destructure pipeline state for easier access
  const {
    steps,
    chunks,
    transcriptPreview,
    transcriptLines,
    progressMode,
    draftPreviewLines,
    draftPreviewStatus,
    draftUsage,
    timeline,
    reviewRounds,
    finalDraft,
    docxPath,
    docxRelativePath,
    cost,
    transcribeStartedAt,
    transcribeEndedAt,
    uploadStartedAt,
    uploadCompletedAt,
  } = pipelineState;

  const handleAudioFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file extension
      const fileName = file.name.toLowerCase();
      if (hasAllowedExtension(fileName, ALLOWED_AUDIO_EXTENSIONS)) {
        // Store the file with "uploads/" prefix to maintain consistency with the expected path format
        const audioPath = `uploads/${file.name}`;
        setAudio(audioPath);
        setSelectedFileName(file.name);
        pushToast(`Audio file selected: ${file.name}`, "success");
      } else {
        pushToast(`Invalid audio format. Supported: ${ALLOWED_AUDIO_EXTENSIONS.join(", ")}`, "error");
      }
    }
    // Reset the input so the same file can be selected again if needed
    event.target.value = "";
  }, [pushToast]);

  const validateFormInputs = useCallback((): string[] => {
    const issues: string[] = [];

    const audioValue = audio.trim();
    if (!audioValue) {
      issues.push("Audio path is required.");
    } else {
      if (PATH_TRAVERSAL_PATTERN.test(audioValue)) {
        issues.push("Audio path cannot contain '..' segments.");
      }
      if (!hasAllowedExtension(audioValue, ALLOWED_AUDIO_EXTENSIONS)) {
        issues.push(`Audio must be one of: ${ALLOWED_AUDIO_EXTENSIONS.join(", ")}`);
      }
    }

    const templateValue = template.trim();
    if (!templateValue) {
      issues.push("Template path is required.");
    } else {
      if (PATH_TRAVERSAL_PATTERN.test(templateValue)) {
        issues.push("Template path cannot contain '..' segments.");
      }
      if (!hasAllowedExtension(templateValue, ALLOWED_TEMPLATE_EXTENSIONS)) {
        issues.push("Template must be a .docx file.");
      }
    }

    const outdocValue = outdoc.trim();
    if (!outdocValue) {
      issues.push("Output document path is required.");
    } else {
      if (PATH_TRAVERSAL_PATTERN.test(outdocValue)) {
        issues.push("Output document path cannot contain '..' segments.");
      }
      if (!hasAllowedExtension(outdocValue, ALLOWED_OUTPUT_EXTENSIONS)) {
        issues.push("Output document must end with .docx.");
      }
    }

    return issues;
  }, [audio, template, outdoc]);

  const resetState = useCallback(() => {
    resetPipelineState();
    setFocusedStep(null);
    setLogs([]);
    setTranscribeElapsedSeconds(0);
  }, [resetPipelineState]);

  const startRun = useCallback(async () => {
    if (isRunning) return;

    const validationErrors = validateFormInputs();
    if (validationErrors.length > 0) {
      pushToast(validationErrors[0], "error");
      pushLog("validation", validationErrors);
      return;
    }

    await startPipelineRun({
      audio,
      template,
      outdoc,
      inputLanguage: inLang,
      outputLanguage: outLang,
    });
  }, [
    isRunning,
    validateFormInputs,
    pushToast,
    pushLog,
    startPipelineRun,
    audio,
    template,
    outdoc,
    inLang,
    outLang,
  ]);

  const handleCancelRun = useCallback(async () => {
    await abortRun();
  }, [abortRun]);

  const handleRetryRun = useCallback(() => {
    resetState();
    startRun();
  }, [resetState, startRun]);

  const pct = useMemo(() => {
    if (!chunks.total || chunks.total <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((chunks.processed / chunks.total) * 100)));
  }, [chunks]);

  useEffect(() => {
    if (!transcribeStartedAt) {
      setTranscribeElapsedSeconds(0);
      return;
    }

    const compute = () => {
      const end = transcribeEndedAt ?? Date.now();
      const elapsed = Math.max(0, Math.floor((end - transcribeStartedAt) / 1000));
      setTranscribeElapsedSeconds(elapsed);
    };

    compute();

    if (transcribeEndedAt) {
      return;
    }

    const interval = setInterval(compute, 1000);
    return () => clearInterval(interval);
  }, [transcribeStartedAt, transcribeEndedAt]);

  const eta = useMemo(() => {
    if (!chunks.total || chunks.total <= 0 || chunks.processed <= 0) return null;
    if (!transcribeStartedAt) return null;
    if (transcribeElapsedSeconds <= 0) return null;
    if (transcribeEndedAt) return 0;
    const remaining = chunks.total - chunks.processed;
    if (remaining <= 0) return 0;
    const rate = chunks.processed / Math.max(1, transcribeElapsedSeconds);
    if (rate <= 0) return null;
    return Math.max(0, Math.round(remaining / rate));
  }, [chunks, transcribeElapsedSeconds, transcribeStartedAt, transcribeEndedAt]);

  const autoStep = useMemo<Step>(() => {
    const runningStep = STEP_ORDER.find((key) => steps[key] === "running");
    if (runningStep) return runningStep;
    const completed = [...STEP_ORDER].reverse().find((key) => steps[key] === "success" || steps[key] === "error");
    if (completed) return completed;
    return "transcribe";
  }, [steps]);

  const visibleStep = focusedStep && steps[focusedStep] ? focusedStep : autoStep;

  const stepTimeline = useMemo(() => {
    return timeline
      .filter((item) => (visibleStep === "review" ? item.phase === "review" || item.phase === "unknown" : item.phase === visibleStep))
      .slice(-6);
  }, [timeline, visibleStep]);

  const transcriptStreamLines = useMemo(() => {
    if (transcriptLines.length > 0) return transcriptLines;
    const fallback = transcriptPreview
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line): line is string => line.length > 0)
      .slice(-3);
    return fallback;
  }, [transcriptLines, transcriptPreview]);

  return (
    <main className={styles.page}>
      <Toasts toasts={toasts} onClose={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
      <header className={styles.header} style={{ textAlign: "center", marginBottom: "32px" }}>
        <h1>PIP Generation Agent</h1>
        {steps.transcribe === "running" && transcribeElapsedSeconds > 30 && (
          <p style={{ marginTop: "0.5rem", fontSize: "0.9em", opacity: 0.8, color: "var(--text-secondary)" }}>
            Long audio files may take 5-10 minutes to transcribe. Progress updates appear periodically.
          </p>
        )}
      </header>

      <section className={styles.configCard}>
        {/* Audio Input Section */}
        <div className={styles.configSection}>
          <div className={styles.configSectionHeader}>
            <FileUp className={styles.configIcon} size={18} />
            <label className={styles.configLabel}>Audio Input</label>
          </div>
          <input
            ref={audioFileInputRef}
            type="file"
            id="audio"
            className={styles.configInput}
            style={{ display: "none" }}
            accept={ALLOWED_AUDIO_EXTENSIONS.join(",")}
            onChange={handleAudioFileSelect}
          />
          <button
            type="button"
            className={styles.configButton}
            onClick={() => audioFileInputRef.current?.click()}
          >
            <FolderOpen size={18} />
            {selectedFileName ? `✓ ${selectedFileName}` : "Select Audio File"}
          </button>
          <div className={styles.configHint}>
            MP3, WAV supported. Click to select a file from your computer.
          </div>
        </div>

        {/* Translation Section */}
        <div className={styles.configSection}>
          <div className={styles.configSectionHeader}>
            <Globe className={styles.configIcon} size={18} />
            <label className={styles.configLabel}>Translation Settings</label>
          </div>
          <div className={styles.configGrid}>
            <div>
              <label className={`${styles.configLabel} ${styles.configFieldLabel}`} htmlFor="inLang">
                Source Language
              </label>
              <input
                id="inLang"
                className={styles.configInput}
                value={inLang}
                onChange={(e) => setInLang(e.target.value)}
                placeholder="auto"
              />
              <div className={styles.configHint}>
                Code or &quot;auto&quot; for detection
              </div>
            </div>
            <div>
              <label className={`${styles.configLabel} ${styles.configFieldLabel}`} htmlFor="outLang">
                Target Language
              </label>
              <input
                id="outLang"
                className={styles.configInput}
                value={outLang}
                onChange={(e) => setOutLang(e.target.value)}
                placeholder="en"
              />
              <div className={styles.configHint}>
                Language code (e.g., en, es, fr)
              </div>
            </div>
          </div>
        </div>



        {/* Start Button */}
        <button
          onClick={startRun}
          disabled={isRunning}
          className={styles.configButton}
        >
          <Play size={18} />
          {isRunning ? "Running…" : "Start Run"}
        </button>
      </section>

      {isRunning && (
        <div className="space-y-4 mb-6">
          <PipelineStatusCard
            overallProgress={computeOverallProgress(pipelineState)}
            currentStep={autoStep}
            steps={steps}
            elapsedSeconds={transcribeElapsedSeconds}
            onCancel={handleCancelRun}
          />
          {Object.values(steps).some((s) => s === "error") && (
            <ErrorAlert
              failedStep={
                (Object.entries(steps) as Array<[Step, StepStatus]>).find(
                  ([_, s]) => s === "error"
                )?.[0] || null
              }
              errorMessage={(() => {
                const errorStep = (Object.entries(steps) as Array<
                  [Step, StepStatus]
                >).find(([_, s]) => s === "error")?.[0];
                if (errorStep) {
                  const messages: Record<Step, string> = {
                    transcribe:
                      "Failed to process audio file during transcription",
                    draft: "Failed to generate the performance improvement plan",
                    review:
                      "Failed during policy compliance review process",
                    export: "Failed to export the final document"
                  };
                  return messages[errorStep];
                }
                return "An error occurred during pipeline execution";
              })()}
              onRetry={handleRetryRun}
              onReset={resetState}
            />
          )}
        </div>
      )}

      {isRunning && (
        <section className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          <CurrentActivityCard
            step={autoStep}
            status={steps[autoStep]}
            elapsedSeconds={transcribeElapsedSeconds}
            transcriptLines={transcriptStreamLines}
            draftLines={draftPreviewLines}
            draftPreviewStatus={draftPreviewStatus}
            draftUsage={draftUsage}
            reviewRounds={reviewRounds}
            timeline={stepTimeline}
          />
          <DocumentOutputCard
            docxPath={docxPath}
            docxRelativePath={docxRelativePath}
            isReady={Boolean(docxPath || docxRelativePath)}
            running={isRunning}
          />
        </section>
      )}
    </main>
  );
}

type StepperProps = {
  steps: Array<{ key: Step; label: string; status: StepStatus; meta?: string; progress?: number }>;
  activeStep: Step;
  focusedStep: Step | null;
  onSelect: (step: Step) => void;
};

function Stepper({ steps, activeStep, focusedStep, onSelect }: StepperProps) {
  return (
    <div className={styles.stepper}>
      {steps.map((step, index) => {
        const statusClass = styles[`step${capitalize(step.status)}`] ?? "";
        const isActive = step.key === activeStep;
        const isFocused = focusedStep === step.key;
        const className = [styles.step, statusClass, isActive ? styles.stepActive : "", isFocused ? styles.stepFocused : ""]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={step.key}
            type="button"
            className={className}
            onClick={() => onSelect(step.key)}
            aria-pressed={isFocused}
          >
            <div className={styles.stepIndex}>{index + 1}</div>
            <div className={styles.stepBody}>
              <div className={styles.stepLabel}>{step.label}</div>
              {step.meta ? <div className={styles.stepMeta}>{step.meta}</div> : null}
              {typeof step.progress === "number" ? (
                <div className={styles.progressBarOuter} aria-valuemin={0} aria-valuemax={100} aria-valuenow={step.progress} role="progressbar">
                  <div className={styles.progressBarInner} style={{ width: `${step.progress}%` }} />
                </div>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}

type StepDetailPanelProps = {
  step: Step;
  status: StepStatus;
  running: boolean;
  transcribe: {
    processed: number;
    total: number;
    percent?: number;
    elapsedSeconds: number;
    etaSeconds: number | null;
    uploadStartedAt: number | null;
    uploadCompletedAt: number | null;
    progressMode: "explicit" | "heuristic";
  };
  transcriptLines: string[];
  draft: {
    lines: string[];
    previewStatus: "idle" | "streaming" | "complete";
    usage: { model?: string; inputTokens?: number; outputTokens?: number; cacheCreationTokens?: number; cacheReadTokens?: number } | null;
  };
  reviewRounds: Array<{ round: number; approved: boolean; reasons: string[]; requiredChanges: string[]; at?: string }>;
  exportData: {
    docxPath: string;
    docxRelativePath: string;
    hasDocx: boolean;
  };
  timeline: TimelineItem[];
};

function StepDetailPanel({
  step,
  status,
  running,
  transcribe,
  transcriptLines,
  draft,
  reviewRounds,
  exportData,
  timeline
}: StepDetailPanelProps) {
  if (step === "transcribe") {
    const { processed, total, percent, elapsedSeconds, etaSeconds, uploadStartedAt, uploadCompletedAt, progressMode } = transcribe;
    const hasTotals = typeof total === "number" && total > 0;
    const approxPrefix = progressMode === "heuristic" ? "≈" : "";
    const chunksLabel = hasTotals
      ? `${approxPrefix}${processed}/${total}`
      : processed > 0
        ? `${approxPrefix}${processed}`
        : "—";
    const remainingChunks = hasTotals ? Math.max(0, total - processed) : null;
    const elapsedLabel = formatDuration(elapsedSeconds);
    const remainingLabel = etaSeconds !== null && etaSeconds >= 0
      ? formatDuration(etaSeconds)
      : status === "success" || status === "error"
        ? "0:00"
        : "—";
    const modeTag = progressMode === "heuristic" ? " (est.)" : "";
    const ringLabel = hasTotals
      ? `${total} chunk${total === 1 ? "" : "s"}${modeTag}`
      : processed > 0
        ? `${processed} processed${modeTag}`
        : undefined;
    const uploadValue = uploadCompletedAt
      ? formatClock(new Date(uploadCompletedAt).toISOString())
      : uploadStartedAt
        ? formatClock(new Date(uploadStartedAt).toISOString())
        : "—";
    const uploadStatus = uploadCompletedAt
      ? "Upload complete"
      : uploadStartedAt
        ? "Uploading audio…"
        : status === "running"
          ? "Uploading soon"
          : "Not started";
    const message = (() => {
      if (status === "success") return "All audio chunks processed.";
      if (status === "error") return "Transcription failed — check tool output for details.";
      if (status === "running") {
        if (hasTotals) {
          const estimateNote = progressMode === "heuristic" ? " (estimated)" : "";
          return `${chunksLabel} chunks complete${remainingChunks && remainingChunks > 0 ? ` • ${remainingChunks} remaining` : ""}${estimateNote}`;
        }
        if (processed > 0) {
          const estimateNote = progressMode === "heuristic" ? " (estimated)" : "";
          return `${chunksLabel} chunk${processed === 1 ? "" : "s"} complete${estimateNote}.`;
        }
        return uploadStartedAt ? "Uploading audio…" : "Initializing transcription…";
      }
      if (status === "pending") {
        if (uploadStartedAt) {
          return "Preparing transcription request…";
        }
        return running ? "Waiting to start transcription…" : "Transcription pending.";
      }
      return uploadCompletedAt ? "Upload complete. Awaiting next steps…" : "Transcription status updated.";
    })();

    return (
      <StepCard title="Transcription Progress" status={status} message={message}>
        <div className={styles.progressRow}>
          <ProgressRing percent={percent} label={ringLabel} />
          <div className={styles.kpis}>
            <div>
              <div className={styles.kpiLabel}>Chunks</div>
              <div className={styles.kpiValue}>{chunksLabel}</div>
            </div>
            <div>
              <div className={styles.kpiLabel}>Elapsed</div>
              <div className={styles.kpiValue}>{elapsedLabel}</div>
            </div>
            <div>
              <div className={styles.kpiLabel}>Remaining</div>
              <div className={styles.kpiValue}>{remainingLabel}</div>
            </div>
            <div>
              <div className={styles.kpiLabel}>Upload</div>
              <div className={styles.kpiValue}>{uploadValue}</div>
              <div className={styles.kpiHint}>{uploadStatus}</div>
            </div>
          </div>
        </div>
        <StreamingLines
          label="Latest transcript lines"
          lines={transcriptLines}
          placeholder={status === "running" ? "Waiting for transcript output…" : "Transcript preview will appear here."}
          status={status === "running" && transcriptLines.length > 0 ? "streaming" : undefined}
        />
        <StepActivity items={timeline} />
      </StepCard>
    );
  }

  if (step === "draft") {
    const { lines, previewStatus, usage } = draft;
    const usageItems = [
      usage?.model ? { label: "Model", value: usage.model } : null,
      typeof usage?.inputTokens === "number" ? { label: "Input tokens", value: usage.inputTokens.toLocaleString() } : null,
      typeof usage?.outputTokens === "number" ? { label: "Output tokens", value: usage.outputTokens.toLocaleString() } : null,
      typeof usage?.cacheCreationTokens === "number" ? { label: "Cache create", value: usage.cacheCreationTokens.toLocaleString() } : null,
      typeof usage?.cacheReadTokens === "number" ? { label: "Cache read", value: usage.cacheReadTokens.toLocaleString() } : null
    ].filter((item): item is { label: string; value: string } => Boolean(item));

    const message = (() => {
      if (status === "error") return "Draft failed — open activity below for details.";
      if (status === "success") return "Draft ready. Policy review will start automatically.";
      if (status === "running") {
        return previewStatus === "streaming"
          ? "Drafting PIP… streaming lines appear below."
          : "Drafting PIP…";
      }
      if (status === "pending") {
        return running ? "Waiting to start drafting…" : "Draft pending.";
      }
      return "Draft status updated.";
    })();

    return (
      <StepCard title="Draft Progress" status={status} message={message}>
        {usageItems.length > 0 ? (
          <div className={styles.kpis}>
            {usageItems.map((item) => (
              <div key={item.label}>
                <div className={styles.kpiLabel}>{item.label}</div>
                <div className={styles.kpiValue}>{item.value}</div>
              </div>
            ))}
          </div>
        ) : null}
        <StreamingLines
          label="Draft excerpt"
          lines={lines}
          placeholder={status === "running" ? "Waiting for first lines…" : "Draft lines will appear here."}
          status={previewStatus === "streaming" ? "streaming" : undefined}
        />
        <StepActivity items={timeline} />
      </StepCard>
    );
  }

  if (step === "review") {
    const message = (() => {
      const latest = reviewRounds.at(-1) ?? null;
      if (status === "error") return "Review blocked — see required changes below.";
      if (status === "success") return "Review complete.";
      if (latest) {
        return latest.approved
          ? `Round ${latest.round}: approved.`
          : `Round ${latest.round}: changes required.`;
      }
      if (status === "running") return "Policy judge is reviewing the draft…";
      if (status === "pending") return running ? "Waiting to start review…" : "Review pending.";
      return "Review status updated.";
    })();

    return (
      <StepCard title="Review Progress" status={status} message={message}>
        {reviewRounds.length > 0 ? (
          <div className={styles.reviewList}>
            {[...reviewRounds].sort((a, b) => a.round - b.round).map((round) => (
              <div key={round.round} className={styles.reviewItem}>
                <div className={styles.reviewHeading}>
                  <span className={styles.reviewBadge}>Round {round.round}</span>
                  <span className={round.approved ? styles.reviewApproved : styles.reviewChanges}>
                    {round.approved ? "Approved" : "Changes required"}
                  </span>
                </div>
                {round.reasons.length > 0 ? (
                  <ul className={styles.reviewListBullets}>
                    {round.reasons.map((reason, idx) => (
                      <li key={`reason-${round.round}-${idx}`}>{reason}</li>
                    ))}
                  </ul>
                ) : null}
                {!round.approved && round.requiredChanges.length > 0 ? (
                  <ul className={styles.reviewListBullets}>
                    {round.requiredChanges.map((item, idx) => (
                      <li key={`change-${round.round}-${idx}`}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>Judge updates will appear here.</div>
        )}
        <StepActivity items={timeline} />
      </StepCard>
    );
  }

  const { docxPath, docxRelativePath, hasDocx } = exportData;
  const message = (() => {
    if (status === "error") return "Export failed — review tool activity for details.";
    if (status === "success") return hasDocx ? "Export complete. Download is ready." : "Export complete.";
    if (status === "running") return "Exporting draft to DOCX…";
    if (status === "pending") return running ? "Waiting to start export…" : "Export pending.";
    return "Export status updated.";
  })();
  const pathLabel = (docxRelativePath || docxPath || "").trim();

  return (
    <StepCard title="Export Progress" status={status} message={message}>
      <div className={styles.exportInfo}>
        <div className={styles.kpiLabel}>Output path</div>
        <div className={styles.exportPath}>{pathLabel || "—"}</div>
      </div>
      {!hasDocx && status === "success" ? (
        <div className={styles.kpiHint}>Final document saved, but path could not be determined.</div>
      ) : null}
      <StepActivity items={timeline} />
    </StepCard>
  );
}

type StepCardProps = {
  title: string;
  status: StepStatus;
  message?: string;
  children: ReactNode;
};

function StepCard({ title, status, message, children }: StepCardProps) {
  const pillClass = `${styles.statusPill} ${
    status === "success"
      ? styles.statusSuccess
      : status === "error"
        ? styles.statusError
        : status === "running"
          ? styles.statusRunning
          : styles.statusPending
  }`;

  // Error guidance by step type
  const getErrorGuidance = (stepTitle: string): string | null => {
    if (status !== "error") return null;
    if (stepTitle.includes("Transcription")) {
      return "💡 Common issues: Check audio file exists and is supported format (MP3, WAV, etc.). Verify API has sufficient quota. Large files may take 5-10 minutes.";
    }
    if (stepTitle.includes("Draft")) {
      return "💡 Common issues: Check token limits haven't been exceeded. Verify API key is valid. Ensure prompt configuration is correct.";
    }
    if (stepTitle.includes("Review")) {
      return "💡 Common issues: Draft may violate policies. Check policy configuration. Increase max review rounds if needed.";
    }
    if (stepTitle.includes("Export")) {
      return "💡 Common issues: Template file may not exist or be corrupted. Output path may have permission issues. Verify paths are correct.";
    }
    return null;
  };

  const errorGuidance = getErrorGuidance(title);

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardHeading}>{title}</h3>
        <span className={pillClass}>{capitalize(status)}</span>
      </div>
      {message ? <p className={styles.cardSub}>{message}</p> : null}
      {errorGuidance ? <p className={styles.errorGuidance}>{errorGuidance}</p> : null}
      <div className={styles.cardBody}>{children}</div>
    </div>
  );
}

type StepActivityProps = {
  items: TimelineItem[];
};

function StepActivity({ items }: StepActivityProps) {
  const ordered = [...items]
    .sort((a, b) => {
      const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 4);

  if (ordered.length === 0) {
    return (
      <div className={styles.section}>
        <div className={styles.sectionHeading}>Tool Activity</div>
        <div className={styles.emptyState}>Tool calls will appear here once this step runs.</div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeading}>Tool Activity</div>
      <div className={`${styles.timeline} ${styles.timelineCompact}`}>
        {ordered.map((item) => {
          const statusStyle =
            item.status === "error"
              ? styles.tlErr
              : item.status === "success"
                ? styles.tlOk
                : styles.tlRun;
          const headerClass = `${styles.timelineCard} ${statusStyle}`;
          const inferredDuration =
            item.durationMs ??
            (item.status === "running" && item.startedAt
              ? Math.max(0, Date.now() - new Date(item.startedAt).getTime())
              : undefined);
          const phaseLabel = item.phase === "unknown" ? "—" : capitalize(item.phase);
          const startLabel = formatClock(item.startedAt);
          const finishLabel =
            item.finishedAt && (item.status === "success" || item.status === "error")
              ? formatClock(item.finishedAt)
              : undefined;
          const chunkDetails =
            item.phase === "transcribe" ? summarizeTranscribeInput(item.inputSummary) : null;
          const inputText =
            item.phase === "transcribe"
              ? chunkDetails
              : summarizeValue(item.inputSummary, 120);
          const outputText = item.isError ? summarizeValue(item.contentSummary, 120) : null;

          return (
            <div key={item.id} className={headerClass}>
              <div className={styles.timelineHeader}>
                <div className={styles.tlStatus}>{capitalize(item.status)}</div>
                <div className={styles.tlName}>{describeToolName(item.name)}</div>
                <div className={styles.tlRight}>{formatDurationMs(inferredDuration)}</div>
              </div>
              <div className={styles.timelineBody}>
                <div className={styles.tlLine}>
                  <span className={styles.tlMeta}>Phase</span>
                  <span>{phaseLabel}</span>
                </div>
                {startLabel !== "—" ? (
                  <div className={styles.tlLine}>
                    <span className={styles.tlMeta}>Start</span>
                    <span>{startLabel}</span>
                  </div>
                ) : null}
                {finishLabel ? (
                  <div className={styles.tlLine}>
                    <span className={styles.tlMeta}>Finish</span>
                    <span>{finishLabel}</span>
                  </div>
                ) : null}
                {chunkDetails && item.phase === "transcribe" ? (
                  <div className={styles.tlLine}>
                    <span className={styles.tlMeta}>Details</span>
                    <span>{chunkDetails}</span>
                  </div>
                ) : null}
                {inputText && item.phase !== "transcribe" ? (
                  <div className={styles.tlLine}>
                    <span className={styles.tlMeta}>Input</span>
                    <span className={styles.tlCode} title={inputText}>{inputText}</span>
                  </div>
                ) : null}
                {outputText ? (
                  <div className={styles.tlLine}>
                    <span className={styles.tlMeta}>Output</span>
                    <span className={styles.tlCode} title={outputText}>{outputText}</span>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type StreamingLinesProps = {
  label: string;
  lines: string[];
  placeholder: string;
  status?: "streaming" | "complete" | undefined;
};

function StreamingLines({ label, lines, placeholder, status }: StreamingLinesProps) {
  const hasLines = lines.length > 0;
  return (
    <div className={styles.streamSection} aria-live="polite" aria-atomic="false">
      <div className={styles.kpiLabel}>{label}</div>
      {hasLines ? (
        <div className={styles.streamLines}>
          {lines.map((line, index) => (
            <div key={`${line}-${index}`} className={styles.streamLine}>{line}</div>
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>{placeholder}</div>
      )}
      {status === "streaming" ? <div className={styles.streamBadge}>Streaming…</div> : null}
    </div>
  );
}

type ArtifactsProps = {
  finalDraft: string;
  docxPath: string;
  docxRelative: string;
};

function Artifacts({ finalDraft, docxPath, docxRelative }: ArtifactsProps) {
  const downloadHref = useMemo(() => {
    const candidate = (docxRelative || docxPath || "").trim();
    if (!candidate) {
      return "";
    }
    const normalized = candidate.replace(/^\/+/, "");
    return `/api/download?path=${encodeURIComponent(normalized)}`;
  }, [docxPath, docxRelative]);
  // Default: open preview if no DOCX yet; collapse when DOCX exists
  const [showPreview, setShowPreview] = useState<boolean>(() => !downloadHref);
  const userToggledRef = useRef(false);
  const previewId = useMemo(
    () => `draft-preview-${Math.random().toString(36).slice(2, 8)}`,
    []
  );

  useEffect(() => {
    // Auto-collapse when a DOCX becomes available unless the user has toggled manually
    if (downloadHref && !userToggledRef.current) {
      setShowPreview(false);
    }
  }, [downloadHref]);

  const onTogglePreview = () => {
    userToggledRef.current = true;
    setShowPreview((v) => !v);
  };

  return (
    <div className={styles.card}>
      <h3 className={styles.centeredHeading}>Draft PIP</h3>
      <div className={styles.artifacts}>
        <div>
          {finalDraft ? (
            <>
              <button
                type="button"
                className={styles.toggleBtn}
                aria-expanded={showPreview}
                aria-controls={previewId}
                onClick={onTogglePreview}
              >
                {showPreview ? "Hide preview" : "Show preview"}
              </button>
              {showPreview ? (
                <pre id={previewId} className={styles.pre}>
                  {finalDraft.slice(0, 6000)}
                </pre>
              ) : null}
            </>
          ) : null}
        </div>
        <div>
          {downloadHref ? (
            <a
              href={downloadHref}
              download
              className={styles.downloadBtn}
              aria-label={`Download ${docxRelative || docxPath}`}
              title={`Download ${docxRelative || docxPath}`}
            >
              <svg
                className={styles.downloadIcon}
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M12 11v6" />
                <path d="M9 14l3 3 3-3" />
              </svg>
              <span className={styles.srOnly}>Download {docxRelative || docxPath}</span>
            </a>
          ) : null}
          {(docxPath || docxRelative) ? (
            <div className={styles.docxPathHint}>{docxRelative || docxPath}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function Toasts({ toasts, onClose }: { toasts: Array<{ id: string; text: string; level: string }>; onClose: (id: string) => void }) {
  return (
    <div className={styles.toasts} aria-live="polite" aria-atomic="true">
      {toasts.map((t) => (
        <div key={t.id} className={`${styles.toast} ${t.level === "error" ? styles.toastErr : t.level === "success" ? styles.toastOk : t.level === "warn" ? styles.toastWarn : styles.toastInfo}`} onClick={() => onClose(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

