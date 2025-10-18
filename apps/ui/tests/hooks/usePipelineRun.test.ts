/**
 * Tests for usePipelineRun Hook
 *
 * Tests hook initialization, event handling, state management,
 * and cleanup behavior using React Testing Library patterns
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { usePipelineRun } from "../../app/hooks/usePipelineRun";
import { pipelineClient } from "../../lib/pipelineClient";
import { MockEventSource, waitForAsync } from "../utils/testHelpers";

// Mock the pipelineClient
jest.mock("../../lib/pipelineClient", () => ({
  pipelineClient: {
    startRun: jest.fn(),
    abortRun: jest.fn(),
    getState: jest.fn(),
    createEventSource: jest.fn(),
  },
}));

describe("usePipelineRun", () => {
  let mockEventSource: MockEventSource;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEventSource = new MockEventSource("/test-stream");
    (pipelineClient.createEventSource as jest.Mock).mockReturnValue(
      mockEventSource
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Hook Initialization", () => {
    it("should initialize with default state", () => {
      const { result } = renderHook(() => usePipelineRun());

      expect(result.current.isRunning).toBe(false);
      expect(result.current.runId).toBeNull();
      expect(result.current.state.steps).toEqual({
        transcribe: "pending",
        draft: "pending",
        review: "pending",
        export: "pending",
      });
      expect(result.current.draftStreamBuffer.current).toBe("");
    });

    it("should accept custom callbacks via options", () => {
      const onLog = jest.fn();
      const onToast = jest.fn();

      const { result } = renderHook(() =>
        usePipelineRun({ onLog, onToast })
      );

      expect(result.current.onLog).toBeDefined();
      expect(result.current.onToast).toBeDefined();
    });
  });

  describe("startRun function", () => {
    it("should call pipelineClient.startRun with correct params", async () => {
      (pipelineClient.startRun as jest.Mock).mockResolvedValue({
        success: true,
        runId: "test-run-123",
      });

      const { result } = renderHook(() => usePipelineRun());

      await act(async () => {
        await result.current.startRun({
          audio: "test.mp3",
          template: "default",
          outdoc: "output.docx",
          inputLanguage: "en",
          outputLanguage: "en",
        });
      });

      expect(pipelineClient.startRun).toHaveBeenCalledWith({
        audio: "test.mp3",
        template: "default",
        outdoc: "output.docx",
        inputLanguage: "en",
        outputLanguage: "en",
      });
    });

    it("should set isRunning and runId on successful start", async () => {
      (pipelineClient.startRun as jest.Mock).mockResolvedValue({
        success: true,
        runId: "test-run-123",
      });

      const { result } = renderHook(() => usePipelineRun());

      await act(async () => {
        await result.current.startRun({
          audio: "test.mp3",
          template: "default",
          outdoc: "output.docx",
          inputLanguage: "en",
          outputLanguage: "en",
        });
      });

      await waitFor(() => {
        expect(result.current.isRunning).toBe(true);
        expect(result.current.runId).toBe("test-run-123");
      });
    });

    it("should create EventSource with runId", async () => {
      (pipelineClient.startRun as jest.Mock).mockResolvedValue({
        success: true,
        runId: "test-run-123",
      });

      const { result } = renderHook(() => usePipelineRun());

      await act(async () => {
        await result.current.startRun({
          audio: "test.mp3",
          template: "default",
          outdoc: "output.docx",
          inputLanguage: "en",
          outputLanguage: "en",
        });
      });

      expect(pipelineClient.createEventSource).toHaveBeenCalledWith(
        "test-run-123"
      );
    });

    it("should handle startRun error", async () => {
      const onToast = jest.fn();
      (pipelineClient.startRun as jest.Mock).mockResolvedValue({
        success: false,
        error: "Failed to start run",
        details: { reason: "server error" },
      });

      const { result } = renderHook(() => usePipelineRun({ onToast }));

      await act(async () => {
        await result.current.startRun({
          audio: "test.mp3",
          template: "default",
          outdoc: "output.docx",
          inputLanguage: "en",
          outputLanguage: "en",
        });
      });

      expect(result.current.isRunning).toBe(false);
      expect(onToast).toHaveBeenCalledWith("Failed to start run", "error");
    });

    it("should not start if already running", async () => {
      (pipelineClient.startRun as jest.Mock).mockResolvedValue({
        success: true,
        runId: "test-run-123",
      });

      const { result } = renderHook(() => usePipelineRun());

      await act(async () => {
        await result.current.startRun({
          audio: "test.mp3",
          template: "default",
          outdoc: "output.docx",
          inputLanguage: "en",
          outputLanguage: "en",
        });
      });

      const firstCallCount = (pipelineClient.startRun as jest.Mock).mock.calls
        .length;

      // Try to start again while running
      await act(async () => {
        await result.current.startRun({
          audio: "test2.mp3",
          template: "default",
          outdoc: "output.docx",
          inputLanguage: "en",
          outputLanguage: "en",
        });
      });

      // Should not call startRun again
      expect((pipelineClient.startRun as jest.Mock).mock.calls.length).toBe(
        firstCallCount
      );
    });

    it("should reset state before starting new run", async () => {
      (pipelineClient.startRun as jest.Mock).mockResolvedValue({
        success: true,
        runId: "test-run-123",
      });

      const { result } = renderHook(() => usePipelineRun());

      // Modify state
      act(() => {
        result.current.draftStreamBuffer.current = "old data";
      });

      await act(async () => {
        await result.current.startRun({
          audio: "test.mp3",
          template: "default",
          outdoc: "output.docx",
          inputLanguage: "en",
          outputLanguage: "en",
        });
      });

      expect(result.current.draftStreamBuffer.current).toBe("");
    });
  });

  describe("Event Handling", () => {
    beforeEach(async () => {
      (pipelineClient.startRun as jest.Mock).mockResolvedValue({
        success: true,
        runId: "test-run-123",
      });
    });

    it("should handle status event", async () => {
      const { result } = renderHook(() => usePipelineRun());

      await act(async () => {
        await result.current.startRun({
          audio: "test.mp3",
          template: "default",
          outdoc: "output.docx",
          inputLanguage: "en",
          outputLanguage: "en",
        });
      });

      await act(async () => {
        mockEventSource.simulateMessage(
          "status",
          JSON.stringify({ step: "transcribe", status: "running" })
        );
        await waitForAsync();
      });

      expect(result.current.state.steps.transcribe).toBe("running");
    });

    it("should handle tool_use event", async () => {
      const { result } = renderHook(() => usePipelineRun());

      await act(async () => {
        await result.current.startRun({
          audio: "test.mp3",
          template: "default",
          outdoc: "output.docx",
          inputLanguage: "en",
          outputLanguage: "en",
        });
      });

      await act(async () => {
        mockEventSource.simulateMessage(
          "tool_use",
          JSON.stringify({ id: "tool-1", name: "gemini-transcriber" })
        );
        await waitForAsync();
      });

      await waitFor(() => {
        expect(result.current.state.timeline.length).toBeGreaterThan(0);
      });
      expect(result.current.state.timeline[0].name).toBe("gemini-transcriber");
    });

    it("should handle transcript_chunk event", async () => {
      const { result } = renderHook(() => usePipelineRun());

      await act(async () => {
        await result.current.startRun({
          audio: "test.mp3",
          template: "default",
          outdoc: "output.docx",
          inputLanguage: "en",
          outputLanguage: "en",
        });
      });

      await act(async () => {
        mockEventSource.simulateMessage(
          "transcript_chunk",
          JSON.stringify({
            transcript: "Test transcript\nLine 2\nLine 3\nLine 4",
            processedChunks: 5,
            totalChunks: 10,
          })
        );
        await waitForAsync();
      });

      expect(result.current.state.transcriptPreview).toContain("Test transcript");
      expect(result.current.state.chunks).toEqual({ processed: 5, total: 10 });
    });

    it("should handle draft_stream_delta event and update buffer", async () => {
      const { result } = renderHook(() => usePipelineRun());

      await act(async () => {
        await result.current.startRun({
          audio: "test.mp3",
          template: "default",
          outdoc: "output.docx",
          inputLanguage: "en",
          outputLanguage: "en",
        });
      });

      // Reset draft stream
      await act(async () => {
        mockEventSource.simulateMessage("draft_stream_reset", JSON.stringify({}));
        await waitForAsync();
      });

      // Send delta
      await act(async () => {
        mockEventSource.simulateMessage(
          "draft_stream_delta",
          JSON.stringify({ text: "Draft text chunk 1\nLine 2\nLine 3\nLine 4" })
        );
        await waitForAsync();
      });

      expect(result.current.draftStreamBuffer.current).toContain("Draft text chunk 1");
      expect(result.current.state.draftPreviewLines.length).toBeGreaterThan(0);
    });

    it("should handle final event and set isRunning to false", async () => {
      const { result } = renderHook(() => usePipelineRun());

      await act(async () => {
        await result.current.startRun({
          audio: "test.mp3",
          template: "default",
          outdoc: "output.docx",
          inputLanguage: "en",
          outputLanguage: "en",
        });
      });

      await act(async () => {
        mockEventSource.simulateMessage(
          "final",
          JSON.stringify({
            ok: true,
            draft: "Final draft",
            docx: "/path/to/output.docx",
          })
        );
        await waitForAsync();
      });

      await waitFor(() => {
        expect(result.current.isRunning).toBe(false);
        expect(result.current.state.finalDraft).toBe("Final draft");
      });
    });

    it("should call onToast callback on status changes", async () => {
      const onToast = jest.fn();
      const { result } = renderHook(() => usePipelineRun({ onToast }));

      await act(async () => {
        await result.current.startRun({
          audio: "test.mp3",
          template: "default",
          outdoc: "output.docx",
          inputLanguage: "en",
          outputLanguage: "en",
        });
      });

      await act(async () => {
        mockEventSource.simulateMessage(
          "status",
          JSON.stringify({ step: "transcribe", status: "running" })
        );
        await waitForAsync();
      });

      expect(onToast).toHaveBeenCalledWith("Transcribe started", "info");
    });

    it("should handle error event", async () => {
      const onToast = jest.fn();
      const { result } = renderHook(() => usePipelineRun({ onToast }));

      await act(async () => {
        await result.current.startRun({
          audio: "test.mp3",
          template: "default",
          outdoc: "output.docx",
          inputLanguage: "en",
          outputLanguage: "en",
        });
      });

      await act(async () => {
        mockEventSource.simulateMessage(
          "error",
          JSON.stringify({ error: "Stream error" })
        );
        await waitForAsync();
      });

      expect(result.current.isRunning).toBe(false);
    });
  });

  describe("abortRun function", () => {
    it("should call pipelineClient.abortRun with runId", async () => {
      (pipelineClient.startRun as jest.Mock).mockResolvedValue({
        success: true,
        runId: "test-run-123",
      });
      (pipelineClient.abortRun as jest.Mock).mockResolvedValue({
        success: true,
      });

      const { result } = renderHook(() => usePipelineRun());

      await act(async () => {
        await result.current.startRun({
          audio: "test.mp3",
          template: "default",
          outdoc: "output.docx",
          inputLanguage: "en",
          outputLanguage: "en",
        });
      });

      await act(async () => {
        await result.current.abortRun();
      });

      expect(pipelineClient.abortRun).toHaveBeenCalledWith("test-run-123");
    });

    it("should handle abort when no active run", async () => {
      const onToast = jest.fn();
      const { result } = renderHook(() => usePipelineRun({ onToast }));

      await act(async () => {
        await result.current.abortRun();
      });

      expect(onToast).toHaveBeenCalledWith("No active run to cancel", "warn");
    });

    it("should handle abort error", async () => {
      (pipelineClient.startRun as jest.Mock).mockResolvedValue({
        success: true,
        runId: "test-run-123",
      });
      (pipelineClient.abortRun as jest.Mock).mockResolvedValue({
        success: false,
        error: "Abort failed",
      });

      const onToast = jest.fn();
      const { result } = renderHook(() => usePipelineRun({ onToast }));

      await act(async () => {
        await result.current.startRun({
          audio: "test.mp3",
          template: "default",
          outdoc: "output.docx",
          inputLanguage: "en",
          outputLanguage: "en",
        });
      });

      await act(async () => {
        await result.current.abortRun();
      });

      expect(onToast).toHaveBeenCalledWith("Cancel failed: Abort failed", "error");
    });
  });

  describe("resetState function", () => {
    it("should reset all state to initial values", async () => {
      (pipelineClient.startRun as jest.Mock).mockResolvedValue({
        success: true,
        runId: "test-run-123",
      });

      const { result } = renderHook(() => usePipelineRun());

      await act(async () => {
        await result.current.startRun({
          audio: "test.mp3",
          template: "default",
          outdoc: "output.docx",
          inputLanguage: "en",
          outputLanguage: "en",
        });
      });

      // Simulate some state changes
      await act(async () => {
        mockEventSource.simulateMessage(
          "status",
          JSON.stringify({ step: "transcribe", status: "running" })
        );
        await waitForAsync();
      });

      // Reset
      act(() => {
        result.current.resetState();
      });

      expect(result.current.state.steps.transcribe).toBe("pending");
      expect(result.current.runId).toBeNull();
      expect(result.current.draftStreamBuffer.current).toBe("");
    });
  });

  describe("Cleanup on unmount", () => {
    it("should close EventSource on unmount", async () => {
      (pipelineClient.startRun as jest.Mock).mockResolvedValue({
        success: true,
        runId: "test-run-123",
      });

      const { result, unmount } = renderHook(() => usePipelineRun());

      await act(async () => {
        await result.current.startRun({
          audio: "test.mp3",
          template: "default",
          outdoc: "output.docx",
          inputLanguage: "en",
          outputLanguage: "en",
        });
      });

      const closeSpy = jest.spyOn(mockEventSource, "close");

      unmount();

      expect(closeSpy).toHaveBeenCalled();
      expect(mockEventSource.readyState).toBe(MockEventSource.CLOSED);
    });
  });

  describe("Error States", () => {
    it("should handle malformed JSON in events", async () => {
      const onLog = jest.fn();
      (pipelineClient.startRun as jest.Mock).mockResolvedValue({
        success: true,
        runId: "test-run-123",
      });

      const { result } = renderHook(() => usePipelineRun({ onLog }));

      await act(async () => {
        await result.current.startRun({
          audio: "test.mp3",
          template: "default",
          outdoc: "output.docx",
          inputLanguage: "en",
          outputLanguage: "en",
        });
      });

      await act(async () => {
        mockEventSource.simulateMessage("status", "invalid json {");
        await waitForAsync();
      });

      // Should not crash, state should remain unchanged
      expect(result.current.state.steps.transcribe).toBe("pending");
    });

    it("should handle connection error and attempt resync", async () => {
      (pipelineClient.startRun as jest.Mock).mockResolvedValue({
        success: true,
        runId: "test-run-123",
      });
      (pipelineClient.getState as jest.Mock).mockResolvedValue({
        success: true,
        state: { steps: { transcribe: "running" } },
      });

      const { result } = renderHook(() => usePipelineRun());

      await act(async () => {
        await result.current.startRun({
          audio: "test.mp3",
          template: "default",
          outdoc: "output.docx",
          inputLanguage: "en",
          outputLanguage: "en",
        });
      });

      // Simulate connection error
      await act(async () => {
        mockEventSource.simulateError();
        await waitForAsync();
      });

      // Should attempt to get state and create new EventSource
      await waitFor(() => {
        expect(pipelineClient.getState).toHaveBeenCalledWith("test-run-123");
      });
    });
  });
});
