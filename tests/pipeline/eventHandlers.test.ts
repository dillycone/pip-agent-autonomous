import assert from "node:assert/strict";
import { test } from "node:test";

import {
  handleToolUseEvent,
  handleToolResultEvent,
  handleJudgeVerdictEvent,
  extractJsonBlock,
  type EventHandlerContext,
  type TranscriptionState,
  type DraftState,
  type JudgeState,
  type InflightTracking
} from "../../src/pipeline/eventHandlers.js";

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockContext(): EventHandlerContext & {
  emittedEvents: Array<{ event: string; data: unknown }>;
  statusUpdates: Array<{ step: string; status: string; meta?: Record<string, unknown> }>;
  costRecords: Array<Record<string, number>>;
  draftModel: unknown;
  jsonParseFailures: Array<{ source: string; raw: string; error: unknown }>;
} {
  const emittedEvents: Array<{ event: string; data: unknown }> = [];
  const statusUpdates: Array<{ step: string; status: string; meta?: Record<string, unknown> }> = [];
  const costRecords: Array<Record<string, number>> = [];
  const jsonParseFailures: Array<{ source: string; raw: string; error: unknown }> = [];
  let draftModel: unknown = null;

  return {
    emit: (event: string, data: unknown) => {
      emittedEvents.push({ event, data });
    },
    sendStatus: (step: string, status: string, meta?: Record<string, unknown>) => {
      statusUpdates.push({ step, status, meta });
    },
    costTracker: {
      recordTotals: (tokens: Record<string, number>) => {
        costRecords.push(tokens);
      }
    },
    pushCost: () => {},
    updateDraftModel: (candidate: unknown) => {
      draftModel = candidate;
    },
    logJsonParseFailure: (source: string, raw: string, error: unknown) => {
      jsonParseFailures.push({ source, raw, error });
    },
    emittedEvents,
    statusUpdates,
    costRecords,
    get draftModel() { return draftModel; },
    jsonParseFailures
  };
}

function createMockInflightTracking(): InflightTracking & {
  items: Map<string, { id: string; name?: string; startedAt: string }>;
} {
  const items = new Map<string, { id: string; name?: string; startedAt: string }>();

  return {
    inflightMap: items,
    pushInflight: (candidateId?: string, name?: string) => {
      const id = candidateId || `auto-${Date.now()}-${Math.random()}`;
      const item = { id, name, startedAt: new Date().toISOString() };
      items.set(id, item);
      return item;
    },
    takeInflight: (candidateId?: string, name?: string) => {
      if (candidateId && items.has(candidateId)) {
        const item = items.get(candidateId)!;
        items.delete(candidateId);
        return item;
      }
      return undefined;
    },
    items
  };
}

function createTranscriptionState(): TranscriptionState {
  return {
    transcribeProcessed: 0,
    transcribeTotal: null,
    transcriptAccumulator: "",
    chunkSnippets: new Map(),
    processedProgressSource: "heuristic",
    totalProgressSource: "heuristic"
  };
}

function createDraftState(): DraftState {
  return {
    draftPreviewEmitted: false,
    previewTimeouts: []
  };
}

function createJudgeState(): JudgeState {
  return {
    judgeRound: 0,
    maxRounds: 4
  };
}

// ============================================================================
// handleToolUseEvent Tests
// ============================================================================

test("handleToolUseEvent emits tool_use event", () => {
  const context = createMockContext();
  const inflight = createMockInflightTracking();

  handleToolUseEvent(
    { id: "tool-123", name: "test-tool", input: {} },
    context,
    inflight,
    false
  );

  assert.equal(context.emittedEvents.length, 1);
  assert.equal(context.emittedEvents[0].event, "tool_use");
  const data = context.emittedEvents[0].data as any;
  assert.equal(data.id, "tool-123");
  assert.equal(data.name, "test-tool");
});

