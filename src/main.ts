/**
 * PIP Agent (Gemini 2.5 Pro + Claude Sonnet 4.5) — Autonomous
 *
 * An autonomous pipeline that processes HR performance improvement plans:
 *
 * Pipeline Flow:
 * 1. Audio Transcription - Uses Gemini 2.5 Pro to transcribe HRBP-Manager meetings
 *    with input/output language control, diarization, and timestamps
 *
 * 2. PIP Draft Generation - Uses Claude Sonnet 4.5 with custom prompts to draft
 *    a Performance Improvement Plan from the transcript
 *
 * 3. Policy Review - A Claude Sonnet 4.5 judge subagent reviews the draft against
 *    organizational guardrails and policies. Can iterate up to MAX_REVIEW_ROUNDS
 *    for approval
 *
 * 4. DOCX Export - Renders the approved draft to a Word document using either
 *    a provided template or auto-generated formatting
 *
 * Features:
 * - Multi-language support for transcription and output
 * - Autonomous operation with permission bypass for specified tools
 * - Cost tracking with detailed token usage and pricing breakdown
 * - Session management for resuming failed runs
 * - Real-time progress tracking with todo lists
 * - Comprehensive error handling and input validation
 * - Security-first design with path validation and sanitization
 *
 * Models:
 * - Agent SDK: claude-sonnet-4-5-20250929
 * - Judge: claude-sonnet-4-5-20250929
 * - Transcription: gemini-2.5-pro
 *
 * @author PIP Agent Team
 * @license MIT
 */

import "dotenv/config";
import { sanitizeForLogging } from "./utils/sanitize.js";
import { safeStringify } from "./utils/safe-stringify.js";
import { logger } from "./utils/logger.js";
import { handleError } from "./errors/ErrorHandler.js";
import { ConfigurationError } from "./errors/index.js";
import {
  validateFilePath,
  validateOutputPath,
  type ValidationResult
} from "./utils/validation.js";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  MODELS,
  GUIDELINES_PATH,
  ALLOWED_AUDIO_EXTENSIONS,
  ALLOWED_TEMPLATE_EXTENSIONS,
  ALLOWED_OUTPUT_EXTENSIONS,
  PIP_PROMPT_PATH,
  validateRequiredConfig,
  parseCliArgs,
  getConfigValue
} from "./config.js";
import { PROJECT_ROOT } from "./utils/paths.js";
import { runPipeline } from "./pipeline/runPipeline.js";
import type { PipelineHandlers } from "./pipeline/runPipeline.js";
import type { RunStatus } from "./server/runStore.js";

// Ensure long-running MCP tool calls (Gemini transcription, Claude drafting) have ample time.
// The Anthropic SDK reads this value when handling MCP requests.
if (!process.env.MCP_REQUEST_TIMEOUT_MS) {
  process.env.MCP_REQUEST_TIMEOUT_MS = String(10 * 60 * 1000); // 10 minutes default for long-running MCP calls
}

import type { CostSummary } from "./types/index.js";
function logCostSummary(summary: CostSummary) {
  const geminiCost =
    summary.breakdown.geminiInputCostUSD + summary.breakdown.geminiOutputCostUSD;
  logger.info({
    totalTokens: summary.totalTokens,
    inputTokens: summary.breakdown.inputTokens,
    outputTokens: summary.breakdown.outputTokens,
    cacheCreationTokens: summary.breakdown.cacheCreationTokens,
    cacheReadTokens: summary.breakdown.cacheReadTokens,
    geminiInputTokens: summary.breakdown.geminiInputTokens,
    geminiOutputTokens: summary.breakdown.geminiOutputTokens,
    geminiInputCostUSD: summary.breakdown.geminiInputCostUSD,
    geminiOutputCostUSD: summary.breakdown.geminiOutputCostUSD,
    estimatedCostUSD: summary.estimatedCostUSD
  }, "📊 Cost Summary");
  logger.info(`  Total Tokens: ${summary.totalTokens.toLocaleString()}`);
  logger.info(`  Input Tokens: ${summary.breakdown.inputTokens.toLocaleString()}`);
  logger.info(`  Output Tokens: ${summary.breakdown.outputTokens.toLocaleString()}`);
  logger.info(`  Cache Creation: ${summary.breakdown.cacheCreationTokens.toLocaleString()}`);
  logger.info(`  Cache Read: ${summary.breakdown.cacheReadTokens.toLocaleString()}`);
  logger.info(`  Gemini Input Tokens: ${summary.breakdown.geminiInputTokens.toLocaleString()}`);
  logger.info(`  Gemini Output Tokens: ${summary.breakdown.geminiOutputTokens.toLocaleString()}`);
  logger.info(`  Gemini Cost: $${geminiCost.toFixed(4)}`);
  logger.info(`  Estimated Cost: $${summary.estimatedCostUSD.toFixed(4)}`);
}

