import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { AnthropicService, type MessageParams } from "../../src/services/AnthropicService.js";
import type { Message, TextBlock } from "@anthropic-ai/sdk/resources/messages";

// Mock Anthropic SDK
const mockAnthropicSDK = () => {
  const createMock = mock.fn(async () => ({
    content: [{ type: "text", text: "Test response" } as TextBlock],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0
    }
  } as Message));

  const streamMock = mock.fn(async () => {
    const handlers: Record<string, (delta: string) => void> = {};
    return {
      on: (event: string, handler: (delta: string) => void) => {
        handlers[event] = handler;
        if (event === "text") {
          // Simulate streaming chunks immediately
          handler("Test ");
          handler("streaming ");
          handler("response");
        }
      },
      finalMessage: async () => ({
        content: [{ type: "text", text: "Test streaming response" } as TextBlock],
        usage: {
          input_tokens: 100,
          output_tokens: 60,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0
        }
      } as Message)
    };
  });

  return {
    messages: {
      create: createMock,
      stream: streamMock
    }
  };
};

// Test 1: Service initialization with valid API key
test("AnthropicService - initializes with valid API key", () => {
  const service = new AnthropicService("test-api-key");
  assert.ok(service, "Service should be instantiated");
});

// Test 2: Service initialization with empty API key (should still create instance)
test("AnthropicService - initializes with empty API key", () => {
  const service = new AnthropicService("");
  assert.ok(service, "Service should be instantiated even with empty key");
});

// Test 3: generateMessage - successful response
test("AnthropicService - generateMessage returns text and usage", async () => {
  const service = new AnthropicService("test-api-key");

  // Mock the client
  (service as unknown as { client: unknown }).client = mockAnthropicSDK();

  const params: MessageParams = {
    model: "claude-sonnet-4-5-20250929",
    maxTokens: 4096,
    temperature: 0.2,
    systemPrompt: "You are a helpful assistant",
    userPrompt: "Hello, Claude!"
  };

  const result = await service.generateMessage(params);

  assert.equal(result.text, "Test response");
  assert.ok(result.usage, "Usage metrics should be present");
  assert.equal(result.usage?.input_tokens, 100);
  assert.equal(result.usage?.output_tokens, 50);
});

// Test 4: generateMessage - with thinking enabled
test("AnthropicService - generateMessage with extended thinking", async () => {
  const service = new AnthropicService("test-api-key");
  const mockSDK = mockAnthropicSDK();
  (service as unknown as { client: unknown }).client = mockSDK;

  const params: MessageParams = {
    model: "claude-sonnet-4-5-20250929",
    maxTokens: 4096,
    temperature: 0.2,
    systemPrompt: "You are a helpful assistant",
    userPrompt: "Solve this complex problem",
    thinking: {
      type: "enabled",
      budget_tokens: 2000
    }
  };

  const result = await service.generateMessage(params);

  assert.equal(result.text, "Test response");
  assert.ok(result.usage);
});

// Test 5: generateMessage - handles empty content error
test("AnthropicService - generateMessage throws on empty content", async () => {
  const service = new AnthropicService("test-api-key");

  // Mock SDK to return empty content
  const emptyMock = {
    messages: {
      create: mock.fn(async () => ({
        content: [],
        usage: { input_tokens: 10, output_tokens: 0 }
      } as Message))
    }
  };
  (service as unknown as { client: unknown }).client = emptyMock;

  const params: MessageParams = {
    model: "claude-sonnet-4-5-20250929",
    maxTokens: 4096,
    temperature: 0.2,
    systemPrompt: "System",
    userPrompt: "User"
  };

  await assert.rejects(
    async () => await service.generateMessage(params),
    { message: "Anthropic returned empty content" }
  );
});

