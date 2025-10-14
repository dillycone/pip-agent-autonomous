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
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { geminiTranscriber } from "./mcp/geminiTranscriber.js";
import { docxExporter } from "./mcp/docxExporter.js";
import { pipGenerator } from "./mcp/pipGenerator.js";
import { makePolicyJudgeAgent } from "./agents/policyJudge.js";
import { sanitizeError, sanitizeForLogging } from "./utils/sanitize.js";
import { safeStringify } from "./utils/safe-stringify.js";
import { logger } from "./utils/logger.js";
import { handleError } from "./errors/ErrorHandler.js";
import { ConfigurationError } from "./errors/index.js";
import {
  validateFilePath,
  validateOutputPath,
  PathValidationError,
  type ValidationResult
} from "./utils/validation.js";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  MODELS,
  MAX_REVIEW_ROUNDS,
  MAX_TURNS,
  PRICING,
  GUIDELINES_PATH,
  ALLOWED_AUDIO_EXTENSIONS,
  ALLOWED_TEMPLATE_EXTENSIONS,
  ALLOWED_OUTPUT_EXTENSIONS,
  validateRequiredConfig,
  parseCliArgs,
  getConfigValue
} from "./config.js";
import type {
  MessageWithUsage,
  CostBreakdown,
  CostSummary,
  PipelineResult,
  StreamEventData
} from "./types/index.js";
import {
  hasUsage,
  isPipelineSuccess,
  isPipelineError,
  isStreamEvent,
  isSystemMessage,
  isToolUseEvent,
  isToolResultEvent
} from "./types/index.js";

// Ensure long-running MCP tool calls (Gemini transcription, Claude drafting) have ample time.
// The Anthropic SDK reads this value when handling MCP requests.
if (!process.env.MCP_REQUEST_TIMEOUT_MS) {
  process.env.MCP_REQUEST_TIMEOUT_MS = String(10 * 60 * 1000); // 10 minutes default for long-running MCP calls
}

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

// --- Cost Tracking Class ---
class CostTracker {
  private processedMessageIds = new Set<string>();
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCacheCreationTokens = 0;
  private totalCacheReadTokens = 0;

  processMessage(message: MessageWithUsage) {
    // Only process each message ID once
    const messageId = message.id || message.messageId;
    if (messageId && this.processedMessageIds.has(messageId)) {
      return;
    }
    if (messageId) {
      this.processedMessageIds.add(messageId);
    }

    const usage = message.usage;
    if (usage) {
      this.totalInputTokens += usage.input_tokens || 0;
      this.totalOutputTokens += usage.output_tokens || 0;
      this.totalCacheCreationTokens += usage.cache_creation_input_tokens || 0;
      this.totalCacheReadTokens += usage.cache_read_input_tokens || 0;
    }
  }

  getCost(): CostSummary {
    const inputCost = (this.totalInputTokens / 1_000_000) * PRICING.INPUT_PER_MTK;
    const outputCost = (this.totalOutputTokens / 1_000_000) * PRICING.OUTPUT_PER_MTK;
    const cacheCreationCost = (this.totalCacheCreationTokens / 1_000_000) * PRICING.CACHE_CREATION_PER_MTK;
    const cacheReadCost = (this.totalCacheReadTokens / 1_000_000) * PRICING.CACHE_READ_PER_MTK;

    const totalCost = inputCost + outputCost + cacheCreationCost + cacheReadCost;
    const totalTokens = this.totalInputTokens + this.totalOutputTokens +
                       this.totalCacheCreationTokens + this.totalCacheReadTokens;

    return {
      totalTokens,
      estimatedCostUSD: totalCost,
      breakdown: {
        inputTokens: this.totalInputTokens,
        outputTokens: this.totalOutputTokens,
        cacheCreationTokens: this.totalCacheCreationTokens,
        cacheReadTokens: this.totalCacheReadTokens,
        inputCost: inputCost.toFixed(4),
        outputCost: outputCost.toFixed(4),
        cacheCreationCost: cacheCreationCost.toFixed(4),
        cacheReadCost: cacheReadCost.toFixed(4)
      }
    };
  }