function extractToolText(content: unknown): string | null {
  if (Array.isArray(content)) {
    const textPart = content.find(
      part =>
        typeof part === "object" &&
        part !== null &&
        typeof (part as { text?: unknown }).text === "string"
    ) as { text?: string } | undefined;
    return typeof textPart?.text === "string" ? textPart.text : null;
  }
  if (typeof content === "string") {
    return content;
  }
  return null;
}

function extractGeminiTokenUsage(content: unknown): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} | null {
  const rawText = extractToolText(content);
  if (!rawText) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawText);
    const usage = parsed?.tokenUsage;
    if (!usage || typeof usage !== "object") {
      return null;
    }

    const toNumber = (value: unknown): number | null => {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string" && value.trim() !== "") {
        const parsedValue = Number(value);
        return Number.isFinite(parsedValue) ? parsedValue : null;
      }
      return null;
    };

    const input =
      toNumber((usage as Record<string, unknown>).inputTokens) ??
      toNumber((usage as Record<string, unknown>).promptTokenCount) ??
      toNumber((usage as Record<string, unknown>).promptTokens);

    const output =
      toNumber((usage as Record<string, unknown>).outputTokens) ??
      toNumber((usage as Record<string, unknown>).candidatesTokenCount) ??
      toNumber((usage as Record<string, unknown>).candidatesTokens);

    const total =
      toNumber((usage as Record<string, unknown>).totalTokens) ??
      toNumber((usage as Record<string, unknown>).totalTokenCount);

    if (input === null && output === null && total === null) {
      return null;
    }

    const inputTokens = input ?? 0;
    const outputTokens = output ?? 0;
    const totalTokens = total ?? inputTokens + outputTokens;
    return { inputTokens, outputTokens, totalTokens };
  } catch {
    return null;
  }
}

function extractClaudeToolUsage(content: unknown): {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
} | null {
  const rawText = extractToolText(content);
  if (!rawText) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawText) as {
      usage?: {
        input_tokens?: unknown;
        inputTokens?: unknown;
        output_tokens?: unknown;
        outputTokens?: unknown;
        cache_creation_input_tokens?: unknown;
        cacheCreationInputTokens?: unknown;
        cache_read_input_tokens?: unknown;
        cacheReadInputTokens?: unknown;
      };
    } | null;

    if (!parsed || typeof parsed !== "object" || !parsed.usage || typeof parsed.usage !== "object") {
      return null;
    }

    const toNumber = (value: unknown): number | null => {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string" && value.trim() !== "") {
        const parsedValue = Number(value);
        return Number.isFinite(parsedValue) ? parsedValue : null;
      }
      return null;
    };

    const usage = parsed.usage;
    const inputTokens =
      toNumber(usage.input_tokens) ??
      toNumber((usage as Record<string, unknown>).inputTokens) ??
      0;
    const outputTokens =
      toNumber(usage.output_tokens) ??
      toNumber((usage as Record<string, unknown>).outputTokens) ??
      0;
    const cacheCreationTokens =
      toNumber(usage.cache_creation_input_tokens) ??
      toNumber((usage as Record<string, unknown>).cacheCreationInputTokens) ??
      0;
    const cacheReadTokens =
      toNumber(usage.cache_read_input_tokens) ??
      toNumber((usage as Record<string, unknown>).cacheReadInputTokens) ??
      0;

    if (
      inputTokens === 0 &&
      outputTokens === 0 &&
      cacheCreationTokens === 0 &&
      cacheReadTokens === 0
    ) {
      return null;
    }

    return {
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens
    };
  } catch {
    return null;
  }
}

