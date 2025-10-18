"use client";

import React from "react";
import { CheckCircle2, RefreshCw, Circle, XCircle } from "lucide-react";
import styles from "./pipeline.module.css";

type StepStatus = "pending" | "running" | "success" | "error";

type PhaseCardProps = {
  label: string;
  status: StepStatus;
  isActive?: boolean;
};

export default function PhaseCard({ label, status, isActive }: PhaseCardProps) {
  const getIcon = () => {
    switch (status) {
      case "success":
        return <CheckCircle2 style={{ width: 24, height: 24, color: "#22c55e" }} />;
      case "error":
        return <XCircle style={{ width: 24, height: 24, color: "#ef4444" }} />;
      case "running":
        return <RefreshCw style={{ width: 24, height: 24, color: "#0ea5e9", animation: "spin 1s linear infinite" }} />;
      default:
        return <Circle style={{ width: 24, height: 24, color: "#cbd5e1" }} />;
    }
  };

  const statusMap: Record<StepStatus, string> = {
    success: styles.phaseSuccess,
    error: styles.phaseError,
    running: styles.phaseActive,
    pending: styles.phasePending
  };

  return (
    <div className={statusMap[status]}>
      <div className={styles.phaseIcon}>{getIcon()}</div>
      <p className={styles.phaseLabel}>{label}</p>
      <p className={styles.phaseStatus}>
        {status === "success" ? "Complete" : status === "error" ? "Failed" : status === "running" ? "Active" : "Pending"}
      </p>
    </div>
  );
}
