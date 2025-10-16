/**
 * Anthropic Service - Dependency Injection Wrapper for Anthropic SDK
 *
 * This service encapsulates all interactions with the Anthropic API,
 * making the codebase more testable and maintainable by allowing
 * dependencies to be injected rather than created inline.
 *
 * @example
 * ```typescript
 * const service = createAnthropicService(apiKey);
 * const response = await service.generateMessage({
 *   model: "claude-sonnet-4-5-20250929",
 *   maxTokens: 4096,
 *   temperature: 0.2,
 *   systemPrompt: "You are an HR specialist",
 *   userPrompt: "Draft a PIP..."
 * });
 * console.log(response.text, response.usage);
 * ```
 */

import Anthropic from "@anthropic-ai/sdk";
import type { TextBlock } from "@anthropic-ai/sdk/resources/messages";
import type { UsageMetrics } from "../types/index.js";

/**
 * Parameters for message generation
 */
export interface MessageParams {
  /** Model identifier (e.g., "claude-sonnet-4-5-20250929") */
  model: string;
  /** Maximum number of tokens to generate */
  maxTokens: number;
  /** Temperature for randomness (0-1) */
  temperature: number;
  /** System prompt to set behavior/context */
  systemPrompt: string;
  /** User prompt with the actual request */
  userPrompt: string;
  /** Optional extended thinking configuration */
  thinking?: {
    type: "enabled";
    budget_tokens: number;
  };
}

/**
 * Interface for Anthropic service operations
 *
 * This interface allows for easy mocking in tests:
 * ```typescript
 * const mockService: IAnthropicService = {
 *   generateMessage: async () => ({ text: "mock response" })
 * };
 * ```
 */
export interface IAnthropicService {
  /**
   * Generate a text message using Claude
   *
   * @param params - Message generation parameters
   * @returns The generated text content and usage metrics (if provided by API)
   * @throws Error if the API call fails or returns empty content
   */
  generateMessage(
    params: MessageParams
  ): Promise<{ text: string; usage?: UsageMetrics }>;
}

/**
 * Implementation of the Anthropic service
 *
 * Wraps the Anthropic SDK client and provides a clean interface
 * for message generation operations.
 */
export class AnthropicService implements IAnthropicService {
  private client: Anthropic;

  /**
   * Create a new Anthropic service instance
   *
   * @param apiKey - Anthropic API key for authentication
   */
  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Generate a text message using Claude
   *
   * @param params - Message generation parameters
   * @returns The generated text content (all text blocks joined) and usage metrics
   * @throws Error if the API call fails or returns empty content
   */
  async generateMessage(params: MessageParams): Promise<{ text: string; usage?: UsageMetrics }> {
    const requestParams: any = {
      model: params.model,
      max_tokens: params.maxTokens,
      temperature: params.temperature,
      system: params.systemPrompt,
      messages: [
        {
          role: "user",
          content: params.userPrompt
        }
      ]
    };

    // Add extended thinking if specified
    if (params.thinking) {
      requestParams.thinking = params.thinking;
    }

    const response = await this.client.messages.create(requestParams);

    // Extract and join all text blocks from the response
    // Note: Thinking tokens are automatically counted in usage.output_tokens
    const text = response.content
      .filter((block): block is TextBlock => block.type === "text")
      .map(block => block.text)
      .join("")
      .trim();

    if (!text) {
      throw new Error("Anthropic returned empty content");
    }

    return { text, usage: response.usage as UsageMetrics | undefined };
  }
}

/**
 * Factory function to create an Anthropic service instance
 *
 * This pattern allows for easy service creation while maintaining
 * the ability to swap implementations for testing.
 *
 * @param apiKey - Anthropic API key for authentication
 * @returns An instance of IAnthropicService
 *
 * @example
 * ```typescript
 * const service = createAnthropicService(process.env.ANTHROPIC_API_KEY!);
 * const { text: draft, usage } = await service.generateMessage({...});
 * ```
 */
export function createAnthropicService(apiKey: string): IAnthropicService {
  return new AnthropicService(apiKey);
}