  printSummary() {
    const cost = this.getCost();
    logger.info({
      totalTokens: cost.totalTokens,
      inputTokens: cost.breakdown.inputTokens,
      outputTokens: cost.breakdown.outputTokens,
      cacheCreationTokens: cost.breakdown.cacheCreationTokens,
      cacheReadTokens: cost.breakdown.cacheReadTokens,
      estimatedCostUSD: cost.estimatedCostUSD
    }, "📊 Cost Summary");
    logger.info(`  Total Tokens: ${cost.totalTokens.toLocaleString()}`);
    logger.info(`  Input Tokens: ${cost.breakdown.inputTokens.toLocaleString()}`);
    logger.info(`  Output Tokens: ${cost.breakdown.outputTokens.toLocaleString()}`);
    logger.info(`  Cache Creation: ${cost.breakdown.cacheCreationTokens.toLocaleString()}`);
    logger.info(`  Cache Read: ${cost.breakdown.cacheReadTokens.toLocaleString()}`);
    logger.info(`  Estimated Cost: $${cost.estimatedCostUSD.toFixed(4)}`);
  }
}

// --- Todo Tracking ---
interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
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
  allowAbsolute: true
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
    allowAbsolute: true
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
  allowOverwrite: true
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

const guidelinesText = fs.readFileSync(GUIDELINES_PATH, "utf-8");
const judgeAgent = makePolicyJudgeAgent(guidelinesText, outputLanguage);

function buildPipelinePrompt() {
  const transcriptionArgs = {
    audioPath,
    inputLanguage,
    outputLanguage,
    diarize: true,
    timestamps: true
  };
  const transcriptionArgsExample = {
    ...transcriptionArgs,
    startChunk: 0
  };
  const pipDraftArgs = {
    transcript: "<REPLACE_WITH_TRANSCRIPT>",
    outputLanguage
  };
  const docxArgs = {
    templatePath: templateSanitizedPath,
    outputPath,
    language: outputLanguage,
    title: "Performance Improvement Plan",
    body: "<REPLACE_WITH_APPROVED_DRAFT>"
  };

  const instructions = [
    "You are an autonomous pipeline operator. Use the available MCP tools to complete the PIP workflow.",
    "TOOLS:",
    "- mcp__gemini-transcriber__transcribe_audio → transcribe audio meeting recordings.",
    "- mcp__pip-generator__draft_pip → create a draft PIP from a transcript.",
    "- mcp__docx-exporter__render_docx → produce the final DOCX file.",
    "STEPS:",
    `1. Initialize CURRENT_CHUNK=0 and TRANSCRIPTS=[] (strings). Call the transcription tool with the following JSON arguments (include "startChunk": CURRENT_CHUNK):
${JSON.stringify(transcriptionArgsExample, null, 2)}
   After each successful call (response.ok === true), append any non-empty response.transcript to TRANSCRIPTS and merge response.segments into an aggregate SEGMENTS list. If response.nextChunk is a number, set CURRENT_CHUNK to that value and call the tool again with startChunk=CURRENT_CHUNK. Repeat until nextChunk is null or undefined. If any call returns ok !== true, immediately respond with {"status":"error","message":<tool-error>}. Once finished, join TRANSCRIPTS with two newlines, trim whitespace, and set TRANSCRIPT to that string (ensure it is non-empty).`,
    `2. Call the PIP generator tool with JSON arguments matching:\n${JSON.stringify(pipDraftArgs, null, 2)}\n   Replace the placeholder value with TRANSCRIPT. Expect JSON { ok: true, draft }. On failure, return {\"status\":\"error\",\"message\":<tool-error>}. Set CURRENT_DRAFT to draft.trim().`,
    `3. Send CURRENT_DRAFT to the subagent "policy-judge" for review. If the verdict approved=false, apply required_changes (and revised_draft if provided) to produce a new CURRENT_DRAFT. Repeat the judge loop until approved=true or you reach ${MAX_REVIEW_ROUNDS} review rounds. Do not call pip-generator again during revisions. If you cannot secure approval, return {\"status\":\"error\",\"message\":\"Unable to obtain approval\"}.`,
    `4. When approved=true, set APPROVED_DRAFT to the final CURRENT_DRAFT.`,
    `5. Call the docx exporter tool with arguments:\n${JSON.stringify(docxArgs, null, 2)}\n   Replace the body placeholder with APPROVED_DRAFT. If the tool response JSON has ok !== true, return {\"status\":\"error\",\"message\":<tool-error>}.`,
    `6. After successful DOCX export, respond with JSON {\"status\":\"ok\",\"draft\":APPROVED_DRAFT,\"docx\":\"${outputPath}\"}. Do NOT include markdown fences or extra commentary.`,
    "If any unexpected failure occurs, respond with {\"status\":\"error\",\"message\":<description>}."
  ].join("\n\n");

  return instructions;
}

