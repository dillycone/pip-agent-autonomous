import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createInitialPipelineState,
  pipelineStateReducer,
  computeOverallProgress,
  type PipelineState,
  type PipelineStateAction
} from "../../apps/ui/lib/pipelineStateReducer.js";
import { DEFAULT_STEPS } from "../../apps/ui/lib/constants.js";

// ============================================================================
// Initial State Tests
// ============================================================================

test("createInitialPipelineState returns correct initial state", () => {
  const state = createInitialPipelineState();

  assert.deepEqual(state.steps, DEFAULT_STEPS);
  assert.deepEqual(state.chunks, { processed: 0, total: 0 });
  assert.equal(state.transcriptPreview, "");
  assert.deepEqual(state.transcriptLines, []);
  assert.equal(state.progressMode, "heuristic");
  assert.deepEqual(state.draftPreviewLines, []);
  assert.equal(state.draftPreviewStatus, "idle");
  assert.equal(state.draftUsage, null);
  assert.deepEqual(state.timeline, []);
  assert.deepEqual(state.reviewRounds, []);
  assert.equal(state.finalDraft, "");
  assert.equal(state.docxPath, "");
  assert.equal(state.docxRelativePath, "");
  assert.deepEqual(state.cost, { tokens: 0, usd: 0, breakdown: {} });
  assert.equal(state.transcribeStartedAt, null);
  assert.equal(state.transcribeEndedAt, null);
  assert.equal(state.uploadStartedAt, null);
  assert.equal(state.uploadCompletedAt, null);
});

// ============================================================================
// Reset Action Tests
// ============================================================================

test("reset action returns fresh initial state", () => {
  const state = createInitialPipelineState();
  state.finalDraft = "some draft";
  state.docxPath = "/path/to/doc.docx";
  state.cost.tokens = 1000;

  const newState = pipelineStateReducer(state, { type: "reset" });

  assert.deepEqual(newState, createInitialPipelineState());
  assert.equal(newState.finalDraft, "");
  assert.equal(newState.docxPath, "");
  assert.equal(newState.cost.tokens, 0);
});

// ============================================================================
// Status Event Tests
// ============================================================================

test("status event updates step status", () => {
  const state = createInitialPipelineState();

  const newState = pipelineStateReducer(state, {
    type: "status",
    event: { step: "transcribe", status: "running" }
  });

  assert.equal(newState.steps.transcribe, "running");
  assert.equal(newState.steps.draft, "pending");
});

test("status event with transcribe running initializes transcription state", () => {
  const state = createInitialPipelineState();
  const beforeTime = Date.now();

  const newState = pipelineStateReducer(state, {
    type: "status",
    event: { step: "transcribe", status: "running" }
  });

  const afterTime = Date.now();

  assert.equal(newState.steps.transcribe, "running");
  assert.deepEqual(newState.transcriptLines, []);
  assert.equal(newState.transcriptPreview, "");
  assert.deepEqual(newState.chunks, { processed: 0, total: 0 });
  assert.ok(newState.transcribeStartedAt !== null);
  assert.ok(newState.transcribeStartedAt >= beforeTime && newState.transcribeStartedAt <= afterTime);
  assert.ok(newState.uploadStartedAt !== null);
  assert.equal(newState.transcribeEndedAt, null);
});

test("status event with draft running initializes draft state", () => {
  const state = createInitialPipelineState();

  const newState = pipelineStateReducer(state, {
    type: "status",
    event: { step: "draft", status: "running" }
  });

  assert.equal(newState.steps.draft, "running");
  assert.equal(newState.draftPreviewStatus, "streaming");
  assert.deepEqual(newState.draftPreviewLines, []);
  assert.equal(newState.draftUsage, null);
});

test("status event with review running resets review rounds", () => {
  const state = createInitialPipelineState();
  state.reviewRounds = [
    { round: 1, approved: false, reasons: [], requiredChanges: [] }
  ];

  const newState = pipelineStateReducer(state, {
    type: "status",
    event: { step: "review", status: "running" }
  });

  assert.equal(newState.steps.review, "running");
  assert.deepEqual(newState.reviewRounds, []);
});

test("status event with draft success sets draft preview complete", () => {
  const state = createInitialPipelineState();
  state.draftPreviewStatus = "streaming";

  const newState = pipelineStateReducer(state, {
    type: "status",
    event: { step: "draft", status: "success" }
  });

  assert.equal(newState.steps.draft, "success");
  assert.equal(newState.draftPreviewStatus, "complete");
});

