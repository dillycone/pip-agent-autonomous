import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import * as path from "node:path";
import { sanitizeError } from "../utils/sanitize.js";
import { mcpError } from "../utils/safe-stringify.js";
import { mcpSuccess } from "../utils/mcp-helpers.js";
import { PIPGenerationError, ConfigurationError } from "../errors/index.js";
import {
  ANTHROPIC_API_KEY,
  GEMINI_API_KEY,
  PIP_PROMPT_PATH,
  PIP_TEMPERATURE,
  PIP_MAX_OUTPUT_TOKENS,
  PIP_DRAFT_MODEL,
  PIP_THINKING_BUDGET,
  getValidatedThinkingBudget,
  ENABLE_DRAFT_STREAMING
} from "../config.js";
import {
  IAnthropicService,
  IFileSystemService,
  IGeminiService,
  createAnthropicService,
  createFileSystemService,
  createGeminiService
} from "../services/index.js";
import type { UsageMetrics } from "../types/index.js";
import { createChildLogger } from "../utils/logger.js";
import { getDraftStreamContext, emitDraftStreamEvent } from "../pipeline/draftStreamContext.js";

const logger = createChildLogger("pip-generator");

async function generateDraft(
  params: {
    transcript: string;
    outputLanguage: string;
    promptPath: string;
    model: string;
    temperature: number;
    maxOutputTokens: number;
    thinkingBudget: number;
  },
  anthropicService: IAnthropicService | null,
  geminiService: IGeminiService | null,
  fsService: IFileSystemService
): Promise<{ draft: string; usage?: UsageMetrics; model: string }> {
  const promptPathResolved = path.resolve(params.promptPath);
  const promptRaw = await fsService.readFile(promptPathResolved, "utf-8") as string;
  const draftStreamContext = getDraftStreamContext();
  const streamingEnabled = Boolean(ENABLE_DRAFT_STREAMING && draftStreamContext?.streamingEnabled);

  // Validate transcript is not empty or too short
  if (!params.transcript || params.transcript.trim().length < 50) {
    throw new PIPGenerationError(
      "Transcript is too short or empty. Ensure transcription completed successfully.",
      { transcriptLength: params.transcript?.length ?? 0 }
    );
  }

  const transcriptLength = params.transcript.length;
  const transcriptWordCount = params.transcript.split(/\s+/).length;

  // Validate and clamp thinking budget
  const validatedThinkingBudget = getValidatedThinkingBudget(params.model, params.thinkingBudget);

  try {
    logger.info(
      { transcriptLength, transcriptWordCount, model: params.model, thinkingBudget: validatedThinkingBudget },
      `📝 Generating PIP draft from transcript (${transcriptLength} chars, ~${transcriptWordCount} words) with thinking budget ${validatedThinkingBudget}`
    );
  } catch (err) {
    // Fallback to basic logging if structured logging fails
    try {
      logger.info(
        { transcriptLength, transcriptWordCount, model: params.model, fallback: true },
        `Generating PIP draft from transcript`
      );
    } catch {
      // Last resort: no-op to prevent crashes
      // Structured logging failed entirely, skip this log entry
    }
  }

  const sanitizedTranscript = params.transcript.replace(/<END_TRANSCRIPT>/g, "<END_TRANSCRIPT_ESCAPED>");
  const filledPrompt = promptRaw.split("{request.transcript}").join(sanitizedTranscript);

  const systemPrompt = `You are an HR specialist analyzing a meeting transcript. Extract only the performance issues that are explicitly discussed in the transcript. Follow the format instructions exactly. Do not add information not present in the transcript. Output in ${params.outputLanguage}.`;

  // Detect model family and route to appropriate service
  const isGemini = params.model.toLowerCase().includes("gemini");

  if (isGemini) {
    // Streaming previews are not yet supported for Gemini models; fall back to single response
    // Use Gemini service
    if (!geminiService) {
      throw new ConfigurationError("Gemini service not available. Missing GEMINI_API_KEY?");
    }

    const result = await geminiService.generateText({
      model: params.model,
      prompt: filledPrompt,
      systemInstruction: systemPrompt,
      config: {
        temperature: params.temperature,
        maxOutputTokens: params.maxOutputTokens,
        thinkingConfig: validatedThinkingBudget > 0 ? {
          thinkingBudget: validatedThinkingBudget
        } : undefined
      }
    });

    if (!result.text) {
      throw new PIPGenerationError("Gemini returned an empty draft.");
    }

    // Convert Gemini usage to UsageMetrics format
    const usage: UsageMetrics | undefined = result.usage ? {
      input_tokens: (result.usage.promptTokenCount as number) ?? 0,
      output_tokens: (result.usage.candidatesTokenCount as number) ?? 0,
      provider: "gemini",
      model: params.model
    } as UsageMetrics : undefined;

    return { draft: result.text, usage, model: params.model };
  } else {
    // Use Anthropic service (Claude models)
    if (!anthropicService) {
      throw new ConfigurationError("Anthropic service not available. Missing ANTHROPIC_API_KEY?");
    }

    if (streamingEnabled) {
      let sequence = 0;
      let accumulator = "";
      emitDraftStreamEvent("reset", { at: new Date().toISOString() });

      const { text, usage } = await anthropicService.generateMessageStream({
        model: params.model,
        maxTokens: params.maxOutputTokens,
        temperature: params.temperature,
        systemPrompt,
        userPrompt: filledPrompt,
        thinking: validatedThinkingBudget > 0 ? {
          type: "enabled",
          budget_tokens: validatedThinkingBudget
        } : undefined
      }, (chunk) => {
        if (!chunk) return;
        sequence += 1;
        accumulator += chunk;
        emitDraftStreamEvent("delta", {
          text: chunk,
          seq: sequence,
          length: accumulator.length,
          at: new Date().toISOString()
        });
      });

      emitDraftStreamEvent("complete", {
        at: new Date().toISOString(),
        total: accumulator.length,
        chunks: sequence
      });

      if (!text) {
        throw new PIPGenerationError("Claude returned an empty draft.");
      }

      const normalizedUsage: UsageMetrics | undefined = usage
        ? {
            ...usage,
            provider: usage.provider ?? "claude",
            model: params.model
          }
        : undefined;

      return { draft: text, usage: normalizedUsage, model: params.model };
    }

    const { text, usage } = await anthropicService.generateMessage({
      model: params.model,
      maxTokens: params.maxOutputTokens,
      temperature: params.temperature,
      systemPrompt: systemPrompt,
      userPrompt: filledPrompt,
      thinking: validatedThinkingBudget > 0 ? {
        type: "enabled",
        budget_tokens: validatedThinkingBudget
      } : undefined
    });

    if (!text) {
      throw new PIPGenerationError("Claude returned an empty draft.");
    }

    const normalizedUsage: UsageMetrics | undefined = usage
      ? {
          ...usage,
          provider: usage.provider ?? "claude",
          model: params.model
        }
      : undefined;

    return { draft: text, usage: normalizedUsage, model: params.model };
  }
}