test("handleToolUseEvent tracks gemini-transcriber and updates status", () => {
  const context = createMockContext();
  const inflight = createMockInflightTracking();

  handleToolUseEvent(
    { id: "tool-123", name: "gemini-transcriber", input: {} },
    context,
    inflight,
    false
  );

  assert.equal(context.statusUpdates.length, 1);
  assert.equal(context.statusUpdates[0].step, "transcribe");
  assert.equal(context.statusUpdates[0].status, "running");
});

test("handleToolUseEvent tracks pip-generator and updates status", () => {
  const context = createMockContext();
  const inflight = createMockInflightTracking();

  handleToolUseEvent(
    { id: "tool-456", name: "pip-generator", input: { model: "claude-sonnet-4.5" } },
    context,
    inflight,
    false
  );

  assert.equal(context.statusUpdates.length, 2);
  assert.equal(context.statusUpdates[0].step, "transcribe");
  assert.equal(context.statusUpdates[0].status, "success");
  assert.equal(context.statusUpdates[1].step, "draft");
  assert.equal(context.statusUpdates[1].status, "running");
});

test("handleToolUseEvent emits draft stream reset when streaming enabled", () => {
  const context = createMockContext();
  const inflight = createMockInflightTracking();
  const emittedStreamEvents: Array<{ event: string; data: Record<string, unknown> }> = [];

  const emitDraftStreamEvent = (event: string, data: Record<string, unknown>) => {
    emittedStreamEvents.push({ event, data });
  };

  handleToolUseEvent(
    { id: "tool-456", name: "pip-generator", input: {} },
    context,
    inflight,
    true,
    emitDraftStreamEvent,
    "run-123"
  );

  assert.equal(emittedStreamEvents.length, 1);
  assert.equal(emittedStreamEvents[0].event, "reset");
  assert.equal((emittedStreamEvents[0].data as any).runId, "run-123");
});

test("handleToolUseEvent extracts model from pip-generator input", () => {
  const context = createMockContext();
  const inflight = createMockInflightTracking();

  handleToolUseEvent(
    { id: "tool-456", name: "pip-generator", input: { model: "claude-sonnet-4.5" } },
    context,
    inflight,
    false
  );

  assert.equal(context.draftModel, "claude-sonnet-4.5");
});

test("handleToolUseEvent tracks docx-exporter and updates status", () => {
  const context = createMockContext();
  const inflight = createMockInflightTracking();

  handleToolUseEvent(
    { id: "tool-789", name: "docx-exporter", input: {} },
    context,
    inflight,
    false
  );

  assert.equal(context.statusUpdates.length, 3);
  assert.equal(context.statusUpdates[0].step, "draft");
  assert.equal(context.statusUpdates[0].status, "success");
  assert.equal(context.statusUpdates[1].step, "review");
  assert.equal(context.statusUpdates[1].status, "success");
  assert.equal(context.statusUpdates[2].step, "export");
  assert.equal(context.statusUpdates[2].status, "running");
});

test("handleToolUseEvent handles TodoWrite tool", () => {
  const context = createMockContext();
  const inflight = createMockInflightTracking();

  handleToolUseEvent(
    {
      id: "tool-todo",
      name: "TodoWrite",
      input: { todos: [{ content: "Task 1", status: "pending" }] }
    },
    context,
    inflight,
    false
  );

  assert.equal(context.emittedEvents.length, 2);
  assert.equal(context.emittedEvents[1].event, "todo");
  const data = context.emittedEvents[1].data as any;
  assert.deepEqual(data.todos, [{ content: "Task 1", status: "pending" }]);
});

// ============================================================================
// handleToolResultEvent Tests
// ============================================================================

test("handleToolResultEvent emits tool_result event", () => {
  const context = createMockContext();
  const inflight = createMockInflightTracking();
  const transcriptionState = createTranscriptionState();
  const draftState = createDraftState();

  handleToolResultEvent(
    { id: "tool-123", name: "test-tool", isError: false },
    context,
    inflight,
    transcriptionState,
    draftState,
    false
  );

  assert.equal(context.emittedEvents.length, 1);
  assert.equal(context.emittedEvents[0].event, "tool_result");
});

