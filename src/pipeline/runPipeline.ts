import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import { geminiTranscriber } from "../mcp/geminiTranscriber.js";
import { docxExporter } from "../mcp/docxExporter.js";
import { pipGenerator } from "../mcp/pipGenerator.js";
import { makePolicyJudgeAgent } from "../agents/policyJudge.js";
import {
  MODELS,
  MAX_TURNS,
  MAX_REVIEW_ROUNDS,
  PIP_DRAFT_MODEL,
  ENABLE_DRAFT_STREAMING
} from "../config.js";
import {
  isStreamEvent,
  isSystemMessage,
  isToolResultEvent
} from "../types/index.js";
import { sanitizeError, sanitizePath } from "../utils/sanitize.js";
import { TokenCostTracker } from "../utils/costTracker.js";
import { extractToolUsage } from "../utils/toolUsage.js";
import { extractModelFamily, withModelFamilyInDocxPath } from "../utils/modelFamily.js";
import { runWithDraftStreamContext, emitDraftStreamEvent } from "./draftStreamContext.js";
import type { RunStatus } from "../server/runStore.js";

const MCP_SERVERS = {
  "gemini-transcriber": geminiTranscriber,
  "pip-generator": pipGenerator,
  "docx-exporter": docxExporter
} as const;

const ALLOWED_TOOLS = [
  "mcp__gemini-transcriber__transcribe_audio",
  "mcp__pip-generator__draft_pip",
  "mcp__docx-exporter__render_docx"
];

type Step = "transcribe" | "draft" | "review" | "export";
type StepStatus = "pending" | "running" | "success" | "error";

export interface PipelineHandlers {
  emit(event: string, data: unknown): void;
  setRunStatus(status: RunStatus, error?: unknown): void;
  finish(status: RunStatus, error?: unknown): void;
}

export interface RunPipelineParams {
  runId: string;
  audioPath: string;
  templatePath: string;
  outputPath: string;
  promptPath: string;
  guidelinesPath: string;
  inputLanguage: string;
  outputLanguage: string;
  projectRoot: string;
  signal?: AbortSignal;
  handlers: PipelineHandlers;
}

class RunAbortError extends Error {
  constructor(message = "Run aborted") {
    super(message);
    this.name = "RunAbortError";
  }
}

function buildPipelinePrompt(params: {
  audioPath: string;
  inputLanguage: string;
  outputLanguage: string;
  templatePath: string;
  outputPath: string;
  promptPath: string;
}) {
  const { audioPath, inputLanguage, outputLanguage, templatePath, outputPath, promptPath } = params;

  const transcriptionArgsExample = {
    audioPath,
    inputLanguage,
    outputLanguage,
    diarize: true,
    timestamps: true,
    startChunk: 0
  };

  const pipDraftArgs = {
    transcript: "<REPLACE_WITH_TRANSCRIPT>",
    outputLanguage,
    promptPath
  };

  const docxArgs = {
    templatePath,
    outputPath,
    language: outputLanguage,
    title: "Performance Improvement Plan",
    body: "<REPLACE_WITH_APPROVED_DRAFT>"
  };

  return [
    "You are an autonomous pipeline operator. Use the available MCP tools to complete the PIP workflow.",
    "TOOLS:",
    "- mcp__gemini-transcriber__transcribe_audio → transcribe audio meeting recordings.",
    "- mcp__pip-generator__draft_pip → create a draft PIP from a transcript.",
    "- mcp__docx-exporter__render_docx → produce the final DOCX file.",
    "STEPS:",
    `1. Initialize CURRENT_CHUNK=0 and TRANSCRIPTS=[] (strings). Call transcription with:\n${JSON.stringify(transcriptionArgsExample, null, 2)}`,
    "   Append transcripts, merge segments. Loop until nextChunk is null.",
    `2. Call PIP generator with:\n${JSON.stringify(pipDraftArgs, null, 2)}\n   Set CURRENT_DRAFT.`,
    `3. Send CURRENT_DRAFT to subagent \"policy-judge\" for review. Iterate up to ${MAX_REVIEW_ROUNDS}.`,
    `4. When approved, set APPROVED_DRAFT and call docx exporter with:\n${JSON.stringify(docxArgs, null, 2)}`,
    `5. Respond ONLY with JSON: {"status":"ok","draft":APPROVED_DRAFT,"docx":"${outputPath}"}`
  ].join("\n\n");
}