// --- Build prompt (string format for compatibility) ---
// Note: While streaming input with async generators is ideal,
// we use string format here for TypeScript type compatibility with SDK 0.1.14

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

  const costTracker = new CostTracker();
  const todoTracker = new TodoTracker();
  let sessionId: string | undefined;

  const q = query({
    prompt: buildPipelinePrompt(),
    options: {
      model: MODELS.CLAUDE_SONNET,
      agents: { "policy-judge": judgeAgent },
      mcpServers: MCP_SERVERS,
      allowedTools: ALLOWED_TOOLS,
      permissionMode: "bypassPermissions",
      maxTurns: MAX_TURNS
    }
  });

  let finalJson: string | null = null;

  for await (const m of q) {
    // Process all messages for cost tracking
    if (hasUsage(m)) {
      costTracker.processMessage(m);
    }

    // Capture session ID for potential resumption (in system messages)
    if (isSystemMessage(m) && "sessionId" in m) {
      sessionId = (m as SDKMessage & { sessionId?: string }).sessionId;
      logger.info({ sessionId }, `📝 Session ID: ${sessionId}`);
    }

    // Track todos from stream events
    if (isStreamEvent(m)) {
      const eventData = m.event as unknown as StreamEventData;
      const eventType = eventData?.type;

      // Handle tool use events
      if (isToolUseEvent(eventData)) {
        logger.debug({ toolName: eventData.name, toolInput: eventData.input }, `🔧 Tool: ${eventData.name}`);

        // Track TodoWrite specifically
        if (eventData.name === "TodoWrite" && typeof eventData.input === "object" && eventData.input !== null) {
          const todos = (eventData.input as { todos?: unknown }).todos;
          if (Array.isArray(todos)) {
            todoTracker.update(todos);
          }
        }
      }

      // Handle tool result errors
      if (isToolResultEvent(eventData) && eventData.isError) {
        const sanitizedContent = sanitizeForLogging(eventData.content);
        logger.warn({ toolName: eventData.name, error: sanitizedContent }, `  ⚠️  Tool ${eventData.name} returned error`);
        logger.warn(`     ${safeStringify(sanitizedContent, 200)}`);
        const rawText = Array.isArray(eventData.content)
          ? eventData.content.find(part => typeof part?.text === "string")?.text
          : typeof eventData.content === "string"
            ? eventData.content
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
            // Ignore JSON parse failures; already logged sanitized payload
          }
        }
      }
    }

    // Log assistant messages
    if (m.type === "assistant") {
      const assistantMsg = m as SDKMessage & { text?: string };
      const text = assistantMsg.text;
      if (text) {
        // Only log non-JSON responses (final JSON is handled separately)
        if (!text.trim().startsWith("{")) {
          logger.debug(`💭 ${text}`);
        }
      }
    }

    // Handle final result
    if (m.type === "result") {
      if (m.subtype === "success") {
        finalJson = m.result;
      } else {
        logger.error({ error: sanitizeForLogging(m) }, "❌ Run error");
        logger.error(safeStringify(sanitizeForLogging(m)));
        costTracker.printSummary();
        process.exit(1);
      }
    }
  }

  // Print cost summary
  costTracker.printSummary();

  if (!finalJson) {
    logger.error("❌ Agent did not return a result.");
    process.exit(1);
  }

  let parsed: unknown = finalJson;
  if (typeof finalJson === "string") {
    try {
      parsed = JSON.parse(finalJson);
    } catch {
      logger.error({ result: sanitizeForLogging(finalJson) }, "❌ Agent returned non-JSON result");
      logger.error(safeStringify(sanitizeForLogging(finalJson)));
      process.exit(1);
    }
  }

  // Validate the parsed result with proper type guards
  if (!isPipelineSuccess(parsed)) {
    logger.error({ parsed: sanitizeForLogging(parsed) }, "❌ Agent reported failure");
    logger.error(safeStringify(sanitizeForLogging(parsed)));
    process.exit(1);
  }

  const draftBody = parsed.draft.trim();
  logger.info({ draftLength: draftBody.length }, "✅ Pipeline completed successfully!");
  logger.info(`   Draft length: ${draftBody.length} characters`);

  if (!fs.existsSync(outputPath)) {
    logger.warn({ outputPath }, "⚠️  Warning: expected output docx not found at", outputPath);
  } else {
    logger.info({ outputPath: path.resolve(outputPath) }, `   DOCX written to: ${path.resolve(outputPath)}`);
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