test("handleToolResultEvent updates gemini-transcriber status on success", () => {
  const context = createMockContext();
  const inflight = createMockInflightTracking();
  const transcriptionState = createTranscriptionState();
  const draftState = createDraftState();

  handleToolResultEvent(
    { id: "tool-123", name: "gemini-transcriber", isError: false },
    context,
    inflight,
    transcriptionState,
    draftState,
    false
  );

  assert.equal(context.statusUpdates.length, 2);
  assert.equal(context.statusUpdates[0].step, "transcribe");
  assert.equal(context.statusUpdates[0].status, "success");
  assert.equal(context.statusUpdates[1].step, "draft");
  assert.equal(context.statusUpdates[1].status, "running");
});

test("handleToolResultEvent updates gemini-transcriber status on error", () => {
  const context = createMockContext();
  const inflight = createMockInflightTracking();
  const transcriptionState = createTranscriptionState();
  const draftState = createDraftState();

  handleToolResultEvent(
    { id: "tool-123", name: "gemini-transcriber", isError: true, content: "Error" },
    context,
    inflight,
    transcriptionState,
    draftState,
    false
  );

  assert.equal(context.statusUpdates.length, 1);
  assert.equal(context.statusUpdates[0].step, "transcribe");
  assert.equal(context.statusUpdates[0].status, "error");
});

test("handleToolResultEvent extracts transcription progress", () => {
  const context = createMockContext();
  const inflight = createMockInflightTracking();
  const transcriptionState = createTranscriptionState();
  const draftState = createDraftState();

  const result = handleToolResultEvent(
    {
      id: "tool-123",
      name: "gemini-transcriber",
      isError: false,
      content: [{
        text: JSON.stringify({
          transcript: "Hello world",
          processedChunks: 5,
          totalChunks: 10
        })
      }]
    },
    context,
    inflight,
    transcriptionState,
    draftState,
    false
  );

  assert.equal(result.transcriptionState.transcribeProcessed, 5);
  assert.equal(result.transcriptionState.transcribeTotal, 10);
  assert.ok(result.transcriptionState.transcriptAccumulator.includes("Hello world"));
});

test("handleToolResultEvent emits transcript_chunk event", () => {
  const context = createMockContext();
  const inflight = createMockInflightTracking();
  const transcriptionState = createTranscriptionState();
  const draftState = createDraftState();

  handleToolResultEvent(
    {
      id: "tool-123",
      name: "gemini-transcriber",
      isError: false,
      content: [{
        text: JSON.stringify({
          transcript: "Hello world",
          processedChunks: 5,
          totalChunks: 10
        })
      }]
    },
    context,
    inflight,
    transcriptionState,
    draftState,
    false
  );

  const transcriptEvent = context.emittedEvents.find(e => e.event === "transcript_chunk");
  assert.ok(transcriptEvent);
  const data = transcriptEvent.data as any;
  assert.equal(data.processedChunks, 5);
  assert.equal(data.totalChunks, 10);
});

test("handleToolResultEvent extracts draft model from pip-generator", () => {
  const context = createMockContext();
  const inflight = createMockInflightTracking();
  const transcriptionState = createTranscriptionState();
  const draftState = createDraftState();

  handleToolResultEvent(
    {
      id: "tool-456",
      name: "pip-generator",
      isError: false,
      content: [{
        text: JSON.stringify({
          model: "claude-sonnet-4.5",
          draft: "PIP content"
        })
      }]
    },
    context,
    inflight,
    transcriptionState,
    draftState,
    false
  );

  assert.equal(context.draftModel, "claude-sonnet-4.5");
});