function extractJsonBlock(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = trimmed.slice(start, end + 1).trim();
    if (candidate.startsWith("{") && candidate.endsWith("}")) {
      return candidate;
    }
  }

  return null;
}

function toSerializableError(error: unknown) {
  const sanitized = sanitizeError(error);
  const { stack, ...rest } = sanitized;
  return rest;
}

function isValidDocx(pathToDocx: string, failureReason?: { reason?: string }): boolean {
  try {
    if (!fs.existsSync(pathToDocx)) {
      if (failureReason) failureReason.reason = "DOCX file is missing";
      return false;
    }

    const content = fs.readFileSync(pathToDocx);
    if (content.length === 0) {
      if (failureReason) failureReason.reason = "DOCX file is empty";
      return false;
    }

    const zip = new PizZip(content);
    const requiredEntries = ["[Content_Types].xml", "_rels/.rels", "word/document.xml"];

    for (const entry of requiredEntries) {
      const file = zip.file(entry);
      if (!file || file.dir) {
        if (failureReason) failureReason.reason = `Missing required entry: ${entry}`;
        return false;
      }
    }

    return true;
  } catch (error) {
    if (failureReason) {
      failureReason.reason = error instanceof Error ? error.message : "Unknown validation error";
    }
    return false;
  }
}