test("status event with draft error sets draft preview complete", () => {
  const state = createInitialPipelineState();
  state.draftPreviewStatus = "streaming";

  const newState = pipelineStateReducer(state, {
    type: "status",
    event: { step: "draft", status: "error" }
  });

  assert.equal(newState.steps.draft, "error");
  assert.equal(newState.draftPreviewStatus, "complete");
});

test("status event with transcribe success sets timestamps", () => {
  const state = createInitialPipelineState();
  state.transcribeStartedAt = Date.now() - 5000;
  const beforeTime = Date.now();

  const newState = pipelineStateReducer(state, {
    type: "status",
    event: { step: "transcribe", status: "success" }
  });

  const afterTime = Date.now();

  assert.equal(newState.steps.transcribe, "success");
  assert.ok(newState.transcribeEndedAt !== null);
  assert.ok(newState.transcribeEndedAt >= beforeTime && newState.transcribeEndedAt <= afterTime);
  assert.ok(newState.uploadCompletedAt !== null);
});

test("status event with invalid step does not modify state", () => {
  const state = createInitialPipelineState();

  const newState = pipelineStateReducer(state, {
    type: "status",
    event: { step: undefined, status: "running" } as any
  });

  assert.deepEqual(newState, state);
});

// ============================================================================
// Tool Use Event Tests
// ============================================================================

test("tool_use event adds item to timeline", () => {
  const state = createInitialPipelineState();

  const newState = pipelineStateReducer(state, {
    type: "tool_use",
    event: {
      id: "tool-123",
      name: "gemini-transcriber",
      startedAt: "2024-01-01T00:00:00.000Z",
      inputSummary: { audio: "file.mp3" }
    }
  });

  assert.equal(newState.timeline.length, 1);
  assert.equal(newState.timeline[0].id, "tool-123");
  assert.equal(newState.timeline[0].name, "gemini-transcriber");
  assert.equal(newState.timeline[0].phase, "transcribe");
  assert.equal(newState.timeline[0].status, "running");
});

test("tool_use event identifies pip-generator phase", () => {
  const state = createInitialPipelineState();

  const newState = pipelineStateReducer(state, {
    type: "tool_use",
    event: {
      id: "tool-456",
      name: "pip-generator",
      startedAt: "2024-01-01T00:00:00.000Z"
    }
  });

  assert.equal(newState.timeline[0].phase, "draft");
});

test("tool_use event identifies docx-exporter phase", () => {
  const state = createInitialPipelineState();

  const newState = pipelineStateReducer(state, {
    type: "tool_use",
    event: {
      id: "tool-789",
      name: "docx-exporter",
      startedAt: "2024-01-01T00:00:00.000Z"
    }
  });

  assert.equal(newState.timeline[0].phase, "export");
});

test("tool_use event handles unknown tool", () => {
  const state = createInitialPipelineState();

  const newState = pipelineStateReducer(state, {
    type: "tool_use",
    event: {
      id: "tool-999",
      name: "unknown-tool",
      startedAt: "2024-01-01T00:00:00.000Z"
    }
  });

  assert.equal(newState.timeline[0].phase, "unknown");
});

test("tool_use event limits timeline to 500 items", () => {
  const state = createInitialPipelineState();

  // Fill timeline with 500 items
  for (let i = 0; i < 500; i++) {
    state.timeline.push({
      id: `tool-${i}`,
      name: "test-tool",
      phase: "transcribe",
      status: "success"
    });
  }

  const newState = pipelineStateReducer(state, {
    type: "tool_use",
    event: {
      id: "tool-501",
      name: "gemini-transcriber",
      startedAt: "2024-01-01T00:00:00.000Z"
    }
  });

  assert.equal(newState.timeline.length, 500);
  assert.equal(newState.timeline[newState.timeline.length - 1].id, "tool-501");
});

// ============================================================================
// Tool Result Event Tests
// ============================================================================

test("tool_result event updates timeline item", () => {
  const state = createInitialPipelineState();
  state.timeline = [{
    id: "tool-123",
    name: "gemini-transcriber",
    phase: "transcribe",
    status: "running",
    startedAt: "2024-01-01T00:00:00.000Z"
  }];

  const newState = pipelineStateReducer(state, {
    type: "tool_result",
    event: {
      id: "tool-123",
      name: "gemini-transcriber",
      isError: false,
      content: [{ text: '{"transcript": "hello"}' }],
      finishedAt: "2024-01-01T00:01:00.000Z",
      durationMs: 60000
    }
  });

  assert.equal(newState.timeline[0].status, "success");
  assert.equal(newState.timeline[0].isError, false);
  assert.equal(newState.timeline[0].finishedAt, "2024-01-01T00:01:00.000Z");
  assert.equal(newState.timeline[0].durationMs, 60000);
});