// --- Cost Tracking Class ---

// --- Todo Tracking ---
interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

type FinalEventPayload = {
  ok?: boolean;
  draft?: string;
  docx?: string;
  docxRelative?: string;
};

function isFinalEventPayload(value: unknown): value is FinalEventPayload {
  return value !== null && typeof value === "object";
}

class TodoTracker {
  private todos: Todo[] = [];

  update(newTodos: Todo[]) {
    this.todos = newTodos;
    this.printProgress();
  }

  printProgress() {
    const completed = this.todos.filter(t => t.status === "completed").length;
    const inProgress = this.todos.filter(t => t.status === "in_progress");
    const total = this.todos.length;

    if (total === 0) return;

    logger.info({ completed, total, inProgressCount: inProgress.length }, `✓ Progress: ${completed}/${total} tasks completed`);
    if (inProgress.length > 0) {
      inProgress.forEach(todo => {
        logger.info(`  ⏳ ${todo.activeForm}`);
      });
    }
  }
}

// --- CLI args ---
const args = parseCliArgs();
const audioPath = getConfigValue(args, "audio", "AUDIO_PATH", "uploads/meeting.mp3");
const inputLanguage = getConfigValue(args, "in", "INPUT_LANGUAGE", "auto");
const outputLanguage = getConfigValue(args, "out", "OUTPUT_LANGUAGE", "en");
const templatePath = getConfigValue(args, "template", "TEMPLATE_PATH", "templates/pip-template.docx");
const outputPath = getConfigValue(args, "outdoc", "OUTPUT_PATH", `exports/pip-${Date.now()}.docx`);

// --- Input Validation (Security: Issue #11) ---
// Validate audio path
const audioValidation = validateFilePath(audioPath, {
  mustExist: true,
  mustBeFile: true,
  extensions: [...ALLOWED_AUDIO_EXTENSIONS] as string[],
  allowAbsolute: true,
  baseDir: PROJECT_ROOT
});

if (!audioValidation.valid) {
  logger.error({
    audioPath,
    error: audioValidation.error,
    hint: audioValidation.hint
  }, `❌ Audio path validation failed: ${audioValidation.error}`);
  if (audioValidation.hint) {
    logger.error(`   Hint: ${audioValidation.hint}`);
  }
  process.exit(1);
}

// Validate template path (if not default)
const userProvidedTemplate = args.has("template");
let templateValidation: ValidationResult = { valid: true };
if (userProvidedTemplate || fs.existsSync(templatePath)) {
  const result = validateFilePath(templatePath, {
    mustExist: true,
    mustBeFile: true,
    extensions: [...ALLOWED_TEMPLATE_EXTENSIONS] as string[],
    allowAbsolute: true,
    baseDir: PROJECT_ROOT
  });

  if (!result.valid) {
    logger.error({
      templatePath,
      error: result.error,
      hint: result.hint
    }, `❌ Template path validation failed: ${result.error}`);
    if (result.hint) {
      logger.error(`   Hint: ${result.hint}`);
    }
    process.exit(1);
  }

  templateValidation = result;
}

// Validate output path
const outputValidation = validateOutputPath(outputPath, {
  extensions: [...ALLOWED_OUTPUT_EXTENSIONS] as string[],
  allowOverwrite: true,
  allowAbsolute: true,
  baseDir: PROJECT_ROOT
});

if (!outputValidation.valid) {
  logger.error({
    outputPath,
    error: outputValidation.error,
    hint: outputValidation.hint
  }, `❌ Output path validation failed: ${outputValidation.error}`);
  if (outputValidation.hint) {
    logger.error(`   Hint: ${outputValidation.hint}`);
  }
  process.exit(1);
}

