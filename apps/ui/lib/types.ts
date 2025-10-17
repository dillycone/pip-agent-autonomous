import type { Step, StepStatus } from "../app/page";

export type LogItem = {
  ts: number;
  type: string;
  payload: unknown;
};

export type TimelineItem = {
  id: string;
  name: string;
  phase: Step | "unknown";
  status: StepStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  inputSummary?: unknown;
  contentSummary?: unknown;
  isError?: boolean;
};

export type CostState = {
  tokens: number;
  usd: number;
  breakdown: Record<string, unknown>;
};

export type RunMetadata = {
  runId: string;
  status: "pending" | "running" | "success" | "error" | "aborted";
  createdAt?: string;
};