test("tool_result event with error marks timeline item as error", () => {
  const state = createInitialPipelineState();
  state.timeline = [{
    id: "tool-123",
    name: "gemini-transcriber",
    phase: "transcribe",
    status: "running"
  }];

  const newState = pipelineStateReducer(state, {
    type: "tool_result",
    event: {
      id: "tool-123",
      isError: true,
      content: "Error occurred"
    }
  });

  assert.equal(newState.timeline[0].status, "error");
  assert.equal(newState.timeline[0].isError, true);
});

test("tool_result event extracts pip-generator usage metrics", () => {
  const state = createInitialPipelineState();

  const newState = pipelineStateReducer(state, {
    type: "tool_result",
    event: {
      id: "tool-456",
      name: "pip-generator",
      isError: false,
      content: [{
        text: JSON.stringify({
          draft: "PIP content",
          model: "claude-sonnet-4.5",
          usage: {
            inputTokens: 1000,
            outputTokens: 500,
            cacheCreationTokens: 200,
            cacheReadTokens: 100
          }
        })
      }]
    }
  });

  assert.ok(newState.draftUsage);
  assert.equal(newState.draftUsage.model, "claude-sonnet-4.5");
  assert.equal(newState.draftUsage.inputTokens, 1000);
  assert.equal(newState.draftUsage.outputTokens, 500);
  assert.equal(newState.draftUsage.cacheCreationTokens, 200);
  assert.equal(newState.draftUsage.cacheReadTokens, 100);
});

test("tool_result event sets draft preview from fallback", () => {
  const state = createInitialPipelineState();

  const newState = pipelineStateReducer(state, {
    type: "tool_result",
    event: {
      id: "tool-456",
      name: "pip-generator",
      isError: false,
      content: [{
        text: JSON.stringify({
          draft: "Line 1\nLine 2\nLine 3\nLine 4"
        })
      }]
    }
  });

  assert.equal(newState.draftPreviewLines.length, 3);
  assert.equal(newState.draftPreviewLines[0], "Line 1");
  assert.equal(newState.draftPreviewLines[1], "Line 2");
  assert.equal(newState.draftPreviewLines[2], "Line 3");
  assert.equal(newState.draftPreviewStatus, "complete");
});

// ============================================================================
// Transcript Chunk Event Tests
// ============================================================================

test("transcript_chunk event updates chunk progress", () => {
  const state = createInitialPipelineState();

  const newState = pipelineStateReducer(state, {
    type: "transcript_chunk",
    event: {
      processedChunks: 5,
      totalChunks: 10,
      transcript: "Sample transcript"
    }
  });

  assert.equal(newState.chunks.processed, 5);
  assert.equal(newState.chunks.total, 10);
  assert.equal(newState.transcriptPreview, "Sample transcript");
});

test("transcript_chunk event extracts last 3 lines", () => {
  const state = createInitialPipelineState();

  const newState = pipelineStateReducer(state, {
    type: "transcript_chunk",
    event: {
      transcript: "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
    }
  });

  assert.equal(newState.transcriptLines.length, 3);
  assert.equal(newState.transcriptLines[0], "Line 3");
  assert.equal(newState.transcriptLines[1], "Line 4");
  assert.equal(newState.transcriptLines[2], "Line 5");
});

test("transcript_chunk event updates progress mode", () => {
  const state = createInitialPipelineState();

  const newState = pipelineStateReducer(state, {
    type: "transcript_chunk",
    event: {
      meta: { progressMode: "explicit" }
    }
  });

  assert.equal(newState.progressMode, "explicit");
});

// ============================================================================
// Judge Round Event Tests
// ============================================================================

test("judge_round event adds review round", () => {
  const state = createInitialPipelineState();

  const newState = pipelineStateReducer(state, {
    type: "judge_round",
    event: {
      round: 1,
      approved: false,
      reasons: ["Missing required section"],
      required_changes: ["Add executive summary"]
    }
  });

  assert.equal(newState.reviewRounds.length, 1);
  assert.equal(newState.reviewRounds[0].round, 1);
  assert.equal(newState.reviewRounds[0].approved, false);
  assert.deepEqual(newState.reviewRounds[0].reasons, ["Missing required section"]);
  assert.deepEqual(newState.reviewRounds[0].requiredChanges, ["Add executive summary"]);
});

