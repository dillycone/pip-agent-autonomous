/**
 * Tests for pipelineStateReducer
 *
 * Comprehensive test suite for state reducer logic
 * Tests all state transitions and event handling
 */

import {
  pipelineStateReducer,
  createInitialPipelineState,
  computeOverallProgress,
  type PipelineState,
  type PipelineStateAction,
} from "../../lib/pipelineStateReducer";
import type { Step, StepStatus } from "../../lib/types";
import type {
  StatusEvent,
  ToolUseEvent,
  ToolResultEvent,
  TranscriptChunkEvent,
  JudgeRoundEvent,
  CostEvent,
  FinalEvent,
} from "../../lib/eventTypes";

describe("pipelineStateReducer", () => {
  describe("createInitialPipelineState", () => {
    it("should create initial state with default values", () => {
      const state = createInitialPipelineState();

      expect(state.steps).toEqual({
        transcribe: "pending",
        draft: "pending",
        review: "pending",
        export: "pending",
      });
      expect(state.chunks).toEqual({ processed: 0, total: 0 });
      expect(state.transcriptPreview).toBe("");
      expect(state.transcriptLines).toEqual([]);
      expect(state.progressMode).toBe("heuristic");
      expect(state.draftPreviewLines).toEqual([]);
      expect(state.draftPreviewStatus).toBe("idle");
      expect(state.draftUsage).toBeNull();
      expect(state.timeline).toEqual([]);
      expect(state.reviewRounds).toEqual([]);
      expect(state.finalDraft).toBe("");
      expect(state.docxPath).toBe("");
      expect(state.cost).toEqual({ tokens: 0, usd: 0, breakdown: {} });
    });
  });

  describe("reset action", () => {
    it("should reset state to initial values", () => {
      const state: PipelineState = {
        ...createInitialPipelineState(),
        steps: {
          transcribe: "success",
          draft: "running",
          review: "pending",
          export: "pending",
        },
        finalDraft: "Some draft text",
      };

      const action: PipelineStateAction = { type: "reset" };
      const newState = pipelineStateReducer(state, action);

      expect(newState).toEqual(createInitialPipelineState());
    });
  });

  describe("status event handling", () => {
    it("should update step status when status event is received", () => {
      const state = createInitialPipelineState();
      const event: StatusEvent = {
        step: "transcribe",
        status: "running",
      };

      const action: PipelineStateAction = { type: "status", event };
      const newState = pipelineStateReducer(state, action);

      expect(newState.steps.transcribe).toBe("running");
    });

    it("should initialize transcribe state when transcribe starts running", () => {
      const state = createInitialPipelineState();
      const event: StatusEvent = {
        step: "transcribe",
        status: "running",
      };

      const action: PipelineStateAction = { type: "status", event };
      const newState = pipelineStateReducer(state, action);

      expect(newState.transcriptLines).toEqual([]);
      expect(newState.transcriptPreview).toBe("");
      expect(newState.chunks).toEqual({ processed: 0, total: 0 });
      expect(newState.transcribeStartedAt).not.toBeNull();
    });

    it("should set draft preview status to streaming when draft starts", () => {
      const state = createInitialPipelineState();
      const event: StatusEvent = {
        step: "draft",
        status: "running",
      };

      const action: PipelineStateAction = { type: "status", event };
      const newState = pipelineStateReducer(state, action);

      expect(newState.draftPreviewStatus).toBe("streaming");
      expect(newState.draftPreviewLines).toEqual([]);
      expect(newState.draftUsage).toBeNull();
    });

    it("should set draft preview status to complete when draft completes", () => {
      const state = {
        ...createInitialPipelineState(),
        draftPreviewStatus: "streaming" as const,
      };
      const event: StatusEvent = {
        step: "draft",
        status: "success",
      };

      const action: PipelineStateAction = { type: "status", event };
      const newState = pipelineStateReducer(state, action);

      expect(newState.draftPreviewStatus).toBe("complete");
    });

    it("should reset review rounds when review starts", () => {
      const state = {
        ...createInitialPipelineState(),
        reviewRounds: [
          {
            round: 1,
            approved: false,
            reasons: ["test"],
            requiredChanges: [],
          },
        ],
      };
      const event: StatusEvent = {
        step: "review",
        status: "running",
      };

      const action: PipelineStateAction = { type: "status", event };
      const newState = pipelineStateReducer(state, action);

      expect(newState.reviewRounds).toEqual([]);
    });

    it("should ignore invalid status events", () => {
      const state = createInitialPipelineState();
      const event: StatusEvent = {};

      const action: PipelineStateAction = { type: "status", event };
      const newState = pipelineStateReducer(state, action);

      expect(newState).toEqual(state);
    });
  });

  describe("tool_use event handling", () => {
    it("should add tool use to timeline", () => {
      const state = createInitialPipelineState();
      const event: ToolUseEvent = {
        id: "tool-123",
        name: "gemini-transcriber",
        startedAt: new Date().toISOString(),
        inputSummary: { audio: "test.mp3" },
      };

      const action: PipelineStateAction = { type: "tool_use", event };
      const newState = pipelineStateReducer(state, action);

      expect(newState.timeline).toHaveLength(1);
      expect(newState.timeline[0]).toMatchObject({
        id: "tool-123",
        name: "gemini-transcriber",
        phase: "transcribe",
        status: "running",
      });
    });

    it("should detect phase from tool name", () => {
      const state = createInitialPipelineState();

      const testCases: Array<{ name: string; expectedPhase: Step | "unknown" }> = [
        { name: "gemini-transcriber", expectedPhase: "transcribe" },
        { name: "pip-generator", expectedPhase: "draft" },
        { name: "docx-exporter", expectedPhase: "export" },
        { name: "unknown-tool", expectedPhase: "unknown" },
      ];

      testCases.forEach(({ name, expectedPhase }) => {
        const event: ToolUseEvent = {
          id: `tool-${name}`,
          name,
        };
        const action: PipelineStateAction = { type: "tool_use", event };
        const newState = pipelineStateReducer(state, action);

        expect(newState.timeline[newState.timeline.length - 1].phase).toBe(
          expectedPhase
        );
      });
    });

    it("should ignore invalid tool use events", () => {
      const state = createInitialPipelineState();
      const event: ToolUseEvent = {};

      const action: PipelineStateAction = { type: "tool_use", event };
      const newState = pipelineStateReducer(state, action);

      expect(newState.timeline).toEqual([]);
    });
  });

  describe("tool_result event handling", () => {
    it("should update timeline item with result", () => {
      const state = {
        ...createInitialPipelineState(),
        timeline: [
          {
            id: "tool-123",
            name: "test-tool",
            phase: "transcribe" as Step,
            status: "running" as StepStatus,
          },
        ],
      };

      const event: ToolResultEvent = {
        id: "tool-123",
        name: "test-tool",
        isError: false,
        content: { result: "success" },
        finishedAt: new Date().toISOString(),
        durationMs: 1500,
      };

      const action: PipelineStateAction = { type: "tool_result", event };
      const newState = pipelineStateReducer(state, action);

      expect(newState.timeline[0]).toMatchObject({
        id: "tool-123",
        status: "success",
        finishedAt: expect.any(String),
        durationMs: 1500,
      });
    });

    it("should extract draft usage from pip-generator result", () => {
      const state = createInitialPipelineState();
      const event: ToolResultEvent = {
        id: "tool-draft",
        name: "pip-generator",
        content: [
          {
            text: JSON.stringify({
              draft: "Test draft",
              usage: {
                input_tokens: 100,
                output_tokens: 200,
                cache_creation_input_tokens: 50,
                cache_read_input_tokens: 25,
              },
              model: "claude-3-5-sonnet-20241022",
            }),
          },
        ],
      };

      const action: PipelineStateAction = { type: "tool_result", event };
      const newState = pipelineStateReducer(state, action);

      expect(newState.draftUsage).toMatchObject({
        model: "claude-3-5-sonnet-20241022",
        inputTokens: 100,
        outputTokens: 200,
        cacheCreationTokens: 50,
        cacheReadTokens: 25,
      });
    });

    it("should set fallback draft preview from pip-generator result", () => {
      const state = createInitialPipelineState();
      const event: ToolResultEvent = {
        id: "tool-draft",
        name: "pip-generator",
        content: [
          {
            text: JSON.stringify({
              draft: "Line 1\nLine 2\nLine 3\nLine 4",
            }),
          },
        ],
      };

      const action: PipelineStateAction = { type: "tool_result", event };
      const newState = pipelineStateReducer(state, action);

      expect(newState.draftPreviewLines).toEqual(["Line 1", "Line 2", "Line 3"]);
      expect(newState.draftPreviewStatus).toBe("complete");
    });
  });

  describe("transcript_chunk event handling", () => {
    it("should update transcript preview and chunks", () => {
      const state = createInitialPipelineState();
      const event: TranscriptChunkEvent = {
        transcript: "Test transcript\nLine 2\nLine 3\nLine 4",
        processedChunks: 5,
        totalChunks: 10,
      };

      const action: PipelineStateAction = { type: "transcript_chunk", event };
      const newState = pipelineStateReducer(state, action);

      expect(newState.transcriptPreview).toBe("Test transcript\nLine 2\nLine 3\nLine 4");
      expect(newState.transcriptLines).toEqual(["Line 2", "Line 3", "Line 4"]);
      expect(newState.chunks).toEqual({ processed: 5, total: 10 });
    });

    it("should handle explicit progress mode from meta", () => {
      const state = createInitialPipelineState();
      const event: TranscriptChunkEvent = {
        transcript: "Test",
        meta: { progressMode: "explicit" },
      };

      const action: PipelineStateAction = { type: "transcript_chunk", event };
      const newState = pipelineStateReducer(state, action);

      expect(newState.progressMode).toBe("explicit");
    });

    it("should infer total chunks from processed if not provided", () => {
      const state = createInitialPipelineState();
      const event: TranscriptChunkEvent = {
        transcript: "Test",
        processedChunks: 3,
      };

      const action: PipelineStateAction = { type: "transcript_chunk", event };
      const newState = pipelineStateReducer(state, action);

      expect(newState.chunks).toEqual({ processed: 3, total: 3 });
    });
  });

  describe("judge_round event handling", () => {
    it("should add judge round to review rounds", () => {
      const state = createInitialPipelineState();
      const event: JudgeRoundEvent = {
        round: 1,
        approved: false,
        reasons: ["Needs more detail"],
        required_changes: ["Add section X"],
      };

      const action: PipelineStateAction = { type: "judge_round", event };
      const newState = pipelineStateReducer(state, action);

      expect(newState.reviewRounds).toHaveLength(1);
      expect(newState.reviewRounds[0]).toMatchObject({
        round: 1,
        approved: false,
        reasons: ["Needs more detail"],
        requiredChanges: ["Add section X"],
      });
    });

    it("should replace existing round with same number", () => {
      const state = {
        ...createInitialPipelineState(),
        reviewRounds: [
          {
            round: 1,
            approved: false,
            reasons: ["Old reason"],
            requiredChanges: [],
          },
        ],
      };

      const event: JudgeRoundEvent = {
        round: 1,
        approved: true,
        reasons: ["New reason"],
        required_changes: [],
      };

      const action: PipelineStateAction = { type: "judge_round", event };
      const newState = pipelineStateReducer(state, action);

      expect(newState.reviewRounds).toHaveLength(1);
      expect(newState.reviewRounds[0].approved).toBe(true);
      expect(newState.reviewRounds[0].reasons).toEqual(["New reason"]);
    });

    it("should limit review rounds to last 4", () => {
      const state = {
        ...createInitialPipelineState(),
        reviewRounds: [
          { round: 1, approved: false, reasons: [], requiredChanges: [] },
          { round: 2, approved: false, reasons: [], requiredChanges: [] },
          { round: 3, approved: false, reasons: [], requiredChanges: [] },
          { round: 4, approved: false, reasons: [], requiredChanges: [] },
        ],
      };

      const event: JudgeRoundEvent = {
        round: 5,
        approved: true,
        reasons: [],
        required_changes: [],
      };

      const action: PipelineStateAction = { type: "judge_round", event };
      const newState = pipelineStateReducer(state, action);

      expect(newState.reviewRounds).toHaveLength(4);
      expect(newState.reviewRounds[0].round).toBe(2);
      expect(newState.reviewRounds[3].round).toBe(5);
    });
  });

  describe("cost event handling", () => {
    it("should update cost state", () => {
      const state = createInitialPipelineState();
      const event: CostEvent = {
        summary: {
          totalTokens: 5000,
          estimatedCostUSD: 0.15,
          breakdown: {
            transcribe: { tokens: 1000, usd: 0.03 },
            draft: { tokens: 4000, usd: 0.12 },
          },
        },
      };

      const action: PipelineStateAction = { type: "cost", event };
      const newState = pipelineStateReducer(state, action);

      expect(newState.cost).toEqual({
        tokens: 5000,
        usd: 0.15,
        breakdown: {
          transcribe: { tokens: 1000, usd: 0.03 },
          draft: { tokens: 4000, usd: 0.12 },
        },
      });
    });
  });

  describe("final event handling", () => {
    it("should update final draft and docx path", () => {
      const state = createInitialPipelineState();
      const event: FinalEvent = {
        ok: true,
        draft: "Final draft text\nLine 2\nLine 3\nLine 4",
        docx: "/path/to/output.docx",
        docxRelative: "output.docx",
      };

      const action: PipelineStateAction = { type: "final", event };
      const newState = pipelineStateReducer(state, action);

      expect(newState.finalDraft).toBe("Final draft text\nLine 2\nLine 3\nLine 4");
      expect(newState.docxPath).toBe("/path/to/output.docx");
      expect(newState.docxRelativePath).toBe("output.docx");
      expect(newState.draftPreviewLines).toEqual(["Line 2", "Line 3", "Line 4"]);
      expect(newState.draftPreviewStatus).toBe("complete");
    });

    it("should ignore final event if not ok", () => {
      const state = createInitialPipelineState();
      const event: FinalEvent = {
        ok: false,
      };

      const action: PipelineStateAction = { type: "final", event };
      const newState = pipelineStateReducer(state, action);

      expect(newState).toEqual(state);
    });
  });

  describe("draft preview events", () => {
    it("should reset draft preview on draft_stream_reset", () => {
      const state = {
        ...createInitialPipelineState(),
        draftPreviewLines: ["Old line"],
        draftPreviewStatus: "idle" as const,
      };

      const action: PipelineStateAction = {
        type: "draft_stream_reset",
        event: {},
      };
      const newState = pipelineStateReducer(state, action);

      expect(newState.draftPreviewStatus).toBe("streaming");
      expect(newState.draftPreviewLines).toEqual([]);
    });

    it("should update status on draft_stream_delta", () => {
      const state = createInitialPipelineState();

      const action: PipelineStateAction = {
        type: "draft_stream_delta",
        event: { text: "Delta text" },
      };
      const newState = pipelineStateReducer(state, action);

      expect(newState.draftPreviewStatus).toBe("streaming");
    });

    it("should complete draft preview on draft_stream_complete", () => {
      const state = {
        ...createInitialPipelineState(),
        draftPreviewStatus: "streaming" as const,
      };

      const action: PipelineStateAction = {
        type: "draft_stream_complete",
        event: {},
      };
      const newState = pipelineStateReducer(state, action);

      expect(newState.draftPreviewStatus).toBe("complete");
    });

    it("should add preview chunk to draft preview lines", () => {
      const state = createInitialPipelineState();

      const action: PipelineStateAction = {
        type: "draft_preview_chunk",
        event: { text: "Preview line 1" },
      };
      const newState = pipelineStateReducer(state, action);

      expect(newState.draftPreviewLines).toEqual(["Preview line 1"]);
      expect(newState.draftPreviewStatus).toBe("streaming");
    });

    it("should limit draft preview lines to last 3", () => {
      const state = {
        ...createInitialPipelineState(),
        draftPreviewLines: ["Line 1", "Line 2", "Line 3"],
      };

      const action: PipelineStateAction = {
        type: "draft_preview_chunk",
        event: { text: "Line 4" },
      };
      const newState = pipelineStateReducer(state, action);

      expect(newState.draftPreviewLines).toEqual(["Line 2", "Line 3", "Line 4"]);
    });
  });

  describe("stream_error handling", () => {
    it("should mark all running steps as error", () => {
      const state = {
        ...createInitialPipelineState(),
        steps: {
          transcribe: "success" as StepStatus,
          draft: "running" as StepStatus,
          review: "running" as StepStatus,
          export: "pending" as StepStatus,
        },
      };

      const action: PipelineStateAction = { type: "stream_error" };
      const newState = pipelineStateReducer(state, action);

      expect(newState.steps.transcribe).toBe("success");
      expect(newState.steps.draft).toBe("error");
      expect(newState.steps.review).toBe("error");
      expect(newState.steps.export).toBe("pending");
    });
  });

  describe("computeOverallProgress", () => {
    it("should return 0 for initial state", () => {
      const state = createInitialPipelineState();
      const progress = computeOverallProgress(state);
      expect(progress).toBe(0);
    });

    it("should compute 50% when transcribe is complete", () => {
      const state = {
        ...createInitialPipelineState(),
        steps: {
          ...createInitialPipelineState().steps,
          transcribe: "success" as StepStatus,
        },
      };
      const progress = computeOverallProgress(state);
      expect(progress).toBe(50);
    });

    it("should compute partial progress during transcribe", () => {
      const state = {
        ...createInitialPipelineState(),
        steps: {
          ...createInitialPipelineState().steps,
          transcribe: "running" as StepStatus,
        },
        chunks: { processed: 5, total: 10 },
      };
      const progress = computeOverallProgress(state);
      expect(progress).toBe(25); // 50% of 50% = 25%
    });

    it("should compute 75% when transcribe and draft are complete", () => {
      const state = {
        ...createInitialPipelineState(),
        steps: {
          ...createInitialPipelineState().steps,
          transcribe: "success" as StepStatus,
          draft: "success" as StepStatus,
        },
      };
      const progress = computeOverallProgress(state);
      expect(progress).toBe(75); // 50 + 25
    });

    it("should compute 100% when all steps are complete", () => {
      const state = {
        ...createInitialPipelineState(),
        steps: {
          transcribe: "success" as StepStatus,
          draft: "success" as StepStatus,
          review: "success" as StepStatus,
          export: "success" as StepStatus,
        },
      };
      const progress = computeOverallProgress(state);
      expect(progress).toBe(100); // 50 + 25 + 15 + 10
    });

    it("should include review progress based on rounds", () => {
      const state = {
        ...createInitialPipelineState(),
        steps: {
          ...createInitialPipelineState().steps,
          transcribe: "success" as StepStatus,
          draft: "success" as StepStatus,
          review: "running" as StepStatus,
        },
        reviewRounds: [
          { round: 1, approved: false, reasons: [], requiredChanges: [] },
          { round: 2, approved: false, reasons: [], requiredChanges: [] },
        ],
      };
      const progress = computeOverallProgress(state);
      // 50 (transcribe) + 25 (draft) + ~7.5 (2 rounds / 4 * 15)
      expect(progress).toBeGreaterThanOrEqual(82);
      expect(progress).toBeLessThanOrEqual(83);
    });
  });
});
