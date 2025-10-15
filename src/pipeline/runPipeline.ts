import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import path from "node:path";
import { geminiTranscriber } from "../mcp/geminiTranscriber.js";
import { docxExporter } from "../mcp/docxExporter.js";
import { pipGenerator } from "../mcp/pipGenerator.js";
import { makePolicyJudgeAgent } from "../agents/policyJudge.js";
import {
  MODELS,
  MAX_TURNS,
  MAX_REVIEW_ROUNDS
} from "../config.js";
import {
  isStreamEvent,
  isSystemMessage,
  isToolResultEvent
} from "../types/index.js";
import { sanitizeError, sanitizePath } from "../utils/sanitize.js";
import { TokenCostTracker } from "../utils/costTracker.js";
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

export async function runPipeline(params: RunPipelineParams): Promise<void> {
  const {
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

  const emit = handlers.emit;
  let currentRunStatus: RunStatus = "pending";
  let lastError: unknown;

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

  const judgeGuidelines = fs.readFileSync(guidelinesPath, "utf-8");
  const judgeAgent = makePolicyJudgeAgent(judgeGuidelines, outputLanguage);

  const abortSignal: AbortSignal = signal ?? new AbortController().signal;
  let aborted = false;
  const abortListener = () => {
    aborted = true;
  };
  abortSignal.addEventListener("abort", abortListener);

  const ensureNotAborted = () => {
    if (aborted || abortSignal.aborted) {
      throw new RunAbortError();
    }
  };

  setRunStatus("running");
  let hasFinalEvent = false;

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

  let judgeRound = 0;
  let transcribeProcessed = 0;
  let transcribeTotal: number | null = null;
  let transcriptAccumulator = "";
  const chunkSnippets = new Map<number, string>();

  type Inflight = { id: string; name: string; startedAt: string };
  const inflightMap: Map<string, Inflight[]> = new Map();
  const toolId = (name: string) =>
    `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pushInflight = (name: string): Inflight => {
    const id = toolId(name);
    const startedAt = new Date().toISOString();
    const item = { id, name, startedAt };
    const arr = inflightMap.get(name) ?? [];
    arr.push(item);
    inflightMap.set(name, arr);
    return item;
  };
  const popInflight = (name: string): Inflight | undefined => {
    const arr = inflightMap.get(name) ?? [];
    const item = arr.shift();
    if (arr.length === 0) inflightMap.delete(name);
    else inflightMap.set(name, arr);
    return item;
  };

  sendStatus("transcribe", "running");

  try {
    try {
      for await (const message of iterator) {
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
              const item = pushInflight(toolUse.name);
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
            name: (eventData as { name?: string }).name,
            isError: (eventData as { isError?: boolean }).isError,
            content: (eventData as { content?: unknown }).content
          };
          const finishedAt = new Date().toISOString();
          const inflight = resultData.name ? popInflight(resultData.name) : undefined;
          const id = inflight?.id ?? toolId(resultData.name || "tool");
          const startedAt = inflight?.startedAt;
          const durationMs = startedAt
            ? Date.parse(finishedAt) - Date.parse(startedAt)
            : undefined;
          emit("tool_result", {
            id,
            ...resultData,
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
          const textPart = Array.isArray(payload)
            ? payload.find((item) => typeof item?.text === "string")?.text
            : typeof payload === "string"
              ? payload
              : null;

          if (typeof textPart === "string") {
            try {
              const parsed = JSON.parse(textPart) as {
                transcript?: string;
                processedChunks?: number;
                totalChunks?: number;
                startChunk?: number;
                nextChunk?: number | null;
                segments?: Array<{ text?: unknown }>;
              };
              if (typeof parsed.totalChunks === "number" && parsed.totalChunks > 0) {
                transcribeTotal = Math.max(transcribeTotal ?? 0, parsed.totalChunks);
              }
              if (typeof parsed.processedChunks === "number") {
                const start =
                  typeof parsed.startChunk === "number"
                    ? parsed.startChunk
                    : transcribeProcessed;
                const candidateProcessed = start + parsed.processedChunks;
                transcribeProcessed = Math.max(transcribeProcessed, candidateProcessed);
              }
              if (
                typeof parsed.startChunk === "number" &&
                typeof parsed.processedChunks !== "number"
              ) {
                transcribeProcessed = Math.max(transcribeProcessed, parsed.startChunk);
              }
              if (typeof parsed.nextChunk === "number") {
                const inferredTotal = parsed.nextChunk + 1;
                transcribeTotal = Math.max(transcribeTotal ?? 0, inferredTotal);
              } else if (
                parsed.nextChunk === null &&
                transcribeTotal === null &&
                transcribeProcessed > 0
              ) {
                transcribeTotal = transcribeProcessed;
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
              }
              if (transcribeTotal === null && transcriptText) {
                transcribeTotal = transcribeProcessed > 0 ? transcribeProcessed : 1;
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
                emit("transcript_chunk", {
                  transcript: preview,
                  processedChunks: transcribeProcessed || 1,
                  totalChunks: transcribeTotal ?? (transcribeProcessed || 1),
                  at: new Date().toISOString()
                });
              } else if (transcribeProcessed > 0 || transcribeTotal !== null) {
                emit("transcript_chunk", {
                  processedChunks: transcribeProcessed || undefined,
                  totalChunks: transcribeTotal ?? undefined,
                  at: new Date().toISOString()
                });
              }
            } catch {
              // Ignore non-JSON payloads
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
            } catch {
              // Ignore JSON parse issues
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
            } catch {
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
            const docxRelative = sanitizePath(path.relative(projectRoot, docxRaw));
            sendStatus("export", "success");
          emit("final", {
            ok: true,
            draft,
            docx: sanitizePath(docxRaw),
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
    } catch (workerError) {
      emit("log", {
        level: "warn",
        message: "Worker process encountered an error, checking for output file..."
      });

      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        if (stats.size > 1000) {
          emit("log", { level: "info", message: "Output file was created successfully despite worker error" });
          sendStatus("export", "success");
          const docxRelative = sanitizePath(path.relative(projectRoot, outputPath));
          emit("final", {
            ok: true,
            docx: sanitizePath(outputPath),
            docxRelative,
            recovered: true
          });
          hasFinalEvent = true;
          setRunStatus("success");
          return;
        }
      }

      throw workerError;
    }

    if (!hasFinalEvent && ["running", "pending"].includes(currentRunStatus)) {
      setRunStatus("success");
    }
  } catch (error) {
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
    abortSignal.removeEventListener("abort", abortListener);
    handlers.finish(currentRunStatus, lastError);
  }
}