const templateSanitizedPath = templateValidation.sanitizedPath ?? templatePath;
const pathDebugContext: Record<string, unknown> = {
  audioPath: audioValidation.sanitizedPath,
  outputPath: outputValidation.sanitizedPath,
  templateProvided: userProvidedTemplate || fs.existsSync(templatePath)
};
if (templateValidation.sanitizedPath) {
  pathDebugContext.templatePath = templateValidation.sanitizedPath;
}
logger.debug(pathDebugContext, "✅ All file paths validated successfully");

async function run() {
  // Validate required configuration
  const validation = validateRequiredConfig();
  if (!validation.valid) {
    const configError = new ConfigurationError(
      `Configuration validation failed: ${validation.errors.join(", ")}`,
      { errors: validation.errors }
    );
    handleError(configError, "configuration validation");
    process.exit(1);
  }

  logger.info("🚀 Running autonomous PIP pipeline...");
  logger.info({ model: MODELS.CLAUDE_SONNET, audioPath, outputPath }, `   Model: ${MODELS.CLAUDE_SONNET}`);
  logger.info(`   Audio: ${audioPath}`);
  logger.info(`   Output: ${outputPath}`);

  const todoTracker = new TodoTracker();
  let sessionId: string | undefined;
  let latestCostSummary: CostSummary | null = null;
  let finalEvent: FinalEventPayload | null = null;
  let runStatus: RunStatus | null = null;
  let runError: unknown;

  const handlers: PipelineHandlers = {
    emit(event, data) {
      switch (event) {
        case "status": {
          const payload = data as { step?: string; status?: string; meta?: Record<string, unknown> };
          if (payload?.step && payload?.status) {
            logger.info({ step: payload.step, status: payload.status, meta: payload.meta }, `📍 ${payload.step} → ${payload.status}`);
          }
          break;
        }
        case "tool_use": {
          const payload = data as { name?: string; inputSummary?: unknown };
          if (payload?.name) {
            logger.debug({ toolName: payload.name, toolInput: payload.inputSummary }, `🔧 Tool: ${payload.name}`);
          }
          break;
        }
        case "tool_result": {
          const payload = data as {
            name?: string;
            isError?: boolean;
            content?: unknown;
          };
          if (!payload) break;
          if (payload.isError) {
            const sanitizedContent = sanitizeForLogging(payload.content);
            logger.warn({ toolName: payload.name, error: sanitizedContent }, `  ⚠️  Tool ${payload.name ?? "unknown"} returned error`);
            logger.warn(`     ${safeStringify(sanitizedContent, 200)}`);
            const rawText = Array.isArray(payload.content)
              ? payload.content.find((part: any) => typeof part?.text === "string")?.text
              : typeof payload.content === "string"
                ? payload.content
                : null;
            if (typeof rawText === "string") {
              try {
                const parsed = JSON.parse(rawText);
                const hint = typeof parsed?.hint === "string"
                  ? parsed.hint
                  : typeof parsed?.details?.hint === "string"
                    ? parsed.details.hint
                    : undefined;
                if (hint) {
                  logger.warn(`     Hint: ${hint}`);
                }
              } catch {
                // ignore
              }
            }
          } else if (payload.name === "mcp__gemini-transcriber__transcribe_audio") {
            const usage = extractGeminiTokenUsage(payload.content);
            if (usage) {
              logger.info({
                toolName: payload.name,
                geminiInputTokens: usage.inputTokens,
                geminiOutputTokens: usage.outputTokens,
                geminiTotalTokens: usage.totalTokens
              }, "🎧 Recorded Gemini transcription usage");
            }
          } else if (payload.name === "mcp__pip-generator__draft_pip") {
            const usage = extractClaudeToolUsage(payload.content);
            if (usage) {
              logger.info({
                toolName: payload.name,
                claudeInputTokens: usage.inputTokens,
                claudeOutputTokens: usage.outputTokens,
                claudeCacheCreationTokens: usage.cacheCreationTokens,
                claudeCacheReadTokens: usage.cacheReadTokens
              }, "🧮 Recorded Claude drafting usage");
            }
          }
          break;
        }
        case "todo": {
          const payload = data as { todos?: Todo[] };
          if (Array.isArray(payload?.todos)) {
            todoTracker.update(payload.todos as Todo[]);
          }
          break;
        }
        case "log": {
          const payload = data as { level?: string; message?: string };
          const level = payload?.level ?? "info";
          const message = payload?.message ?? "";
          if (level === "debug") {
            logger.debug(message);
          } else if (level === "warn") {
            logger.warn(message);
          } else if (level === "error") {
            logger.error(message);
          } else {
            logger.info(message);
          }
          if (message.startsWith("Session ")) {
            sessionId = message.replace("Session ", "").trim();
          }
          break;
        }
        case "judge_round": {
          const payload = data as { approved?: boolean; round?: number; reasons?: string[]; required_changes?: string[] };
          logger.info({
            round: payload?.round,
            approved: payload?.approved,
            reasons: payload?.reasons,
            requiredChanges: payload?.required_changes
          }, `⚖️  Judge round ${payload?.round ?? "?"}: ${payload?.approved ? "approved" : "changes required"}`);
          break;
        }
        case "cost": {
          const payload = data as { summary?: CostSummary };
          if (payload?.summary) {
            latestCostSummary = payload.summary;
          }
          break;
        }
        case "transcript_chunk": {
          const payload = data as { processedChunks?: number; totalChunks?: number };
          if (payload?.totalChunks) {
            logger.info({ processed: payload.processedChunks, total: payload.totalChunks }, "📝 Transcript progress");
          }
          break;
        }
        case "final": {
          finalEvent = data as FinalEventPayload;
          break;
        }
        case "error": {
          const payload = data as { message?: string; details?: unknown };
          logger.error({ details: sanitizeForLogging(payload?.details) }, payload?.message ?? "Pipeline error");
          break;
        }
        default:
          logger.debug({ event, data }, "Unhandled pipeline event");
      }
    },
    setRunStatus(status, error) {
      runStatus = status;
      if (status === "error" && error) {
        runError = error;
      }
    },
    finish(status, error) {
      runStatus = status;
      if (error) {
        runError = error;
      }
    }
  };

  await runPipeline({
    audioPath: audioValidation.sanitizedPath!,
    templatePath: templateSanitizedPath,
    outputPath: outputValidation.sanitizedPath!,
    promptPath: PIP_PROMPT_PATH,
    guidelinesPath: GUIDELINES_PATH,
    inputLanguage,
    outputLanguage,
    projectRoot: PROJECT_ROOT,
    handlers
  });

  if (latestCostSummary) {
    logCostSummary(latestCostSummary);
  } else {
    logger.warn("⚠️  Cost summary unavailable (no usage events reported).");
  }

  const finalData: FinalEventPayload | null = isFinalEventPayload(finalEvent) ? finalEvent : null;
  if (runStatus !== "success" || !finalData) {
    if (runError) {
      logger.error({ error: sanitizeForLogging(runError) }, "❌ Pipeline failed");
    } else {
      logger.error("❌ Pipeline failed without producing a final result.");
    }
    process.exit(1);
  }

  if ((finalData as FinalEventPayload).ok === false) {
    logger.error("❌ Pipeline reported failure in final payload.");
    process.exit(1);
  }

  const finalPayload = finalData as FinalEventPayload;
  const draftBody = (finalPayload.draft ?? "").trim();
  logger.info({ draftLength: draftBody.length }, "✅ Pipeline completed successfully!");
  logger.info(`   Draft length: ${draftBody.length} characters`);

  const resolvedDocx = finalPayload.docxRelative
    ? path.resolve(finalPayload.docxRelative)
    : finalPayload.docx
      ? path.resolve(finalPayload.docx)
      : path.resolve(outputValidation.sanitizedPath!);

  if (!fs.existsSync(resolvedDocx)) {
    logger.warn({ outputPath: resolvedDocx }, `⚠️  Warning: expected output docx not found at ${resolvedDocx}`);
  } else {
    logger.info({ outputPath: resolvedDocx }, `   DOCX written to: ${resolvedDocx}`);
  }

  // Save session ID for potential resumption
  if (sessionId) {
    logger.info({ sessionId }, `💾 To resume this session: Set RESUME_SESSION_ID=${sessionId}`);
  }
}

run().catch(err => {
  handleError(err, "pipeline execution");
  process.exit(1);
});
