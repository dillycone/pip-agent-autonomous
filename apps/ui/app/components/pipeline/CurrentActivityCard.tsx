"use client";

import React, { useState } from "react";
import { ChevronDown, Clock, RefreshCw, CheckCircle, AlertCircle } from "lucide-react";
import { formatDuration } from "@/lib/utils";
import styles from "./pipeline.module.css";

type Step = "transcribe" | "draft" | "review" | "export";
type StepStatus = "pending" | "running" | "success" | "error";

type CurrentActivityCardProps = {
  step: Step;
  status: StepStatus;
  elapsedSeconds: number;
  transcriptLines: string[];
  draftLines: string[];
  draftPreviewStatus: "idle" | "streaming" | "complete";
  draftUsage?: {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  } | null;
  reviewRounds: Array<{ round: number; approved: boolean; reasons: string[]; requiredChanges: string[] }>;
  timeline: any[];
};

const stepDescriptions: Record<Step, string> = {
  transcribe: "Processing Audio Input",
  draft: "Drafting Performance Improvement Plan",
  review: "Reviewing Policy Compliance",
  export: "Generating Document"
};

const stepHelpText: Record<Step, string> = {
  transcribe: "Converting audio to text using Gemini transcription service",
  draft: "Generating PIP content based on transcript and policy guidelines",
  review: "Validating generated content against company policies",
  export: "Creating final DOCX document"
};