// Create services once at module level for reuse
// This ensures we don't create new clients on every call
let anthropicService: IAnthropicService | null = null;
let geminiService: IGeminiService | null = null;
const fsService: IFileSystemService = createFileSystemService();

function getAnthropicService(): IAnthropicService | null {
  if (!ANTHROPIC_API_KEY) {
    return null;
  }
  if (!anthropicService) {
    anthropicService = createAnthropicService(ANTHROPIC_API_KEY);
  }
  return anthropicService;
}

function getGeminiService(): IGeminiService | null {
  if (!GEMINI_API_KEY) {
    return null;
  }
  if (!geminiService) {
    geminiService = createGeminiService(GEMINI_API_KEY);
  }
  return geminiService;
}

export const pipGenerator = createSdkMcpServer({
  name: "pip-generator",
  version: "0.1.0",
  tools: [
    tool(
      "draft_pip",
      "Generate a PIP draft from a transcript. Supports Claude Sonnet 4.5, Claude Haiku 4.5, and Gemini 2.5 Pro with extended thinking for deep reasoning.",
      {
        transcript: z.string().min(1, "Transcript is required."),
        outputLanguage: z.string().default("en"),
        promptPath: z.string().default(PIP_PROMPT_PATH),
        model: z.string().default(PIP_DRAFT_MODEL).describe("Model to use: claude-sonnet-4-5-20250929, claude-haiku-4-5-20251001, or gemini-2.5-pro"),
        temperature: z.number().min(0).max(2).default(PIP_TEMPERATURE),
        maxOutputTokens: z.number().min(512).max(8192).default(PIP_MAX_OUTPUT_TOKENS),
        thinkingBudget: z.number().min(0).max(128000).default(PIP_THINKING_BUDGET).describe("Thinking budget in tokens. Higher = better reasoning but more cost. Claude: 1024-128000, Gemini: 128-32768. Set 0 to disable.")
      },
      async ({ transcript, outputLanguage, promptPath, model, temperature, maxOutputTokens, thinkingBudget }) => {
        try {
          const anthropic = getAnthropicService();
          const gemini = getGeminiService();

          // Validate that we have the required API key for the selected model
          const isGemini = model.toLowerCase().includes("gemini");
          if (isGemini && !gemini) {
            throw new ConfigurationError("Gemini model selected but GEMINI_API_KEY is not configured.");
          }
          if (!isGemini && !anthropic) {
            throw new ConfigurationError("Claude model selected but ANTHROPIC_API_KEY is not configured.");
          }

          const { draft, usage, model: resolvedModel } = await generateDraft(
            {
              transcript,
              outputLanguage,
              promptPath,
              model,
              temperature,
              maxOutputTokens,
              thinkingBudget
            },
            anthropic,
            gemini,
            fsService
          );
          return mcpSuccess({ draft, usage, model: resolvedModel });
        } catch (error: unknown) {
          // Check for custom errors first
          if (error instanceof PIPGenerationError || error instanceof ConfigurationError) {
            return mcpError(error.message, error.metadata);
          }

          // Wrap other errors in PIPGenerationError
          const sanitized = sanitizeError(error);
          const context = {
            model,
            promptPath,
            outputLanguage,
            temperature,
            maxOutputTokens,
            thinkingBudget
          };
          return mcpError(sanitized.message, { ...sanitized, context });
        }
      }
    )
  ]
});
