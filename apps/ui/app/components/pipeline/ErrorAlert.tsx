"use client";

import React, { useState } from "react";
import { AlertCircle, ChevronDown } from "lucide-react";
import styles from "./pipeline.module.css";

type Step = "transcribe" | "draft" | "review" | "export";

type ErrorAlertProps = {
  failedStep: Step | null;
  errorMessage: string;
  onRetry?: () => void;
  onReset?: () => void;
  errorDetails?: string;
};

const errorSolutions: Record<Step, string[]> = {
  transcribe: [
    "Verify the audio file exists and is in a supported format (MP3, WAV, etc.)",
    "Check that the audio file is not corrupted or truncated",
    "Ensure the API key has sufficient quota for transcription",
    "Try with a smaller audio file to verify API connectivity"
  ],
  draft: [
    "Verify API key is valid and has remaining token quota",
    "Check that transcription completed successfully",
    "Review template file exists and is not corrupted",
    "Ensure prompt configuration is correct",
    "Try reducing draft length or complexity"
  ],
  review: [
    "Draft may violate company policies - review content against guidelines",
    "Check policy configuration and rules",
    "Try increasing max review rounds if needed",
    "Consider revising the draft manually before re-running"
  ],
  export: [
    "Verify template file (.docx) exists and is not corrupted",
    "Check output path has proper permissions and is not full",
    "Ensure output directory path is correct",
    "Try specifying a different output location"
  ]
};

export default function ErrorAlert({
  failedStep,
  errorMessage,
  onRetry,
  onReset,
  errorDetails
}: ErrorAlertProps) {
  const [showLogs, setShowLogs] = useState(false);

  if (!failedStep) return null;

  const solutions = errorSolutions[failedStep] || [];

  return (
    <div className={styles.errorAlert}>
      <div className={styles.errorHeader}>
        <AlertCircle className={styles.errorIcon} size={18} />
        <h3 className={styles.errorTitle}>
          {failedStep.charAt(0).toUpperCase() + failedStep.slice(1)} Failed
        </h3>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <p className={styles.errorMessage}>{errorMessage}</p>

        {/* Solutions */}
        {solutions.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <p style={{ fontWeight: "600", color: "#991b1b", fontSize: "13px", margin: 0 }}>
              Suggested Actions:
            </p>
            <ul className={styles.solutionsList}>
              {solutions.map((solution, idx) => (
                <li key={idx} style={{ color: "#991b1b", fontSize: "12px" }}>
                  {solution}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Error Logs Collapsible */}
        {errorDetails && (
          <div>
            <button
              className={styles.detailsToggle}
              onClick={() => setShowLogs(!showLogs)}
              type="button"
              style={{ color: "#b91c1c" }}
            >
              <ChevronDown
                size={16}
                style={{
                  transform: showLogs ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease"
                }}
              />
              <span style={{ fontSize: "12px" }}>
                {showLogs ? "Hide" : "Show"} Error Logs
              </span>
            </button>

            {showLogs && (
              <div style={{
                marginTop: "8px",
                background: "#1e293b",
                color: "#f1f5f9",
                borderRadius: "6px",
                padding: "8px",
                fontFamily: "monospace",
                fontSize: "11px",
                overflow: "auto",
                maxHeight: "160px",
                border: "1px solid #fecaca"
              }}>
                {errorDetails.split("\n").map((line, idx) => (
                  <div key={idx} style={{ lineHeight: "1.4" }}>{line}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className={styles.errorActions}>
          {onRetry && (
            <button
              className={styles.retryBtn}
              onClick={onRetry}
              type="button"
            >
              Retry with Same Inputs
            </button>
          )}
          {onReset && (
            <button
              className={styles.resetBtn}
              onClick={onReset}
              type="button"
            >
              Start Over
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