// Test 6: generateMessage - handles non-text blocks
test("AnthropicService - generateMessage filters non-text blocks", async () => {
  const service = new AnthropicService("test-api-key");

  const mixedContentMock = {
    messages: {
      create: mock.fn(async () => ({
        content: [
          { type: "text", text: "First part " } as TextBlock,
          { type: "tool_use", id: "123", name: "test" },
          { type: "text", text: "Second part" } as TextBlock
        ],
        usage: { input_tokens: 50, output_tokens: 25 }
      } as Message))
    }
  };
  (service as unknown as { client: unknown }).client = mixedContentMock;

  const params: MessageParams = {
    model: "claude-sonnet-4-5-20250929",
    maxTokens: 4096,
    temperature: 0.2,
    systemPrompt: "System",
    userPrompt: "User"
  };

  const result = await service.generateMessage(params);
  assert.equal(result.text, "First part Second part");
});

// Test 7: generateMessage - handles API errors
test("AnthropicService - generateMessage propagates API errors", async () => {
  const service = new AnthropicService("test-api-key");

  const errorMock = {
    messages: {
      create: mock.fn(async () => {
        throw new Error("API rate limit exceeded");
      })
    }
  };
  (service as unknown as { client: unknown }).client = errorMock;

  const params: MessageParams = {
    model: "claude-sonnet-4-5-20250929",
    maxTokens: 4096,
    temperature: 0.2,
    systemPrompt: "System",
    userPrompt: "User"
  };

  await assert.rejects(
    async () => await service.generateMessage(params),
    { message: "API rate limit exceeded" }
  );
});

// Test 8: generateMessageStream - successful streaming
test("AnthropicService - generateMessageStream streams deltas", async () => {
  const service = new AnthropicService("test-api-key");
  const mockSDK = mockAnthropicSDK();
  (service as unknown as { client: unknown }).client = mockSDK;

  const chunks: string[] = [];
  const onDelta = (chunk: string) => {
    chunks.push(chunk);
  };

  const params: MessageParams = {
    model: "claude-sonnet-4-5-20250929",
    maxTokens: 4096,
    temperature: 0.2,
    systemPrompt: "System",
    userPrompt: "User"
  };

  const result = await service.generateMessageStream(params, onDelta);

  assert.equal(result.text, "Test streaming response");
  assert.ok(result.usage);
  assert.equal(result.usage?.output_tokens, 60);
  assert.ok(chunks.length > 0, "Should have received streaming chunks");
});

// Test 9: generateMessageStream - handles callback errors gracefully
test("AnthropicService - generateMessageStream handles callback errors", async () => {
  const service = new AnthropicService("test-api-key");
  const mockSDK = mockAnthropicSDK();
  (service as unknown as { client: unknown }).client = mockSDK;

  const onDelta = () => {
    throw new Error("Callback error");
  };

  const params: MessageParams = {
    model: "claude-sonnet-4-5-20250929",
    maxTokens: 4096,
    temperature: 0.2,
    systemPrompt: "System",
    userPrompt: "User"
  };

  // Should not throw, just log warning and continue
  const result = await service.generateMessageStream(params, onDelta);
  assert.equal(result.text, "Test streaming response");
});

// Test 10: generateMessageStream - handles missing finalMessage
test("AnthropicService - generateMessageStream handles missing finalMessage", async () => {
  const service = new AnthropicService("test-api-key");

  const noFinalMessageMock = {
    messages: {
      stream: mock.fn(async () => ({
        on: (event: string, handler: (delta: string) => void) => {
          if (event === "text") {
            handler("Streamed ");
            handler("content");
          }
        }
        // No finalMessage method
      }))
    }
  };
  (service as unknown as { client: unknown }).client = noFinalMessageMock;

  const chunks: string[] = [];
  const params: MessageParams = {
    model: "claude-sonnet-4-5-20250929",
    maxTokens: 4096,
    temperature: 0.2,
    systemPrompt: "System",
    userPrompt: "User"
  };

  const result = await service.generateMessageStream(params, (chunk) => chunks.push(chunk));
  assert.equal(result.text, "Streamed content");
  assert.equal(result.usage, undefined);
});

