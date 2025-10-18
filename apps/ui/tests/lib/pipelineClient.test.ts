/**
 * Tests for PipelineClient
 *
 * Tests API communication, EventSource creation,
 * error handling, and response parsing
 */

import { PipelineClient, pipelineClient } from "../../lib/pipelineClient";
import { MockEventSource } from "../utils/testHelpers";

// Store original fetch
const originalFetch = global.fetch;

describe("PipelineClient", () => {
  let client: PipelineClient;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    client = new PipelineClient();
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe("Initialization", () => {
    it("should create a new PipelineClient instance", () => {
      expect(client).toBeInstanceOf(PipelineClient);
    });

    it("should have a default exported instance", () => {
      expect(pipelineClient).toBeInstanceOf(PipelineClient);
    });
  });

  describe("startRun", () => {
    it("should make POST request to /api/run with correct params", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ runId: "test-run-123" }),
      });

      const params = {
        audio: "test.mp3",
        template: "default",
        outdoc: "output.docx",
        inputLanguage: "en",
        outputLanguage: "es",
      };

      await client.startRun(params);

      expect(mockFetch).toHaveBeenCalledWith("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio: "test.mp3",
          template: "default",
          outdoc: "output.docx",
          inputLanguage: "en",
          outputLanguage: "es",
        }),
      });
    });

    it("should return success response with runId", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ runId: "test-run-123" }),
      });

      const result = await client.startRun({
        audio: "test.mp3",
        template: "default",
        outdoc: "output.docx",
        inputLanguage: "en",
        outputLanguage: "en",
      });

      expect(result).toEqual({
        success: true,
        runId: "test-run-123",
      });
    });

    it("should handle HTTP error response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: "Invalid parameters" }),
      });

      const result = await client.startRun({
        audio: "test.mp3",
        template: "default",
        outdoc: "output.docx",
        inputLanguage: "en",
        outputLanguage: "en",
      });

      expect(result).toEqual({
        success: false,
        error: "Invalid parameters",
        details: { error: "Invalid parameters" },
      });
    });

    it("should handle 500 server error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "Internal server error" }),
      });

      const result = await client.startRun({
        audio: "test.mp3",
        template: "default",
        outdoc: "output.docx",
        inputLanguage: "en",
        outputLanguage: "en",
      });

      expect(result).toEqual({
        success: false,
        error: "Internal server error",
        details: { error: "Internal server error" },
      });
    });

    it("should handle malformed JSON response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      const result = await client.startRun({
        audio: "test.mp3",
        template: "default",
        outdoc: "output.docx",
        inputLanguage: "en",
        outputLanguage: "en",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Run request failed");
    });

    it("should handle network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await client.startRun({
        audio: "test.mp3",
        template: "default",
        outdoc: "output.docx",
        inputLanguage: "en",
        outputLanguage: "en",
      });

      expect(result).toEqual({
        success: false,
        error: "Network error",
      });
    });

    it("should handle missing runId in response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }), // No runId
      });

      const result = await client.startRun({
        audio: "test.mp3",
        template: "default",
        outdoc: "output.docx",
        inputLanguage: "en",
        outputLanguage: "en",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Run request failed");
    });
  });

  describe("abortRun", () => {
    it("should make POST request to abort endpoint", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      await client.abortRun("test-run-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/run/test-run-123/abort",
        { method: "POST" }
      );
    });

    it("should encode runId in URL", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      await client.abortRun("test/run@123");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/run/test%2Frun%40123/abort",
        { method: "POST" }
      );
    });

    it("should return success on successful abort", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      const result = await client.abortRun("test-run-123");

      expect(result).toEqual({ success: true });
    });

    it("should handle abort error response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ error: "Run not found" }),
      });

      const result = await client.abortRun("test-run-123");

      expect(result).toEqual({
        success: false,
        error: "Run not found",
      });
    });

    it("should handle abort with malformed error response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      const result = await client.abortRun("test-run-123");

      expect(result).toEqual({
        success: false,
        error: "Unknown error",
      });
    });

    it("should handle network error during abort", async () => {
      mockFetch.mockRejectedValue(new Error("Connection timeout"));

      const result = await client.abortRun("test-run-123");

      expect(result).toEqual({
        success: false,
        error: "Connection timeout",
      });
    });
  });

  describe("getState", () => {
    it("should make GET request to state endpoint", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ steps: { transcribe: "running" } }),
      });

      await client.getState("test-run-123");

      expect(mockFetch).toHaveBeenCalledWith("/api/run/test-run-123/state");
    });

    it("should return state on success", async () => {
      const mockState = {
        steps: { transcribe: "success", draft: "running" },
        chunks: { processed: 10, total: 10 },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockState,
      });

      const result = await client.getState("test-run-123");

      expect(result).toEqual({
        success: true,
        state: mockState,
      });
    });

    it("should handle state fetch error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await client.getState("test-run-123");

      expect(result).toEqual({
        success: false,
        error: "State fetch failed: 404",
      });
    });

    it("should handle malformed state response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      const result = await client.getState("test-run-123");

      expect(result).toEqual({
        success: false,
        error: "Failed to parse state response",
      });
    });

    it("should handle network error during getState", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await client.getState("test-run-123");

      expect(result).toEqual({
        success: false,
        error: "Network error",
      });
    });
  });

  describe("createEventSource", () => {
    let originalEventSource: typeof EventSource;

    beforeEach(() => {
      originalEventSource = global.EventSource as any;
      global.EventSource = MockEventSource as any;
    });

    afterEach(() => {
      global.EventSource = originalEventSource;
    });

    it("should create EventSource with correct URL", () => {
      const es = client.createEventSource("test-run-123");

      expect(es).toBeInstanceOf(MockEventSource);
      expect((es as MockEventSource).url).toBe("/api/run/test-run-123/stream");
    });

    it("should encode runId in EventSource URL", () => {
      const es = client.createEventSource("test/run@123");

      expect((es as MockEventSource).url).toBe(
        "/api/run/test%2Frun%40123/stream"
      );
    });

    it("should create unique EventSource instances", () => {
      const es1 = client.createEventSource("run-1");
      const es2 = client.createEventSource("run-2");

      expect(es1).not.toBe(es2);
      expect((es1 as MockEventSource).url).not.toBe(
        (es2 as MockEventSource).url
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle non-Error exceptions", async () => {
      mockFetch.mockRejectedValue("String error");

      const result = await client.startRun({
        audio: "test.mp3",
        template: "default",
        outdoc: "output.docx",
        inputLanguage: "en",
        outputLanguage: "en",
      });

      expect(result).toEqual({
        success: false,
        error: "String error",
      });
    });

    it("should handle undefined error", async () => {
      mockFetch.mockRejectedValue(undefined);

      const result = await client.startRun({
        audio: "test.mp3",
        template: "default",
        outdoc: "output.docx",
        inputLanguage: "en",
        outputLanguage: "en",
      });

      expect(result).toEqual({
        success: false,
        error: "undefined",
      });
    });
  });

  describe("Response Validation", () => {
    it("should validate runId is a string", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ runId: 12345 }), // Number instead of string
      });

      const result = await client.startRun({
        audio: "test.mp3",
        template: "default",
        outdoc: "output.docx",
        inputLanguage: "en",
        outputLanguage: "en",
      });

      expect(result.success).toBe(false);
    });

    it("should handle empty runId", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ runId: "" }),
      });

      const result = await client.startRun({
        audio: "test.mp3",
        template: "default",
        outdoc: "output.docx",
        inputLanguage: "en",
        outputLanguage: "en",
      });

      // Empty string is still a valid string, so this should succeed
      expect(result.success).toBe(true);
      expect(result.runId).toBe("");
    });
  });
});
