import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { Readable } from "node:stream";
import { GeminiService, type GenerateContentParams, type GenerateTextParams } from "../../src/services/GeminiService.js";

// Mock Google GenAI SDK
const mockGeminiSDK = () => {
  const uploadMock = mock.fn(async () => ({
    file: {
      uri: "https://generativelanguage.googleapis.com/v1beta/files/test-file-id",
      mimeType: "audio/mp3"
    }
  }));

  const generateContentMock = mock.fn(async (params: unknown) => {
    const text = "Test generated content";
    return {
      text,
      response: {
        text: () => text
      },
      usageMetadata: {
        inputTokenCount: 100,
        outputTokenCount: 50,
        totalTokenCount: 150
      }
    };
  });

  return {
    files: {
      upload: uploadMock
    },
    models: {
      generateContent: generateContentMock
    }
  };
};

// Test 1: Service initialization
test("GeminiService - initializes with valid API key", () => {
  const service = new GeminiService("test-api-key");
  assert.ok(service, "Service should be instantiated");
});

// Test 2: uploadFile - successful upload from file path
test("GeminiService - uploadFile uploads file successfully from path", async () => {
  const service = new GeminiService("test-api-key");

  // Mock the AI client
  const mockSDK = mockGeminiSDK();
  await (service as unknown as { ensureClient: () => Promise<unknown> }).ensureClient();
  (service as unknown as { ai: unknown }).ai = mockSDK;

  const result = await service.uploadFile("/path/to/audio.mp3", "audio/mp3");

  assert.ok(result.uri || result.fileUri, "Should have a file URI");
  assert.ok(result.mimeType || result.fileMimeType, "Should have a MIME type");
});

// Test 3: uploadFile - successful upload from Buffer
test("GeminiService - uploadFile uploads Buffer successfully", async () => {
  const service = new GeminiService("test-api-key");

  const mockSDK = mockGeminiSDK();
  await (service as unknown as { ensureClient: () => Promise<unknown> }).ensureClient();
  (service as unknown as { ai: unknown }).ai = mockSDK;

  const buffer = Buffer.from("test audio data");
  const result = await service.uploadFile(buffer, "audio/wav");

  assert.ok(result.uri || result.fileUri, "Should have a file URI");
});

// Test 4: uploadFile - successful upload from Readable stream
test("GeminiService - uploadFile uploads Readable stream successfully", async () => {
  const service = new GeminiService("test-api-key");

  const mockSDK = mockGeminiSDK();
  await (service as unknown as { ensureClient: () => Promise<unknown> }).ensureClient();
  (service as unknown as { ai: unknown }).ai = mockSDK;

  const stream = new Readable({
    read() {
      this.push("audio data");
      this.push(null);
    }
  });

  const result = await service.uploadFile(stream, "audio/mp3");

  assert.ok(result.uri || result.fileUri, "Should have a file URI");
});

// Test 5: uploadFile - handles missing URI in response
test("GeminiService - uploadFile throws on missing URI", async () => {
  const service = new GeminiService("test-api-key");

  const badResponseMock = {
    files: {
      upload: mock.fn(async () => ({
        file: {
          // Missing uri and fileUri
          mimeType: "audio/mp3"
        }
      }))
    },
    models: { generateContent: mock.fn() }
  };

  await (service as unknown as { ensureClient: () => Promise<unknown> }).ensureClient();
  (service as unknown as { ai: unknown }).ai = badResponseMock;

  await assert.rejects(
    async () => await service.uploadFile("/path/to/audio.mp3", "audio/mp3"),
    { message: /missing file URI/ }
  );
});

// Test 6: generateContent - successful content generation
test("GeminiService - generateContent generates content successfully", async () => {
  const service = new GeminiService("test-api-key");

  const mockSDK = mockGeminiSDK();
  await (service as unknown as { ensureClient: () => Promise<unknown> }).ensureClient();
  (service as unknown as { ai: unknown }).ai = mockSDK;

  const params: GenerateContentParams = {
    model: "gemini-2.5-pro",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: "Transcribe this audio",
            fileData: {
              fileUri: "https://generativelanguage.googleapis.com/v1beta/files/test-file-id",
              mimeType: "audio/mp3"
            }
          }
        ]
      }
    ],
    config: {
      responseMimeType: "application/json"
    }
  };

  const result = await service.generateContent(params);

  assert.ok(result.text || result.response?.text, "Should have text content");
  assert.ok(result.usageMetadata, "Should have usage metadata");
});