test("handleToolResultEvent emits draft preview chunks in non-streaming mode", (t, done) => {
  const context = createMockContext();
  const inflight = createMockInflightTracking();
  const transcriptionState = createTranscriptionState();
  const draftState = createDraftState();

  handleToolResultEvent(
    {
      id: "tool-456",
      name: "pip-generator",
      isError: false,
      content: [{
        text: JSON.stringify({
          draft: "Line 1\nLine 2\nLine 3"
        })
      }]
    },
    context,
    inflight,
    transcriptionState,
    draftState,
    false
  );

  // Wait for async preview emissions
  setTimeout(() => {
    const previewEvents = context.emittedEvents.filter(e => e.event === "draft_preview_chunk");
    assert.equal(previewEvents.length, 3);

    const completeEvent = context.emittedEvents.find(e => e.event === "draft_preview_complete");
    assert.ok(completeEvent);

    // Clean up timeouts
    draftState.previewTimeouts.forEach(clearTimeout);
    done();
  }, 500);
});

test("handleToolResultEvent records Gemini usage metrics", () => {
  const context = createMockContext();
  const inflight = createMockInflightTracking();
  const transcriptionState = createTranscriptionState();
  const draftState = createDraftState();

  handleToolResultEvent(
    {
      id: "tool-123",
      name: "gemini-transcriber",
      isError: false,
      content: [{
        text: JSON.stringify({
          usage: {
            provider: "gemini",
            inputTokens: 1000,
            outputTokens: 500
          }
        })
      }]
    },
    context,
    inflight,
    transcriptionState,
    draftState,
    false
  );

  assert.equal(context.costRecords.length, 1);
  assert.equal(context.costRecords[0].geminiInputTokens, 1000);
  assert.equal(context.costRecords[0].geminiOutputTokens, 500);
});

test("handleToolResultEvent records Claude usage metrics", () => {
  const context = createMockContext();
  const inflight = createMockInflightTracking();
  const transcriptionState = createTranscriptionState();
  const draftState = createDraftState();

  handleToolResultEvent(
    {
      id: "tool-456",
      name: "pip-generator",
      isError: false,
      content: [{
        text: JSON.stringify({
          usage: {
            inputTokens: 2000,
            outputTokens: 1000,
            cacheCreationTokens: 500,
            cacheReadTokens: 250
          }
        })
      }]
    },
    context,
    inflight,
    transcriptionState,
    draftState,
    false
  );

  assert.equal(context.costRecords.length, 1);
  assert.equal(context.costRecords[0].inputTokens, 2000);
  assert.equal(context.costRecords[0].outputTokens, 1000);
  assert.equal(context.costRecords[0].cacheCreationTokens, 500);
  assert.equal(context.costRecords[0].cacheReadTokens, 250);
});

test("handleToolResultEvent emits error event on tool error", () => {
  const context = createMockContext();
  const inflight = createMockInflightTracking();
  const transcriptionState = createTranscriptionState();
  const draftState = createDraftState();

  handleToolResultEvent(
    {
      id: "tool-123",
      isError: true,
      content: { message: "Something went wrong" }
    },
    context,
    inflight,
    transcriptionState,
    draftState,
    false
  );

  const errorEvent = context.emittedEvents.find(e => e.event === "error");
  assert.ok(errorEvent);
  const data = errorEvent.data as any;
  assert.equal(data.message, "Tool error");
});

// ============================================================================
// handleJudgeVerdictEvent Tests
// ============================================================================

test("handleJudgeVerdictEvent emits judge_round event on approval", () => {
  const context = createMockContext();
  const judgeState = createJudgeState();

  const newState = handleJudgeVerdictEvent(
    JSON.stringify({
      approved: true,
      reasons: ["Meets all criteria"],
      required_changes: []
    }),
    judgeState,
    context
  );

  assert.equal(context.emittedEvents.length, 1);
  assert.equal(context.emittedEvents[0].event, "judge_round");
  const data = context.emittedEvents[0].data as any;
  assert.equal(data.approved, true);
  assert.equal(data.round, 1);
  assert.deepEqual(data.reasons, ["Meets all criteria"]);
});