// Test 11: generateMessageStream - uses finalResponse fallback
test("AnthropicService - generateMessageStream uses finalResponse fallback", async () => {
  const service = new AnthropicService("test-api-key");

  const finalResponseMock = {
    messages: {
      stream: mock.fn(async () => ({
        on: () => {},
        finalResponse: async () => ({
          content: [{ type: "text", text: "Fallback response" } as TextBlock],
          usage: { input_tokens: 80, output_tokens: 40 }
        } as Message)
      }))
    }
  };
  (service as unknown as { client: unknown }).client = finalResponseMock;

  const params: MessageParams = {
    model: "claude-sonnet-4-5-20250929",
    maxTokens: 4096,
    temperature: 0.2,
    systemPrompt: "System",
    userPrompt: "User"
  };

  const result = await service.generateMessageStream(params, () => {});
  assert.equal(result.text, "Fallback response");
  assert.equal(result.usage?.input_tokens, 80);
});

// Test 12: generateMessageStream - with thinking enabled
test("AnthropicService - generateMessageStream with extended thinking", async () => {
  const service = new AnthropicService("test-api-key");
  const mockSDK = mockAnthropicSDK();
  (service as unknown as { client: unknown }).client = mockSDK;

  const params: MessageParams = {
    model: "claude-sonnet-4-5-20250929",
    maxTokens: 4096,
    temperature: 0.2,
    systemPrompt: "System",
    userPrompt: "Complex problem",
    thinking: {
      type: "enabled",
      budget_tokens: 1500
    }
  };

  const result = await service.generateMessageStream(params, () => {});
  assert.ok(result.text);
  assert.ok(result.usage);
});

// Test 13: generateMessage - trims whitespace from response
test("AnthropicService - generateMessage trims whitespace", async () => {
  const service = new AnthropicService("test-api-key");

  const whitespaceMock = {
    messages: {
      create: mock.fn(async () => ({
        content: [{ type: "text", text: "  \n\n  Response with whitespace  \n\n  " } as TextBlock],
        usage: { input_tokens: 10, output_tokens: 10 }
      } as Message))
    }
  };
  (service as unknown as { client: unknown }).client = whitespaceMock;

  const params: MessageParams = {
    model: "claude-sonnet-4-5-20250929",
    maxTokens: 4096,
    temperature: 0.2,
    systemPrompt: "System",
    userPrompt: "User"
  };

  const result = await service.generateMessage(params);
  assert.equal(result.text, "Response with whitespace");
});

// Test 14: Token usage tracking - verifies all usage fields
test("AnthropicService - tracks all usage metrics correctly", async () => {
  const service = new AnthropicService("test-api-key");

  const fullUsageMock = {
    messages: {
      create: mock.fn(async () => ({
        content: [{ type: "text", text: "Response" } as TextBlock],
        usage: {
          input_tokens: 150,
          output_tokens: 75,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30
        }
      } as Message))
    }
  };
  (service as unknown as { client: unknown }).client = fullUsageMock;

  const params: MessageParams = {
    model: "claude-sonnet-4-5-20250929",
    maxTokens: 4096,
    temperature: 0.2,
    systemPrompt: "System with cache",
    userPrompt: "User query"
  };

  const result = await service.generateMessage(params);
  assert.equal(result.usage?.input_tokens, 150);
  assert.equal(result.usage?.output_tokens, 75);
  assert.equal(result.usage?.cache_creation_input_tokens, 20);
  assert.equal(result.usage?.cache_read_input_tokens, 30);
});

// Test 15: Multiple text blocks - concatenates correctly
test("AnthropicService - concatenates multiple text blocks", async () => {
  const service = new AnthropicService("test-api-key");

  const multiBlockMock = {
    messages: {
      create: mock.fn(async () => ({
        content: [
          { type: "text", text: "Part 1. " } as TextBlock,
          { type: "text", text: "Part 2. " } as TextBlock,
          { type: "text", text: "Part 3." } as TextBlock
        ],
        usage: { input_tokens: 50, output_tokens: 25 }
      } as Message))
    }
  };
  (service as unknown as { client: unknown }).client = multiBlockMock;

  const params: MessageParams = {
    model: "claude-sonnet-4-5-20250929",
    maxTokens: 4096,
    temperature: 0.2,
    systemPrompt: "System",
    userPrompt: "User"
  };

  const result = await service.generateMessage(params);
  assert.equal(result.text, "Part 1. Part 2. Part 3.");
});
