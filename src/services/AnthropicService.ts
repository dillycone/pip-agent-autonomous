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
 * ```
 */

import Anthropic from "@anthropic-ai/sdk";
import type { TextBlock } from "@anthropic-ai/sdk/resources/messages";

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
}

/**
 * Interface for Anthropic service operations
 *
 * This interface allows for easy mocking in tests:
 * ```typescript
 * const mockService: IAnthropicService = {
 *   generateMessage: async () => "mock response"
 * };
 * ```
 */
export interface IAnthropicService {
  /**
   * Generate a text message using Claude
   *
   * @param params - Message generation parameters
   * @returns The generated text content
   * @throws Error if the API call fails or returns empty content
   */
  generateMessage(params: MessageParams): Promise<string>;
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
   * @returns The generated text content (all text blocks joined)
   * @throws Error if the API call fails or returns empty content
   */
  async generateMessage(params: MessageParams): Promise<string> {
    const response = await this.client.messages.create({
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
    });

    // Extract and join all text blocks from the response
    const text = response.content
      .filter((block): block is TextBlock => block.type === "text")
      .map(block => block.text)
      .join("")
      .trim();

    return text;
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
 * const draft = await service.generateMessage({...});
 * ```
 */
export function createAnthropicService(apiKey: string): IAnthropicService {
  return new AnthropicService(apiKey);
}