test("handleJudgeVerdictEvent increments round counter", () => {
  const context = createMockContext();
  const judgeState = createJudgeState();

  const newState = handleJudgeVerdictEvent(
    JSON.stringify({ approved: false, reasons: [], required_changes: [] }),
    judgeState,
    context
  );

  assert.equal(newState.judgeRound, 1);
});

test("handleJudgeVerdictEvent sets review status to success on approval", () => {
  const context = createMockContext();
  const judgeState = createJudgeState();

  handleJudgeVerdictEvent(
    JSON.stringify({ approved: true, reasons: [], required_changes: [] }),
    judgeState,
    context
  );

  assert.equal(context.statusUpdates.length, 1);
  assert.equal(context.statusUpdates[0].step, "review");
  assert.equal(context.statusUpdates[0].status, "success");
});

test("handleJudgeVerdictEvent sets review status to running on rejection", () => {
  const context = createMockContext();
  const judgeState = createJudgeState();

  handleJudgeVerdictEvent(
    JSON.stringify({ approved: false, reasons: [], required_changes: [] }),
    judgeState,
    context
  );

  assert.equal(context.statusUpdates[0].status, "running");
});

test("handleJudgeVerdictEvent sets review status to error at max rounds", () => {
  const context = createMockContext();
  const judgeState = createJudgeState();
  judgeState.judgeRound = 3; // One away from max

  handleJudgeVerdictEvent(
    JSON.stringify({ approved: false, reasons: [], required_changes: [] }),
    judgeState,
    context
  );

  assert.equal(context.statusUpdates[0].status, "error");
});

test("handleJudgeVerdictEvent stops processing at max rounds", () => {
  const context = createMockContext();
  const judgeState = createJudgeState();
  judgeState.judgeRound = 4; // At max

  const newState = handleJudgeVerdictEvent(
    JSON.stringify({ approved: false, reasons: [], required_changes: [] }),
    judgeState,
    context
  );

  assert.equal(newState.judgeRound, 4);
  assert.equal(context.emittedEvents.length, 0);
});

test("handleJudgeVerdictEvent handles invalid JSON gracefully", () => {
  const context = createMockContext();
  const judgeState = createJudgeState();

  const newState = handleJudgeVerdictEvent(
    "not valid json",
    judgeState,
    context
  );

  assert.equal(newState.judgeRound, 0);
  assert.equal(context.jsonParseFailures.length, 1);
});

// ============================================================================
// extractJsonBlock Tests
// ============================================================================

test("extractJsonBlock extracts JSON from code fence", () => {
  const result = extractJsonBlock("```json\n{\"key\": \"value\"}\n```");
  assert.equal(result, '{"key": "value"}');
});

test("extractJsonBlock extracts JSON from code fence without language", () => {
  const result = extractJsonBlock("```\n{\"key\": \"value\"}\n```");
  assert.equal(result, '{"key": "value"}');
});

test("extractJsonBlock extracts plain JSON object", () => {
  const result = extractJsonBlock('{"key": "value"}');
  assert.equal(result, '{"key": "value"}');
});

test("extractJsonBlock extracts JSON from text with surrounding content", () => {
  const result = extractJsonBlock('Some text before {"key": "value"} and after');
  assert.equal(result, '{"key": "value"}');
});

test("extractJsonBlock returns null for empty string", () => {
  const result = extractJsonBlock("");
  assert.equal(result, null);
});

test("extractJsonBlock returns null for non-string input", () => {
  const result = extractJsonBlock(123);
  assert.equal(result, null);
});

test("extractJsonBlock returns null for string without JSON", () => {
  const result = extractJsonBlock("just plain text");
  assert.equal(result, null);
});