test("judge_round event replaces existing round", () => {
  const state = createInitialPipelineState();
  state.reviewRounds = [
    { round: 1, approved: false, reasons: ["Old reason"], requiredChanges: [] }
  ];

  const newState = pipelineStateReducer(state, {
    type: "judge_round",
    event: {
      round: 1,
      approved: true,
      reasons: ["Looks good"],
      required_changes: []
    }
  });

  assert.equal(newState.reviewRounds.length, 1);
  assert.equal(newState.reviewRounds[0].approved, true);
  assert.deepEqual(newState.reviewRounds[0].reasons, ["Looks good"]);
});

test("judge_round event limits to 4 rounds", () => {
  const state = createInitialPipelineState();

  let newState = state;
  for (let i = 1; i <= 5; i++) {
    newState = pipelineStateReducer(newState, {
      type: "judge_round",
      event: {
        round: i,
        approved: false,
        reasons: [`Round ${i}`],
        required_changes: []
      }
    });
  }

  assert.equal(newState.reviewRounds.length, 4);
  assert.equal(newState.reviewRounds[0].round, 2);
  assert.equal(newState.reviewRounds[3].round, 5);
});

// ============================================================================
// Cost Event Tests
// ============================================================================

test("cost event updates cost state", () => {
  const state = createInitialPipelineState();

  const newState = pipelineStateReducer(state, {
    type: "cost",
    event: {
      summary: {
        totalTokens: 10000,
        estimatedCostUSD: 0.15,
        breakdown: { inputTokens: 5000, outputTokens: 5000 }
      }
    }
  });

  assert.equal(newState.cost.tokens, 10000);
  assert.equal(newState.cost.usd, 0.15);
  assert.deepEqual(newState.cost.breakdown, { inputTokens: 5000, outputTokens: 5000 });
});

// ============================================================================
// Final Event Tests
// ============================================================================

test("final event updates final draft and docx paths", () => {
  const state = createInitialPipelineState();

  const newState = pipelineStateReducer(state, {
    type: "final",
    event: {
      ok: true,
      draft: "Final PIP content",
      docx: "/path/to/pip.docx",
      docxRelative: "output/pip.docx"
    }
  });

  assert.equal(newState.finalDraft, "Final PIP content");
  assert.equal(newState.docxPath, "/path/to/pip.docx");
  assert.equal(newState.docxRelativePath, "output/pip.docx");
});

test("final event updates draft preview lines from final draft", () => {
  const state = createInitialPipelineState();

  const newState = pipelineStateReducer(state, {
    type: "final",
    event: {
      ok: true,
      draft: "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
    }
  });

  assert.equal(newState.draftPreviewLines.length, 3);
  assert.equal(newState.draftPreviewLines[0], "Line 3");
  assert.equal(newState.draftPreviewLines[1], "Line 4");
  assert.equal(newState.draftPreviewLines[2], "Line 5");
  assert.equal(newState.draftPreviewStatus, "complete");
});

// ============================================================================
// Draft Stream Event Tests
// ============================================================================

test("draft_stream_reset event resets draft preview", () => {
  const state = createInitialPipelineState();
  state.draftPreviewLines = ["Old line"];
  state.draftPreviewStatus = "complete";

  const newState = pipelineStateReducer(state, {
    type: "draft_stream_reset",
    event: {}
  });

  assert.equal(newState.draftPreviewStatus, "streaming");
  assert.deepEqual(newState.draftPreviewLines, []);
});

test("draft_stream_delta event sets streaming status", () => {
  const state = createInitialPipelineState();

  const newState = pipelineStateReducer(state, {
    type: "draft_stream_delta",
    event: { text: "Some text" }
  });

  assert.equal(newState.draftPreviewStatus, "streaming");
});

test("draft_stream_complete event sets complete status", () => {
  const state = createInitialPipelineState();
  state.draftPreviewStatus = "streaming";

  const newState = pipelineStateReducer(state, {
    type: "draft_stream_complete",
    event: {}
  });

  assert.equal(newState.draftPreviewStatus, "complete");
});

// ============================================================================
// Draft Preview Chunk Event Tests
// ============================================================================

