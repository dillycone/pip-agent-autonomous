import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import * as path from "node:path";
import { sanitizeError } from "../utils/sanitize.js";
import { mcpError } from "../utils/safe-stringify.js";
import { mcpSuccess } from "../utils/mcp-helpers.js";
import { PIPGenerationError, ConfigurationError } from "../errors/index.js";
import {
  ANTHROPIC_API_KEY,
  MODELS,
  PIP_PROMPT_PATH,
  PIP_TEMPERATURE,
  PIP_MAX_OUTPUT_TOKENS
} from "../config.js";
import {
  IAnthropicService,
  IFileSystemService,
  createAnthropicService,
  createFileSystemService
} from "../services/index.js";


async function generateDraft(
  params: {
    transcript: string;
    outputLanguage: string;
    promptPath: string;
    model: string;
    temperature: number;
    maxOutputTokens: number;
  },
  anthropicService: IAnthropicService,
  fsService: IFileSystemService
) {
  const promptPathResolved = path.resolve(params.promptPath);
  const promptRaw = await fsService.readFile(promptPathResolved, "utf-8") as string;
  const sanitizedTranscript = params.transcript.replace(/<END_TRANSCRIPT>/g, "<END_TRANSCRIPT_ESCAPED>");
  const filledPrompt = promptRaw.split("{request.transcript}").join(sanitizedTranscript);

  const systemPrompt = `You are an HR specialist who drafts detailed, compliant Performance Improvement Plans in ${params.outputLanguage}.`;

  const text = await anthropicService.generateMessage({
    model: params.model,
    maxTokens: params.maxOutputTokens,
    temperature: params.temperature,
    systemPrompt: systemPrompt,
    userPrompt: filledPrompt
  });

  if (!text) {
    throw new PIPGenerationError("Claude returned an empty draft.");
  }
  return text;
}

// Create services once at module level for reuse
// This ensures we don't create new clients on every call
let anthropicService: IAnthropicService | null = null;
const fsService: IFileSystemService = createFileSystemService();

function getAnthropicService(): IAnthropicService {
  if (!ANTHROPIC_API_KEY) {
    throw new ConfigurationError("Missing ANTHROPIC_API_KEY for pip-generator tool.");
  }
  if (!anthropicService) {
    anthropicService = createAnthropicService(ANTHROPIC_API_KEY);
  }
  return anthropicService;
}

export const pipGenerator = createSdkMcpServer({
  name: "pip-generator",
  version: "0.1.0",
  tools: [
    tool(
      "draft_pip",
      "Generate a PIP draft from a transcript using the local drafting prompt and Claude model.",
      {
        transcript: z.string().min(1, "Transcript is required."),
        outputLanguage: z.string().default("en"),
        promptPath: z.string().default(PIP_PROMPT_PATH),
        model: z.string().default(MODELS.CLAUDE_PIP),
        temperature: z.number().min(0).max(1).default(PIP_TEMPERATURE),
        maxOutputTokens: z.number().min(512).max(8192).default(PIP_MAX_OUTPUT_TOKENS)
      },
      async ({ transcript, outputLanguage, promptPath, model, temperature, maxOutputTokens }) => {
        try {
          const anthropic = getAnthropicService();
          const draft = await generateDraft(
            {
              transcript,
              outputLanguage,
              promptPath,
              model,
              temperature,
              maxOutputTokens
            },
            anthropic,
            fsService
          );
          return mcpSuccess({ draft });
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
            maxOutputTokens
          };
          return mcpError(sanitized.message, { ...sanitized, context });
        }
      }
    )
  ]
});