export default function CurrentActivityCard({
  step,
  status,
  elapsedSeconds,
  transcriptLines,
  draftLines,
  draftPreviewStatus,
  draftUsage,
  reviewRounds,
  timeline
}: CurrentActivityCardProps) {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  const getActivityMessage = (): string => {
    switch (status) {
      case "success":
        return `${stepDescriptions[step]} completed successfully`;
      case "error":
        return `${stepDescriptions[step]} encountered an error`;
      case "running":
        return `${stepDescriptions[step]}...`;
      case "pending":
        return `Waiting to ${stepDescriptions[step].toLowerCase()}`;
      default:
        return stepDescriptions[step];
    }
  };

  const isStreaming = draftPreviewStatus === "streaming";
  const contentLines =
    step === "draft" ? draftLines : step === "transcribe" ? transcriptLines : [];

  return (
    <div className={styles.activityCard}>
      <div className={styles.activityHeader}>
        <div style={{ flex: 1 }}>
          <h3 className={styles.activityTitle}>
            {getActivityMessage()}
          </h3>
          <p className={styles.activityDescription}>
            {stepHelpText[step]}
          </p>
        </div>
        {status === "running" && (
          <div className={styles.streamingBadge}>
            {isStreaming ? "Streaming" : "Processing"}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Time Info */}
        {status === "running" && (
          <div className={styles.timeInfo}>
            <Clock size={16} />
            <span>Started {formatDuration(elapsedSeconds)} ago</span>
          </div>
        )}

        {/* Content Preview */}
        {contentLines.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <p style={{ fontSize: "12px", fontWeight: "600", color: "#475569", margin: 0 }}>
              {step === "draft" ? "Draft Preview" : "Transcription Preview"}
            </p>
            <div className={styles.previewBox}>
              {contentLines.map((line, idx) => (
                <div key={idx} style={{ marginBottom: "8px", whiteSpace: "pre-wrap" }}>
                  {line}
                </div>
              ))}
            </div>
            {isStreaming && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#64748b" }}>
                <div style={{
                  height: "8px",
                  width: "8px",
                  background: "#3b82f6",
                  borderRadius: "50%",
                  animation: "pulse 2s infinite"
                }}></div>
                Streaming in progress...
              </div>
            )}
          </div>
        )}

        {/* Review Rounds */}
        {step === "review" && reviewRounds.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <p style={{ fontSize: "12px", fontWeight: "600", color: "#475569", margin: 0 }}>
              Review Rounds
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {reviewRounds.map((round) => (
                <div
                  key={round.round}
                  style={{
                    fontSize: "12px",
                    padding: "8px",
                    borderRadius: "8px",
                    background: round.approved ? "#f0fdf4" : "#fffbeb",
                    border: `1px solid ${round.approved ? "#bbf7d0" : "#fed7aa"}`,
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px"
                  }}
                >
                  <div style={{ fontWeight: "600" }}>
                    Round {round.round}: {round.approved ? "Approved" : "Changes Required"}
                  </div>
                  {round.reasons.length > 0 && (
                    <ul style={{ margin: "0", paddingLeft: "20px", color: "#475569" }}>
                      {round.reasons.map((reason, idx) => (
                        <li key={idx} style={{ marginBottom: "4px" }}>{reason}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Technical Details Collapsible */}
        <div className={styles.techDetails}>
          <button
            className={styles.detailsToggle}
            onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
            type="button"
          >
            <ChevronDown
              size={16}
              style={{
                transform: showTechnicalDetails ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s ease"
              }}
            />
            <span>
              {showTechnicalDetails ? "Hide" : "Show"} Technical Details
            </span>
          </button>

          {showTechnicalDetails && (
            <div className={styles.detailsContent}>
              {/* Draft Usage Metrics */}
              {draftUsage && step === "draft" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
                  <p style={{ fontSize: "12px", fontWeight: "600", color: "#475569", margin: 0 }}>
                    Processing Metrics
                  </p>
                  <div style={{ fontSize: "11px", display: "flex", flexDirection: "column", gap: "4px" }}>
                    {draftUsage.model && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#64748b" }}>Model:</span>
                        <code style={{ color: "#1e293b", fontFamily: "monospace" }}>
                          {draftUsage.model}
                        </code>
                      </div>
                    )}
                    {typeof draftUsage.inputTokens === "number" && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#64748b" }}>Input Tokens:</span>
                        <span style={{ color: "#1e293b" }}>
                          {draftUsage.inputTokens.toLocaleString()}
                        </span>
                      </div>
                    )}
                    {typeof draftUsage.outputTokens === "number" && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#64748b" }}>Output Tokens:</span>
                        <span style={{ color: "#1e293b" }}>
                          {draftUsage.outputTokens.toLocaleString()}
                        </span>
                      </div>
                    )}
                    {typeof draftUsage.cacheCreationTokens === "number" && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#64748b" }}>Cache Created:</span>
                        <span style={{ color: "#1e293b" }}>
                          {draftUsage.cacheCreationTokens.toLocaleString()}
                        </span>
                      </div>
                    )}
                    {typeof draftUsage.cacheReadTokens === "number" && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#64748b" }}>Cache Read:</span>
                        <span style={{ color: "#1e293b" }}>
                          {draftUsage.cacheReadTokens.toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tool Activity */}
              {timeline.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <p style={{ fontSize: "12px", fontWeight: "600", color: "#475569", margin: 0 }}>
                    Recent Tool Activity
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {timeline.slice(0, 3).map((item: any) => (
                      <div
                        key={item.id}
                        style={{
                          fontSize: "11px",
                          padding: "6px",
                          borderRadius: "6px",
                          background: item.status === "success"
                            ? "#f0fdf4"
                            : item.status === "error"
                            ? "#fef2f2"
                            : "#ecfeff",
                          border: `1px solid ${
                            item.status === "success"
                              ? "#bbf7d0"
                              : item.status === "error"
                              ? "#fecaca"
                              : "#a5f3fc"
                          }`,
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px"
                        }}
                      >
                        <div style={{ fontWeight: "600" }}>
                          {item.name?.replace(/^mcp__/, "") || "Tool"}
                        </div>
                        {item.durationMs && (
                          <div style={{ color: "#64748b" }}>
                            Duration: {(item.durationMs / 1000).toFixed(2)}s
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