test("draft_preview_chunk event adds line to preview", () => {
  const state = createInitialPipelineState();

  const newState = pipelineStateReducer(state, {
    type: "draft_preview_chunk",
    event: { text: "Preview line 1" }
  });

  assert.equal(newState.draftPreviewLines.length, 1);
  assert.equal(newState.draftPreviewLines[0], "Preview line 1");
  assert.equal(newState.draftPreviewStatus, "streaming");
});

test("draft_preview_chunk event updates specific index", () => {
  const state = createInitialPipelineState();
  state.draftPreviewLines = ["Line 1", "Line 2"];

  const newState = pipelineStateReducer(state, {
    type: "draft_preview_chunk",
    event: { text: "Updated line", index: 1 }
  });

  assert.equal(newState.draftPreviewLines[1], "Updated line");
});

test("draft_preview_chunk event limits to last 3 lines", () => {
  const state = createInitialPipelineState();

  let newState = state;
  for (let i = 1; i <= 5; i++) {
    newState = pipelineStateReducer(newState, {
      type: "draft_preview_chunk",
      event: { text: `Line ${i}` }
    });
  }

  assert.equal(newState.draftPreviewLines.length, 3);
  assert.equal(newState.draftPreviewLines[0], "Line 3");
  assert.equal(newState.draftPreviewLines[2], "Line 5");
});

test("draft_preview_complete event sets complete status", () => {
  const state = createInitialPipelineState();
  state.draftPreviewStatus = "streaming";

  const newState = pipelineStateReducer(state, {
    type: "draft_preview_complete",
    event: {}
  });

  assert.equal(newState.draftPreviewStatus, "complete");
});

// ============================================================================
// Stream Error Event Tests
// ============================================================================

test("stream_error event marks all running steps as error", () => {
  const state = createInitialPipelineState();
  state.steps.transcribe = "running";
  state.steps.draft = "running";
  state.steps.review = "pending";

  const newState = pipelineStateReducer(state, {
    type: "stream_error"
  });

  assert.equal(newState.steps.transcribe, "error");
  assert.equal(newState.steps.draft, "error");
  assert.equal(newState.steps.review, "pending");
});

// ============================================================================
// Progress Calculation Tests
// ============================================================================

test("computeOverallProgress calculates 0% for initial state", () => {
  const state = createInitialPipelineState();
  const progress = computeOverallProgress(state);
  assert.equal(progress, 0);
});

test("computeOverallProgress calculates transcribe progress from chunks", () => {
  const state = createInitialPipelineState();
  state.steps.transcribe = "running";
  state.chunks = { processed: 5, total: 10 };

  const progress = computeOverallProgress(state);
  assert.equal(progress, 25); // 50% of transcribe (50% weight) = 25%
});

test("computeOverallProgress gives 50% when transcribe completes", () => {
  const state = createInitialPipelineState();
  state.steps.transcribe = "success";

  const progress = computeOverallProgress(state);
  assert.equal(progress, 50);
});

test("computeOverallProgress gives 75% when transcribe and draft complete", () => {
  const state = createInitialPipelineState();
  state.steps.transcribe = "success";
  state.steps.draft = "success";

  const progress = computeOverallProgress(state);
  assert.equal(progress, 75);
});

test("computeOverallProgress gives 100% when all steps complete", () => {
  const state = createInitialPipelineState();
  state.steps.transcribe = "success";
  state.steps.draft = "success";
  state.steps.review = "success";
  state.steps.export = "success";

  const progress = computeOverallProgress(state);
  assert.equal(progress, 100);
});

test("computeOverallProgress calculates draft streaming progress", () => {
  const state = createInitialPipelineState();
  state.steps.transcribe = "success";
  state.steps.draft = "running";
  state.draftPreviewStatus = "streaming";

  const progress = computeOverallProgress(state);
  assert.equal(progress, 70); // 50 (transcribe) + 20 (draft streaming)
});

test("computeOverallProgress calculates review rounds progress", () => {
  const state = createInitialPipelineState();
  state.steps.transcribe = "success";
  state.steps.draft = "success";
  state.steps.review = "running";
  state.reviewRounds = [
    { round: 1, approved: false, reasons: [], requiredChanges: [] },
    { round: 2, approved: false, reasons: [], requiredChanges: [] }
  ];

  const progress = computeOverallProgress(state);
  assert.equal(progress, 83); // 50 + 25 + ~8 (2/4 rounds * 15)
});
