import { NextRequest } from "next/server";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { geminiTranscriber } from "@pip/mcp/geminiTranscriber";
import { docxExporter } from "@pip/mcp/docxExporter";
import { pipGenerator } from "@pip/mcp/pipGenerator";
import { makePolicyJudgeAgent } from "@pip/agents/policyJudge";
import {
  MODELS,
  MAX_TURNS,
  MAX_REVIEW_ROUNDS,
  GUIDELINES_PATH,
  PIP_PROMPT_PATH
} from "@pip/config";
import {
  hasUsage,
  isStreamEvent,
  isSystemMessage,
  isToolUseEvent,
  isToolResultEvent
} from "@pip/types";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

type CostAccumulator = {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
};

type Serializable = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

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

function pushUsage(cost: CostAccumulator, message: SDKMessage) {
  if (!hasUsage(message) || !message.usage) return;
  cost.input += message.usage.input_tokens || 0;
  cost.output += message.usage.output_tokens || 0;
  cost.cacheCreate += message.usage.cache_creation_input_tokens || 0;
  cost.cacheRead += message.usage.cache_read_input_tokens || 0;
}

function sseLine(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function toSerializableError(error: unknown): Serializable {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.parse(JSON.stringify(error));
    } catch {
      return { message: String(error) };
    }
  }
  return { message: String(error) };
}

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams;
  const audioParam = search.get("audio") ?? "uploads/meeting.mp3";
  const inputLanguage = search.get("in") ?? "auto";
  const outputLanguage = search.get("out") ?? "en";
  const templateParam = search.get("template") ?? "templates/pip-template.docx";
  const outputParam = search.get("outdoc") ?? `exports/pip-${Date.now()}.docx`;

  const encoder = new TextEncoder();
  const projectRoot = path.resolve(process.cwd(), "../..");
  const guidelinesPath = path.resolve(projectRoot, GUIDELINES_PATH);
  const promptPathDefault = path.resolve(projectRoot, PIP_PROMPT_PATH);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseLine(event, data)));
      };

      const sendStatus = (
        step: Step,
        status: "pending" | "running" | "success" | "error",
        meta?: Record<string, unknown>
      ) => {
        if (meta && Object.keys(meta).length > 0) {
          write("status", { step, status, meta });
        } else {
          write("status", { step, status });
        }
      };

      const closeWithError = (error: unknown) => {
        write("error", {
          message: error instanceof Error ? error.message : "Unknown error",
          details: toSerializableError(error)
        });
        controller.close();
      };

      const cost: CostAccumulator = {
        input: 0,
        output: 0,
        cacheCreate: 0,
        cacheRead: 0
      };

      try {
        const audioPath = path.resolve(projectRoot, audioParam);
        const templatePath = path.resolve(projectRoot, templateParam);
        const outputPath = path.resolve(projectRoot, outputParam);
        const promptPath = path.resolve(projectRoot, promptPathDefault);

        const judgeGuidelines = fs.readFileSync(guidelinesPath, "utf-8");
        const judgeAgent = makePolicyJudgeAgent(judgeGuidelines, outputLanguage);

        sendStatus("transcribe", "running");

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

        try {
          for await (const message of iterator) {
          pushUsage(cost, message);

          const totalTokens = cost.input + cost.output + cost.cacheCreate + cost.cacheRead;
          write("cost", {
            summary: {
              totalTokens,
              estimatedCostUSD: totalTokens / 1_000_000,
              breakdown: { ...cost }
            }
          });

          if (isSystemMessage(message) && "sessionId" in message) {
            const sessionId = (message as SDKMessage & { sessionId?: string }).sessionId;
            if (sessionId) {
              write("log", { level: "info", message: `Session ${sessionId}` });
            }
          }

          if (isStreamEvent(message)) {
            const eventData = (message as SDKMessage & { event: unknown }).event as unknown;

            if (isToolUseEvent(eventData)) {
              write("tool_use", { name: eventData.name, input: eventData.input });

              if (eventData.name.includes("gemini-transcriber")) {
                sendStatus("transcribe", "running");
              } else if (eventData.name.includes("pip-generator")) {
                sendStatus("transcribe", "success");
                sendStatus("draft", "running");
              } else if (eventData.name.includes("docx-exporter")) {
                sendStatus("draft", "success");
                sendStatus("review", "success");
                sendStatus("export", "running");
              }

              if (eventData.name === "TodoWrite" && eventData.input && typeof eventData.input === "object") {
                const todos = (eventData.input as { todos?: unknown }).todos;
                if (Array.isArray(todos)) {
                  write("todo", { todos });
                }
              }
            }

            if (isToolResultEvent(eventData)) {
              const resultData = {
                name: (eventData as { name?: string }).name,
                isError: (eventData as { isError?: boolean }).isError,
                content: (eventData as { content?: unknown }).content
              };
              write("tool_result", resultData);

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
                  };
                  if (typeof parsed.transcript === "string") {
                    write("transcript_chunk", {
                      transcript: parsed.transcript.slice(0, 1500),
                      processedChunks: parsed.processedChunks ?? 0,
                      totalChunks: parsed.totalChunks ?? 0
                    });
                  }
                } catch {
                  // Ignore non-JSON payloads
                }
              }

              if (resultData.isError) {
                write("error", {
                  message: "Tool error",
                  details: toSerializableError(resultData.content)
                });
              }
            }

            if (eventData && typeof eventData === "object") {
              const jsonFields = "delta" in eventData ? (eventData as { delta?: unknown }).delta : undefined;
              const maybeText = typeof jsonFields === "string"
                ? jsonFields
                : typeof (eventData as { content?: unknown }).content === "string"
                  ? ((eventData as { content?: unknown }).content as string)
                  : undefined;

              const candidate = maybeText && maybeText.trim().startsWith("{") ? maybeText : undefined;

              if (candidate) {
                try {
                  const verdict = JSON.parse(candidate) as {
                    approved?: boolean;
                    reasons?: string[];
                    required_changes?: string[];
                    revised_draft?: string | null;
                  };
                  if (typeof verdict.approved === "boolean") {
                    judgeRound += 1;
                    write("judge_round", {
                      approved: verdict.approved,
                      reasons: verdict.reasons ?? [],
                      required_changes: verdict.required_changes ?? [],
                      revised_draft: verdict.revised_draft ?? null,
                      round: judgeRound
                    });
                    sendStatus("review", verdict.approved ? "success" : "running", { round: judgeRound });
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
                // Strip markdown code fences (e.g., ```json ... ```) before parsing
                // This handles cases where the agent wraps JSON in markdown blocks
                const cleaned = rawResult.replace(/```json\s*|```/g, "").trim();
                try {
                  payload = JSON.parse(cleaned);
                } catch {
                  // leave as string
                }
              }

              if (payload && typeof payload === "object" && (payload as { status?: string }).status === "ok") {
                const draft = (payload as { draft?: string }).draft ?? "";
                const docx = (payload as { docx?: string }).docx ?? outputPath;
                sendStatus("export", "success");
                const docxRelative = path.relative(projectRoot, docx);
                write("final", { ok: true, draft, docx, docxRelative });
              } else {
                write("error", { message: "Pipeline failed", details: payload ?? rawResult });
              }
            } else {
              write("error", { message: "Run error", details: toSerializableError(message) });
            }
          }
        }
        } catch (workerError) {
          // Worker crashed - check if output was created anyway
          write("log", { level: "warn", message: "Worker process encountered an error, checking for output file..." });

          if (fs.existsSync(outputPath)) {
            const stats = fs.statSync(outputPath);
            if (stats.size > 1000) { // File exists and has content
              write("log", { level: "info", message: "Output file was created successfully despite worker error" });
              sendStatus("export", "success");
              const docxRelative = path.relative(projectRoot, outputPath);
              write("final", { ok: true, docx: outputPath, docxRelative, recovered: true });
              controller.close();
              return;
            }
          }

          // If no output file, report the error
          closeWithError(workerError);
          return;
        }
      } catch (error) {
        closeWithError(error);
        return;
      }

      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