export async function runPipeline(params: RunPipelineParams): Promise<void> {
  console.log(`[runPipeline] ENTRY - runId: ${params.runId}`);

  const {
    runId,
    audioPath,
    templatePath,
    outputPath,
    promptPath,
    guidelinesPath,
    inputLanguage,
    outputLanguage,
    projectRoot,
    signal,
    handlers
  } = params;

  console.log(`[runPipeline] Parameters extracted, paths:`, {
    audioPath,
    templatePath,
    outputPath,
    promptPath,
    guidelinesPath
  });

  console.log(`[runPipeline] About to define runCore function`);

  const runCore = async (): Promise<void> => {
    console.log(`[runPipeline/runCore] ENTRY`);
    const emit = handlers.emit;
    let currentRunStatus: RunStatus = "pending";
  let lastError: unknown;
  let pipDraftModel: string | null = PIP_DRAFT_MODEL || null;
  let pipModelFamily: string | null = pipDraftModel ? extractModelFamily(pipDraftModel) : null;

  const updateDraftModel = (candidate: unknown) => {
    if (typeof candidate !== "string") {
      return;
    }
    const trimmed = candidate.trim();
    if (!trimmed || trimmed === pipDraftModel) {
      return;
    }
    pipDraftModel = trimmed;
    const family = extractModelFamily(trimmed);
    pipModelFamily = family;
  };

  const ensureDocxPathHasModel = (docxPath: string): string => {
    if (!pipModelFamily) {
      return docxPath;
    }
    const desiredPath = withModelFamilyInDocxPath(docxPath, pipModelFamily);
    const resolvedSource = path.resolve(docxPath);
    const resolvedTarget = path.resolve(desiredPath);
    if (resolvedSource === resolvedTarget) {
      return resolvedTarget;
    }
    try {
      if (!fs.existsSync(resolvedSource)) {
        emit("log", {
          level: "warn",
          message: `Expected DOCX not found for renaming: ${sanitizePath(resolvedSource)}`
        });
        return docxPath;
      }
      const targetDir = path.dirname(resolvedTarget);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      let candidateTarget = resolvedTarget;
      if (fs.existsSync(candidateTarget)) {
        const parsedCandidate = path.parse(candidateTarget);
        candidateTarget = path.join(
          parsedCandidate.dir,
          `${parsedCandidate.name}-${Date.now()}${parsedCandidate.ext}`
        );
      }
      fs.renameSync(resolvedSource, candidateTarget);
      emit("log", {
        level: "info",
        message: `Renamed DOCX to include model (${pipModelFamily}): ${sanitizePath(candidateTarget)}`
      });
      return candidateTarget;
    } catch (renameError) {
      const renameDetails = sanitizeError(renameError);
      emit("log", {
        level: "warn",
        message: `Failed to rename DOCX with model: ${
          typeof renameDetails.message === "string" ? renameDetails.message : "unknown error"
        }`
      });
      return docxPath;
    }
  };

  const setRunStatus = (status: RunStatus, error?: unknown) => {
    currentRunStatus = status;
    handlers.setRunStatus(status, error);
    if (error) {
      lastError = error;
    }
  };

  const sendStatus = (
    step: Step,
    status: StepStatus,
    meta?: Record<string, unknown>
  ) => {
    const at = new Date().toISOString();
    if (meta && Object.keys(meta).length > 0) {
      emit("status", { step, status, meta, at });
    } else {
      emit("status", { step, status, at });
    }
  };

  const costTracker = new TokenCostTracker();
  const pushCost = () => {
    const summary = costTracker.getSummary();
    emit("cost", {
      summary: {
        totalTokens: summary.totalTokens,
        estimatedCostUSD: summary.estimatedCostUSD,
        breakdown: summary.breakdown
      },
      at: new Date().toISOString()
    });
  };

  const MAX_JSON_DEBUG_LOGS = 5;
  let jsonParseDebugCount = 0;
  const logJsonParseFailure = (source: string, raw: string, error: unknown) => {
    if (jsonParseDebugCount >= MAX_JSON_DEBUG_LOGS) {
      return;
    }
    jsonParseDebugCount += 1;
    emit("log", {
      level: "debug",
      message: `Failed to parse JSON from ${source}`,
      details: {
        snippet: raw.slice(0, 200),
        rawLength: raw.length,
        error: sanitizeError(error)
      }
    });
  };

  const judgeGuidelines = fs.readFileSync(guidelinesPath, "utf-8");
  const judgeAgent = makePolicyJudgeAgent(judgeGuidelines, outputLanguage);

  const abortSignal: AbortSignal = signal ?? new AbortController().signal;
  let aborted = false;
  let pipelineIterator: AsyncIterableIterator<SDKMessage> | undefined;
  const abortListener = () => {
    aborted = true;
    clearPreviewTimeouts();
    emit("log", { level: "warn", message: "Abort requested; stopping pipeline iteration" });
    if (pipelineIterator?.return) {
      Promise.resolve()
        .then(() => pipelineIterator?.return?.())
        .catch(() => undefined);
    }
  };
  abortSignal.addEventListener("abort", abortListener);

  const ensureNotAborted = () => {
    if (aborted || abortSignal.aborted) {
      throw new RunAbortError();
    }
  };

  setRunStatus("running");
  let hasFinalEvent = false;

  console.log(`[runPipeline] Creating query iterator for run ${runId}`);
  console.log(`[runPipeline] Config:`, {
    model: MODELS.CLAUDE_SONNET,
    maxTurns: MAX_TURNS,
    allowedTools: ALLOWED_TOOLS
  });

  const iterator = query({
    prompt: buildPipelinePrompt({
      audioPath,
      inputLanguage,
      outputLanguage,
      templatePath,
      outputPath,
      promptPath
    }),
    options: {
      model: MODELS.CLAUDE_SONNET,
      agents: { "policy-judge": judgeAgent },
      mcpServers: MCP_SERVERS,
      allowedTools: ALLOWED_TOOLS,
      permissionMode: "bypassPermissions",
      maxTurns: MAX_TURNS
    }
  });
  pipelineIterator = iterator;
  console.log(`[runPipeline] Iterator created, entering message loop`);

  let judgeRound = 0;
  let transcribeProcessed = 0;
  let transcribeTotal: number | null = null;
  let transcriptAccumulator = "";
  const chunkSnippets = new Map<number, string>();
  let draftPreviewEmitted = false;
  let processedProgressSource: "explicit" | "heuristic" = "heuristic";
  let totalProgressSource: "explicit" | "heuristic" = "heuristic";
  const previewTimeouts: NodeJS.Timeout[] = [];

  const clearPreviewTimeouts = () => {
    while (previewTimeouts.length > 0) {
      const timeout = previewTimeouts.pop();
      if (timeout) clearTimeout(timeout);
    }
  };

  type Inflight = { id: string; name?: string; startedAt: string };
  const inflightMap: Map<string, Inflight> = new Map();
  const fallbackToolId = (name?: string) =>
    `${name || "tool"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pushInflight = (candidateId: string | undefined, name?: string): Inflight => {
    const id =
      typeof candidateId === "string" && candidateId.trim().length > 0
        ? candidateId
        : fallbackToolId(name);
    const startedAt = new Date().toISOString();
    const item: Inflight = { id, name, startedAt };
    inflightMap.set(id, item);
    return item;
  };
  const takeInflight = (candidateId?: string, name?: string): Inflight | undefined => {
    if (candidateId && inflightMap.has(candidateId)) {
      const item = inflightMap.get(candidateId);
      inflightMap.delete(candidateId);
      return item;
    }
    if (name) {
      const entry = Array.from(inflightMap.values()).find((value) => value.name === name);
      if (entry) {
        inflightMap.delete(entry.id);
        return entry;
      }
    }
    return undefined;
  };

  sendStatus("transcribe", "running");

  console.log(`[runPipeline] Starting iterator loop for run ${runId}`);

  try {
    try {
      let messageCount = 0;
      for await (const message of iterator) {
        messageCount++;
        console.log(`[runPipeline] Message ${messageCount}:`, message.type);
        ensureNotAborted();
        costTracker.recordMessage(message);
        pushCost();

      if (isSystemMessage(message) && "sessionId" in message) {
        const sessionId = (message as SDKMessage & { sessionId?: string }).sessionId;
        if (sessionId) {
          emit("log", { level: "info", message: `Session ${sessionId}` });
        }
      }

      if (message.type === "assistant" && "message" in message) {
        const assistantMsg = (message as any).message;
        if (
          assistantMsg &&
          typeof assistantMsg === "object" &&
          "content" in assistantMsg &&
          Array.isArray(assistantMsg.content)
        ) {
          for (const block of assistantMsg.content) {
              if (block && typeof block === "object" && block.type === "tool_use") {
              const toolUse = block as { id: string; name: string; input: unknown };
              const item = pushInflight(
                typeof toolUse.id === "string" ? toolUse.id : undefined,
                toolUse.name
              );
              emit("tool_use", {
                id: item.id,
                name: toolUse.name,
                startedAt: item.startedAt,
                inputSummary: toolUse.input
              });

              if (toolUse.name.includes("gemini-transcriber")) {
                sendStatus("transcribe", "running");
              } else if (toolUse.name.includes("pip-generator")) {
                sendStatus("transcribe", "success");
                sendStatus("draft", "running");
                if (ENABLE_DRAFT_STREAMING) {
                  emitDraftStreamEvent("reset", { at: new Date().toISOString(), runId });
                }
                if (
                  toolUse.input &&
                  typeof toolUse.input === "object" &&
                  !Array.isArray(toolUse.input)
                ) {
                  const maybeModel = (toolUse.input as { model?: unknown }).model;
                  updateDraftModel(maybeModel);
                }
              } else if (toolUse.name.includes("docx-exporter")) {
                sendStatus("draft", "success");
                sendStatus("review", "success");
                sendStatus("export", "running");
              }

              if (
                toolUse.name === "TodoWrite" &&
                toolUse.input &&
                typeof toolUse.input === "object"
              ) {
                const todos = (toolUse.input as { todos?: unknown }).todos;
                if (Array.isArray(todos)) {
                  emit("todo", { todos });
                }
              }
            }
          }
        }
      }

      if (isStreamEvent(message)) {
        const eventData = (message as SDKMessage & { event: unknown }).event as unknown;

        if (isToolResultEvent(eventData)) {
          const resultData = {
            id: (eventData as { id?: string }).id,
            name: (eventData as { name?: string }).name,
            isError: (eventData as { isError?: boolean }).isError,
            content: (eventData as { content?: unknown }).content
          };
          const finishedAt = new Date().toISOString();
          const inflight = takeInflight(
            typeof resultData.id === "string" ? resultData.id : undefined,
            resultData.name
          );
          const id =
            inflight?.id ??
            (typeof resultData.id === "string" && resultData.id.trim().length > 0
              ? resultData.id
              : fallbackToolId(resultData.name));
          const startedAt = inflight?.startedAt;
          const durationMs = startedAt
            ? Date.parse(finishedAt) - Date.parse(startedAt)
            : undefined;
          emit("tool_result", {
            id,
            name: resultData.name,
            isError: resultData.isError,
            content: resultData.content,
            finishedAt,
            durationMs
          });

          const name = resultData.name;

          if (name?.includes("gemini-transcriber")) {
            if (resultData.isError) {
              sendStatus("transcribe", "error");
            } else {
              sendStatus("transcribe", "success");
              sendStatus("draft", "running");
              draftPreviewEmitted = false;
            }
          } else if (name?.includes("pip-generator")) {
            if (resultData.isError) {
              sendStatus("draft", "error");
            } else {
              sendStatus("draft", "success");
              sendStatus("review", "running");
            }
          } else if (name?.includes("docx-exporter")) {
            if (resultData.isError) {
              sendStatus("export", "error");
            } else {
              sendStatus("review", "success");
              sendStatus("export", "success");
            }
          }

          const payload = resultData.content;
          if (!resultData.isError) {
            const usage = extractToolUsage(payload);
            if (usage) {
              const provider = usage.provider?.toLowerCase();
              const isGeminiTool = name?.includes("gemini-transcriber") || provider === "gemini";
              if (isGeminiTool) {
                if (usage.inputTokens > 0 || usage.outputTokens > 0) {
                  costTracker.recordTotals({
                    geminiInputTokens: usage.inputTokens,
                    geminiOutputTokens: usage.outputTokens
                  });
                  pushCost();
                }
              } else {
                if (
                  usage.inputTokens > 0 ||
                  usage.outputTokens > 0 ||
                  usage.cacheCreationTokens > 0 ||
                  usage.cacheReadTokens > 0
                ) {
                  costTracker.recordTotals({
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                    cacheCreationTokens: usage.cacheCreationTokens,
                    cacheReadTokens: usage.cacheReadTokens
                  });
                  pushCost();
                }
              }
            }
          }

          const textPart = Array.isArray(payload)
            ? payload.find((item) => typeof item?.text === "string")?.text
            : typeof payload === "string"
              ? payload
              : null;

          if (typeof textPart === "string") {
            try {
              const parsed = JSON.parse(textPart) as {
                transcript?: string;
                draft?: string;
                processedChunks?: number;
                totalChunks?: number;
                startChunk?: number;
                nextChunk?: number | null;
                segments?: Array<{ text?: unknown }>;
                model?: unknown;
                usage?: unknown;
              };
              if (name?.includes("pip-generator")) {
                const directModel =
                  typeof parsed.model === "string" ? parsed.model : undefined;
                if (directModel) {
                  updateDraftModel(directModel);
                } else if (
                  parsed.usage &&
                  typeof parsed.usage === "object" &&
                  !Array.isArray(parsed.usage)
                ) {
                  const usageModel = (parsed.usage as { model?: unknown }).model;
                  updateDraftModel(usageModel);
                }
              }
              if (!ENABLE_DRAFT_STREAMING && !resultData.isError && name?.includes("pip-generator") && !draftPreviewEmitted) {
                const draftText = typeof parsed.draft === "string" ? parsed.draft.trim() : "";
                if (draftText) {
                  draftPreviewEmitted = true;
                  const snippetLines = draftText
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter((line): line is string => line.length > 0)
                    .slice(0, 3);
                  snippetLines.forEach((line, idx) => {
                    const timeout = setTimeout(() => {
                      emit("draft_preview_chunk", {
                        text: line,
                        index: idx,
                        total: snippetLines.length,
                        at: new Date().toISOString()
                      });
                    }, idx * 120);
                    previewTimeouts.push(timeout);
                  });
                  const completionDelay = snippetLines.length * 120 + 80;
                  previewTimeouts.push(
                    setTimeout(() => {
                      emit("draft_preview_complete", {
                        total: snippetLines.length,
                        at: new Date().toISOString()
                      });
                    }, completionDelay)
                  );
                }
              }

              if (typeof parsed.totalChunks === "number" && parsed.totalChunks > 0) {
                transcribeTotal = Math.max(transcribeTotal ?? 0, parsed.totalChunks);
                totalProgressSource = "explicit";
              }
              if (typeof parsed.processedChunks === "number") {
                const start =
                  typeof parsed.startChunk === "number"
                    ? parsed.startChunk
                    : transcribeProcessed;
                const candidateProcessed = start + parsed.processedChunks;
                transcribeProcessed = Math.max(transcribeProcessed, candidateProcessed);
                processedProgressSource = "explicit";
              }
              if (
                typeof parsed.startChunk === "number" &&
                typeof parsed.processedChunks !== "number"
              ) {
                transcribeProcessed = Math.max(transcribeProcessed, parsed.startChunk);
                processedProgressSource = "explicit";
              }
              if (typeof parsed.nextChunk === "number") {
                const inferredTotal = parsed.nextChunk + 1;
                transcribeTotal = Math.max(transcribeTotal ?? 0, inferredTotal);
                totalProgressSource = "explicit";
              } else if (
                parsed.nextChunk === null &&
                transcribeTotal === null &&
                transcribeProcessed > 0
              ) {
                transcribeTotal = transcribeProcessed;
                totalProgressSource = "heuristic";
              }

              const rawTranscript = typeof parsed.transcript === "string" ? parsed.transcript : "";
              let transcriptText = rawTranscript.trim();
              if (!transcriptText && Array.isArray(parsed.segments)) {
                transcriptText = parsed.segments
                  .map((seg) => {
                    if (!seg || typeof seg !== "object") return "";
                    const text = (seg as { text?: unknown }).text;
                    return typeof text === "string" ? text.trim() : "";
                  })
                  .filter(Boolean)
                  .join("\n");
              }

              if (transcribeProcessed === 0 && transcriptText) {
                transcribeProcessed = 1;
                processedProgressSource = "heuristic";
              }
              if (transcribeTotal === null && transcriptText) {
                transcribeTotal = transcribeProcessed > 0 ? transcribeProcessed : 1;
                totalProgressSource = "heuristic";
              }

              if (transcriptText) {
                if (typeof parsed.startChunk === "number") {
                  chunkSnippets.set(parsed.startChunk, transcriptText);
                  const ordered = Array.from(chunkSnippets.entries())
                    .sort((a, b) => a[0] - b[0])
                    .map(([, text]) => text.trim())
                    .filter(Boolean);
                  transcriptAccumulator = ordered.join("\n\n");
                } else {
                  transcriptAccumulator = transcriptText;
                }
                const preview = (transcriptAccumulator || transcriptText).slice(0, 1500);
                const transcriptEvent: Record<string, unknown> = {
                  transcript: preview,
                  processedChunks: transcribeProcessed || 1,
                  totalChunks: transcribeTotal ?? (transcribeProcessed || 1),
                  at: new Date().toISOString()
                };
                if (processedProgressSource === "heuristic" || totalProgressSource === "heuristic") {
                  transcriptEvent.meta = { progressMode: "heuristic" as const };
                }
                emit("transcript_chunk", transcriptEvent);
              } else if (transcribeProcessed > 0 || transcribeTotal !== null) {
                const transcriptEvent: Record<string, unknown> = {
                  processedChunks: transcribeProcessed || undefined,
                  totalChunks: transcribeTotal ?? undefined,
                  at: new Date().toISOString()
                };
                if (processedProgressSource === "heuristic" || totalProgressSource === "heuristic") {
                  transcriptEvent.meta = { progressMode: "heuristic" as const };
                }
                emit("transcript_chunk", transcriptEvent);
              }
            } catch (error) {
              logJsonParseFailure("tool_result_content", textPart, error);
            }
          }

          if (resultData.isError) {
            emit("error", {
              message: "Tool error",
              details: toSerializableError(resultData.content)
            });
          }
        }

        if (eventData && typeof eventData === "object") {
          const jsonFields = "delta" in eventData ? (eventData as { delta?: unknown }).delta : undefined;
          const maybeText =
            typeof jsonFields === "string"
              ? jsonFields
              : typeof (eventData as { content?: unknown }).content === "string"
                ? ((eventData as { content?: unknown }).content as string)
                : undefined;

          const candidate = extractJsonBlock(maybeText);

          if (candidate) {
            if (judgeRound >= MAX_REVIEW_ROUNDS) {
              continue;
            }
            try {
              const verdict = JSON.parse(candidate) as {
                approved?: boolean;
                reasons?: string[];
                required_changes?: string[];
                revised_draft?: string | null;
              };
              if (typeof verdict.approved === "boolean") {
                judgeRound += 1;
                emit("judge_round", {
                  approved: verdict.approved,
                  reasons: verdict.reasons ?? [],
                  required_changes: verdict.required_changes ?? [],
                  revised_draft: verdict.revised_draft ?? null,
                  round: judgeRound,
                  at: new Date().toISOString()
                });
                const reviewStatus = verdict.approved
                  ? "success"
                  : judgeRound >= MAX_REVIEW_ROUNDS
                    ? "error"
                    : "running";
                sendStatus("review", reviewStatus, { round: judgeRound });
              }
            } catch (error) {
              logJsonParseFailure("policy_judge_verdict", candidate, error);
            }
          }
        }
      }

      if (message.type === "result") {
        if (message.subtype === "success") {
          const rawResult = message.result;
          let payload: unknown = rawResult;
          if (typeof rawResult === "string") {
            const cleaned = rawResult.replace(/```json\s*|```/g, "").trim();
            try {
              payload = JSON.parse(cleaned);
            } catch (error) {
              logJsonParseFailure("final_result_payload", cleaned, error);
              payload = rawResult;
            }
          }

          if (
            payload &&
            typeof payload === "object" &&
            (payload as { status?: string }).status === "ok"
          ) {
            const draft = (payload as { draft?: string }).draft ?? "";
            const docxRaw = (payload as { docx?: string }).docx ?? outputPath;
            const finalDocxPath = ensureDocxPathHasModel(docxRaw);
            const docxRelative = sanitizePath(path.relative(projectRoot, finalDocxPath));
            sendStatus("export", "success");
            emit("final", {
              ok: true,
              draft,
              docx: sanitizePath(finalDocxPath),
              docxRelative,
              at: new Date().toISOString()
            });
            hasFinalEvent = true;
            setRunStatus("success");
          } else {
            const sanitizedPayload = sanitizeError(payload ?? rawResult);
            emit("error", {
              message: "Pipeline failed",
              details: sanitizedPayload
            });
            setRunStatus("error", sanitizedPayload);
          }
        } else {
          emit("error", { message: "Run error", details: toSerializableError(message) });
          setRunStatus("error", message);
        }
      }
      }
      console.log(`[runPipeline] Iterator loop completed normally, processed ${messageCount} messages`);
    } catch (workerError) {
      console.error(`[runPipeline] Worker error:`, workerError);
      emit("log", {
        level: "warn",
        message: "Worker process encountered an error, checking for output file..."
      });

      if (fs.existsSync(outputPath)) {
        const failureReason: { reason?: string } = {};
        if (isValidDocx(outputPath, failureReason)) {
          emit("log", { level: "info", message: "Output file was created successfully despite worker error" });
          sendStatus("export", "success");
          const finalDocxPath = ensureDocxPathHasModel(outputPath);
          const docxRelative = sanitizePath(path.relative(projectRoot, finalDocxPath));
          emit("final", {
            ok: true,
            docx: sanitizePath(finalDocxPath),
            docxRelative,
            recovered: true
          });
          hasFinalEvent = true;
          setRunStatus("success");
          clearPreviewTimeouts();
          return;
        } else if (failureReason.reason) {
          emit("log", {
            level: "warn",
            message: `Recovered DOCX failed validation: ${failureReason.reason}`
          });
        } else {
          emit("log", {
            level: "warn",
            message: "Recovered DOCX failed validation for an unknown reason"
          });
        }
      }

      throw workerError;
    }

    if (!hasFinalEvent && ["running", "pending"].includes(currentRunStatus)) {
      console.log(`[runPipeline] No final event emitted, status: ${currentRunStatus}`);
      const details = { message: "No final event emitted" };
      emit("error", details);
      setRunStatus("error", details);
    }
  } catch (error) {
    console.error(`[runPipeline] Caught error in outer try-catch:`, error);
    if (error instanceof RunAbortError) {
      setRunStatus("aborted");
      emit("error", { message: "Run aborted by client" });
    } else {
      emit("error", {
        message: error instanceof Error ? error.message : "Unhandled error",
        details: toSerializableError(error)
      });
      setRunStatus("error", error);
    }
  } finally {
    console.log(`[runPipeline] Finally block, status: ${currentRunStatus}, hasFinalEvent: ${hasFinalEvent}`);
    clearPreviewTimeouts();
    abortSignal.removeEventListener("abort", abortListener);
    handlers.finish(currentRunStatus, lastError);
  }
};

  console.log(`[runPipeline] runCore function defined successfully`);
  console.log(`[runPipeline] ENABLE_DRAFT_STREAMING: ${ENABLE_DRAFT_STREAMING}`);

  if (ENABLE_DRAFT_STREAMING) {
    console.log(`[runPipeline] Running with draft stream context`);
    await runWithDraftStreamContext(
      {
        runId,
        streamingEnabled: true,
        emit: handlers.emit
      },
      async () => {
        emitDraftStreamEvent("reset", { at: new Date().toISOString(), runId });
        await runCore();
      }
    );
  } else {
    console.log(`[runPipeline] Running without draft stream context`);
    await runCore();
  }

  console.log(`[runPipeline] runPipeline completed for ${runId}`);
}