// Test 7: generateText - successful text generation
test("GeminiService - generateText generates text successfully", async () => {
  const service = new GeminiService("test-api-key");

  const mockSDK = mockGeminiSDK();
  await (service as unknown as { ensureClient: () => Promise<unknown> }).ensureClient();
  (service as unknown as { ai: unknown }).ai = mockSDK;

  const params: GenerateTextParams = {
    model: "gemini-2.5-pro",
    prompt: "Draft a PIP document",
    systemInstruction: "You are an HR specialist",
    config: {
      temperature: 0.7,
      maxOutputTokens: 2048
    }
  };

  const result = await service.generateText(params);

  assert.ok(result.text, "Should have generated text");
  assert.equal(result.text, "Test generated content");
  assert.ok(result.usage, "Should have usage metrics");
});

// Test 8: generateText - with thinking configuration
test("GeminiService - generateText with thinking configuration", async () => {
  const service = new GeminiService("test-api-key");

  const mockSDK = mockGeminiSDK();
  await (service as unknown as { ensureClient: () => Promise<unknown> }).ensureClient();
  (service as unknown as { ai: unknown }).ai = mockSDK;

  const params: GenerateTextParams = {
    model: "gemini-2.5-pro",
    prompt: "Solve complex problem",
    config: {
      thinkingConfig: {
        thinkingBudget: 2000
      }
    }
  };

  const result = await service.generateText(params);

  assert.ok(result.text, "Should have generated text");
});

// Test 9: generateText - throws on missing text
test("GeminiService - generateText throws when text extraction fails", async () => {
  const service = new GeminiService("test-api-key");

  const noTextMock = {
    files: { upload: mock.fn() },
    models: {
      generateContent: mock.fn(async () => ({
        // No text field and no response.text() method
        usageMetadata: { inputTokenCount: 10, outputTokenCount: 0 }
      }))
    }
  };

  await (service as unknown as { ensureClient: () => Promise<unknown> }).ensureClient();
  (service as unknown as { ai: unknown }).ai = noTextMock;

  const params: GenerateTextParams = {
    model: "gemini-2.5-pro",
    prompt: "Test prompt"
  };

  await assert.rejects(
    async () => await service.generateText(params),
    { message: "Failed to extract text from Gemini response" }
  );
});

// Test 10: generateText - handles API errors
test("GeminiService - generateText propagates API errors", async () => {
  const service = new GeminiService("test-api-key");

  const errorMock = {
    files: { upload: mock.fn() },
    models: {
      generateContent: mock.fn(async () => {
        throw new Error("API quota exceeded");
      })
    }
  };

  await (service as unknown as { ensureClient: () => Promise<unknown> }).ensureClient();
  (service as unknown as { ai: unknown }).ai = errorMock;

  const params: GenerateTextParams = {
    model: "gemini-2.5-pro",
    prompt: "Test prompt"
  };

  await assert.rejects(
    async () => await service.generateText(params),
    { message: "API quota exceeded" }
  );
});

// Test 11: uploadFile - handles upload errors
test("GeminiService - uploadFile propagates upload errors", async () => {
  const service = new GeminiService("test-api-key");

  const uploadErrorMock = {
    files: {
      upload: mock.fn(async () => {
        throw new Error("File too large");
      })
    },
    models: { generateContent: mock.fn() }
  };

  await (service as unknown as { ensureClient: () => Promise<unknown> }).ensureClient();
  (service as unknown as { ai: unknown }).ai = uploadErrorMock;

  await assert.rejects(
    async () => await service.uploadFile("/path/to/large-file.mp3", "audio/mp3"),
    { message: "File too large" }
  );
});

// Test 12: Usage metadata extraction - handles various formats
test("GeminiService - extracts usage metadata from various response formats", async () => {
  const service = new GeminiService("test-api-key");

  const usageVariantsMock = {
    files: { upload: mock.fn() },
    models: {
      generateContent: mock.fn(async () => ({
        text: "Response",
        response: {
          text: () => "Response",
          usageMetadata: {
            inputTokenCount: 200,
            outputTokenCount: 100,
            cachedContentTokenCount: 50
          }
        }
      }))
    }
  };

  await (service as unknown as { ensureClient: () => Promise<unknown> }).ensureClient();
  (service as unknown as { ai: unknown }).ai = usageVariantsMock;

  const params: GenerateTextParams = {
    model: "gemini-2.5-pro",
    prompt: "Test"
  };

  const result = await service.generateText(params);

  assert.ok(result.usage, "Should extract usage metadata");
  // Check that usage metadata is present (the actual normalization is done by usage-normalization.ts)
  const usage = result.usage as Record<string, unknown>;
  const hasInputTokens =
    usage.input_tokens !== undefined ||
    usage.inputTokenCount !== undefined ||
    usage.inputTokens !== undefined;
  assert.ok(hasInputTokens || Object.keys(usage).length > 0, "Should have token count fields");
});
