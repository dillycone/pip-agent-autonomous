import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PizZip from "pizzip";

import {
  isValidDocx,
  extractModelFamilyFromContent,
  renameDocxWithModelFamily,
  validateExportPhase,
  handleWorkerErrorRecovery,
  parseFinalResult,
  processFinalResult,
  toSerializableError,
  type DocxValidationResult,
  type ModelFamilyResult
} from "../../src/pipeline/outputValidation.js";

// Get current file directory for test fixtures
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, "fixtures");

// ============================================================================
// Test Fixtures Setup
// ============================================================================

function createMockEmitter(): {
  emit: (event: string, data: unknown) => void;
  events: Array<{ event: string; data: unknown }>;
} {
  const events: Array<{ event: string; data: unknown }> = [];
  return {
    emit: (event: string, data: unknown) => {
      events.push({ event, data });
    },
    events
  };
}

function createMockSendStatus(): {
  sendStatus: (step: string, status: string, meta?: Record<string, unknown>) => void;
  statusUpdates: Array<{ step: string; status: string; meta?: Record<string, unknown> }>;
} {
  const statusUpdates: Array<{ step: string; status: string; meta?: Record<string, unknown> }> = [];
  return {
    sendStatus: (step: string, status: string, meta?: Record<string, unknown>) => {
      statusUpdates.push({ step, status, meta });
    },
    statusUpdates
  };
}

function createValidDocxBuffer(): Buffer {
  const zip = new PizZip();

  // Add required DOCX entries
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships></Relationships>');
  zip.file("word/document.xml", '<?xml version="1.0"?><document></document>');

  return zip.generate({ type: "nodebuffer" }) as Buffer;
}

function createTestDocx(filename: string): string {
  const testDir = path.join(__dirname, "temp");
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const filepath = path.join(testDir, filename);
  const buffer = createValidDocxBuffer();
  fs.writeFileSync(filepath, buffer);

  return filepath;
}

function cleanupTestFile(filepath: string): void {
  try {
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
  } catch (error) {
    // Ignore cleanup errors
  }
}

// ============================================================================
// isValidDocx Tests
// ============================================================================

test("isValidDocx returns false for non-existent file", () => {
  const failureReason: { reason?: string } = {};
  const result = isValidDocx("/path/to/nonexistent.docx", failureReason);

  assert.equal(result, false);
  assert.equal(failureReason.reason, "DOCX file is missing");
});

test("isValidDocx returns false for empty file", () => {
  const testDir = path.join(__dirname, "temp");
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const filepath = path.join(testDir, "empty.docx");
  fs.writeFileSync(filepath, Buffer.alloc(0));

  const failureReason: { reason?: string } = {};
  const result = isValidDocx(filepath, failureReason);

  assert.equal(result, false);
  assert.equal(failureReason.reason, "DOCX file is empty");

  cleanupTestFile(filepath);
});

test("isValidDocx returns true for valid DOCX", () => {
  const filepath = createTestDocx("valid.docx");

  const result = isValidDocx(filepath);

  assert.equal(result, true);

  cleanupTestFile(filepath);
});

test("isValidDocx returns false for DOCX missing required entries", () => {
  const testDir = path.join(__dirname, "temp");
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const filepath = path.join(testDir, "invalid.docx");

  // Create incomplete DOCX
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types></Types>');
  // Missing other required files
  const buffer = zip.generate({ type: "nodebuffer" }) as Buffer;
  fs.writeFileSync(filepath, buffer);

  const failureReason: { reason?: string } = {};
  const result = isValidDocx(filepath, failureReason);

  assert.equal(result, false);
  assert.ok(failureReason.reason?.includes("Missing required entry"));

  cleanupTestFile(filepath);
});

test("isValidDocx handles corrupted files gracefully", () => {
  const testDir = path.join(__dirname, "temp");
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const filepath = path.join(testDir, "corrupted.docx");
  fs.writeFileSync(filepath, "not a valid zip file");

  const failureReason: { reason?: string } = {};
  const result = isValidDocx(filepath, failureReason);

  assert.equal(result, false);
  assert.ok(failureReason.reason);

  cleanupTestFile(filepath);
});

// ============================================================================
// extractModelFamilyFromContent Tests
// ============================================================================

test("extractModelFamilyFromContent extracts from string", () => {
  const result = extractModelFamilyFromContent("claude-sonnet-4.5-20250514");

  assert.equal(result.model, "claude-sonnet-4.5-20250514");
  assert.equal(result.modelFamily, "claude-sonnet");
});

test("extractModelFamilyFromContent extracts from object with model field", () => {
  const result = extractModelFamilyFromContent({
    model: "claude-sonnet-4.5-20250514"
  });

  assert.equal(result.model, "claude-sonnet-4.5-20250514");
  assert.equal(result.modelFamily, "claude-sonnet");
});

test("extractModelFamilyFromContent extracts from object with modelId field", () => {
  const result = extractModelFamilyFromContent({
    modelId: "claude-opus-4-20250514"
  });

  assert.equal(result.model, "claude-opus-4-20250514");
  assert.equal(result.modelFamily, "claude-opus");
});

test("extractModelFamilyFromContent extracts from object with draft_model field", () => {
  const result = extractModelFamilyFromContent({
    draft_model: "claude-haiku-4-20250514"
  });

  assert.equal(result.model, "claude-haiku-4-20250514");
  assert.equal(result.modelFamily, "claude-haiku");
});

test("extractModelFamilyFromContent extracts from nested usage object", () => {
  const result = extractModelFamilyFromContent({
    usage: {
      model: "claude-sonnet-4.5-20250514"
    }
  });

  assert.equal(result.model, "claude-sonnet-4.5-20250514");
  assert.equal(result.modelFamily, "claude-sonnet");
});

test("extractModelFamilyFromContent returns null for invalid input", () => {
  const result = extractModelFamilyFromContent(null);

  assert.equal(result.model, null);
  assert.equal(result.modelFamily, null);
});

test("extractModelFamilyFromContent returns null for object without model", () => {
  const result = extractModelFamilyFromContent({
    someOtherField: "value"
  });

  assert.equal(result.model, null);
  assert.equal(result.modelFamily, null);
});

// ============================================================================
// renameDocxWithModelFamily Tests
// ============================================================================

test("renameDocxWithModelFamily returns original path when no model family", () => {
  const filepath = createTestDocx("test.docx");
  const emitter = createMockEmitter();

  const result = renameDocxWithModelFamily(filepath, null, emitter.emit);

  assert.equal(result, filepath);

  cleanupTestFile(filepath);
});

test("renameDocxWithModelFamily renames file with model family", () => {
  const filepath = createTestDocx("test.docx");
  const emitter = createMockEmitter();

  const result = renameDocxWithModelFamily(filepath, "claude-sonnet", emitter.emit);

  assert.ok(result.includes("claude-sonnet"));
  assert.ok(fs.existsSync(result));

  cleanupTestFile(filepath);
  cleanupTestFile(result);
});

test("renameDocxWithModelFamily logs rename action", () => {
  const filepath = createTestDocx("test.docx");
  const emitter = createMockEmitter();

  renameDocxWithModelFamily(filepath, "claude-sonnet", emitter.emit);

  const logEvent = emitter.events.find(e => e.event === "log");
  assert.ok(logEvent);
  const data = logEvent.data as any;
  assert.equal(data.level, "info");
  assert.ok(data.message.includes("Renamed DOCX"));

  cleanupTestFile(filepath);
});

test("renameDocxWithModelFamily handles non-existent source file", () => {
  const emitter = createMockEmitter();

  const result = renameDocxWithModelFamily("/path/to/nonexistent.docx", "claude-sonnet", emitter.emit);

  assert.equal(result, "/path/to/nonexistent.docx");

  const warnEvent = emitter.events.find(e => {
    const data = e.data as any;
    return e.event === "log" && data.level === "warn";
  });
  assert.ok(warnEvent);
});

test("renameDocxWithModelFamily handles existing target file", () => {
  const filepath = createTestDocx("test.docx");
  const emitter = createMockEmitter();

  // First rename
  const result1 = renameDocxWithModelFamily(filepath, "claude-sonnet", emitter.emit);

  // Create another file to rename with same model
  const filepath2 = createTestDocx("test2.docx");
  const result2 = renameDocxWithModelFamily(filepath2, "claude-sonnet", emitter.emit);

  // Should create unique filename
  assert.notEqual(result1, result2);
  assert.ok(fs.existsSync(result1));
  assert.ok(fs.existsSync(result2));

  cleanupTestFile(filepath);
  cleanupTestFile(filepath2);
  cleanupTestFile(result1);
  cleanupTestFile(result2);
});

// ============================================================================
// validateExportPhase Tests
// ============================================================================

test("validateExportPhase returns invalid for non-existent file", () => {
  const emitter = createMockEmitter();

  const result = validateExportPhase("/path/to/nonexistent.docx", emitter.emit);

  assert.equal(result.valid, false);
  assert.equal(result.reason, "Output file does not exist");
});

test("validateExportPhase returns valid for valid DOCX", () => {
  const filepath = createTestDocx("valid.docx");
  const emitter = createMockEmitter();

  const result = validateExportPhase(filepath, emitter.emit);

  assert.equal(result.valid, true);

  cleanupTestFile(filepath);
});

test("validateExportPhase logs validation success", () => {
  const filepath = createTestDocx("valid.docx");
  const emitter = createMockEmitter();

  validateExportPhase(filepath, emitter.emit);

  const logEvent = emitter.events.find(e => {
    const data = e.data as any;
    return e.event === "log" && data.level === "info" && data.message.includes("validated successfully");
  });
  assert.ok(logEvent);

  cleanupTestFile(filepath);
});

// ============================================================================
// handleWorkerErrorRecovery Tests
// ============================================================================

test("handleWorkerErrorRecovery returns not recovered for non-existent file", () => {
  const emitter = createMockEmitter();
  const sender = createMockSendStatus();

  const result = handleWorkerErrorRecovery(
    "/path/to/nonexistent.docx",
    "/project/root",
    null,
    emitter.emit,
    sender.sendStatus
  );

  assert.equal(result.recovered, false);
});

test("handleWorkerErrorRecovery succeeds for valid output", () => {
  const filepath = createTestDocx("recovered.docx");
  const emitter = createMockEmitter();
  const sender = createMockSendStatus();

  const result = handleWorkerErrorRecovery(
    filepath,
    path.dirname(filepath),
    null,
    emitter.emit,
    sender.sendStatus
  );

  assert.equal(result.recovered, true);
  assert.ok(result.finalDocxPath);
  assert.ok(result.docxRelative);

  cleanupTestFile(filepath);
});

test("handleWorkerErrorRecovery updates export status on recovery", () => {
  const filepath = createTestDocx("recovered.docx");
  const emitter = createMockEmitter();
  const sender = createMockSendStatus();

  handleWorkerErrorRecovery(
    filepath,
    path.dirname(filepath),
    null,
    emitter.emit,
    sender.sendStatus
  );

  assert.equal(sender.statusUpdates.length, 1);
  assert.equal(sender.statusUpdates[0].step, "export");
  assert.equal(sender.statusUpdates[0].status, "success");

  cleanupTestFile(filepath);
});

// ============================================================================
// parseFinalResult Tests
// ============================================================================

test("parseFinalResult parses JSON string", () => {
  const jsonParseFailures: Array<{ source: string; raw: string; error: unknown }> = [];
  const logJsonParseFailure = (source: string, raw: string, error: unknown) => {
    jsonParseFailures.push({ source, raw, error });
  };

  const result = parseFinalResult('{"status": "ok", "draft": "content"}', logJsonParseFailure);

  assert.deepEqual(result, { status: "ok", draft: "content" });
  assert.equal(jsonParseFailures.length, 0);
});

test("parseFinalResult removes JSON code fences", () => {
  const jsonParseFailures: Array<{ source: string; raw: string; error: unknown }> = [];
  const logJsonParseFailure = (source: string, raw: string, error: unknown) => {
    jsonParseFailures.push({ source, raw, error });
  };

  const result = parseFinalResult('```json\n{"status": "ok"}\n```', logJsonParseFailure);

  assert.deepEqual(result, { status: "ok" });
});

test("parseFinalResult returns original on parse error", () => {
  const jsonParseFailures: Array<{ source: string; raw: string; error: unknown }> = [];
  const logJsonParseFailure = (source: string, raw: string, error: unknown) => {
    jsonParseFailures.push({ source, raw, error });
  };

  const result = parseFinalResult("not valid json", logJsonParseFailure);

  assert.equal(result, "not valid json");
  assert.equal(jsonParseFailures.length, 1);
});

test("parseFinalResult returns non-string input as-is", () => {
  const jsonParseFailures: Array<{ source: string; raw: string; error: unknown }> = [];
  const logJsonParseFailure = (source: string, raw: string, error: unknown) => {
    jsonParseFailures.push({ source, raw, error });
  };

  const input = { status: "ok" };
  const result = parseFinalResult(input, logJsonParseFailure);

  assert.deepEqual(result, input);
});

// ============================================================================
// processFinalResult Tests
// ============================================================================

test("processFinalResult returns failure for non-object payload", () => {
  const emitter = createMockEmitter();
  const sender = createMockSendStatus();

  const result = processFinalResult(
    "not an object",
    "/output/path.docx",
    "/project/root",
    null,
    emitter.emit,
    sender.sendStatus
  );

  assert.equal(result.success, false);
});

test("processFinalResult returns failure for non-ok status", () => {
  const emitter = createMockEmitter();
  const sender = createMockSendStatus();

  const result = processFinalResult(
    { status: "error" },
    "/output/path.docx",
    "/project/root",
    null,
    emitter.emit,
    sender.sendStatus
  );

  assert.equal(result.success, false);
});

test("processFinalResult processes successful result", () => {
  const filepath = createTestDocx("output.docx");
  const emitter = createMockEmitter();
  const sender = createMockSendStatus();

  const result = processFinalResult(
    { status: "ok", draft: "PIP content", docx: filepath },
    filepath,
    path.dirname(filepath),
    null,
    emitter.emit,
    sender.sendStatus
  );

  assert.equal(result.success, true);
  assert.equal(result.draft, "PIP content");
  assert.ok(result.finalDocxPath);
  assert.ok(result.docxRelative);

  cleanupTestFile(filepath);
});

test("processFinalResult updates export status", () => {
  const filepath = createTestDocx("output.docx");
  const emitter = createMockEmitter();
  const sender = createMockSendStatus();

  processFinalResult(
    { status: "ok", draft: "PIP content" },
    filepath,
    path.dirname(filepath),
    null,
    emitter.emit,
    sender.sendStatus
  );

  assert.equal(sender.statusUpdates.length, 1);
  assert.equal(sender.statusUpdates[0].step, "export");
  assert.equal(sender.statusUpdates[0].status, "success");

  cleanupTestFile(filepath);
});

// ============================================================================
// toSerializableError Tests
// ============================================================================

test("toSerializableError converts Error instance", () => {
  const error = new Error("Test error");
  const result = toSerializableError(error);

  assert.equal(result.name, "Error");
  assert.equal(result.message, "Test error");
  assert.equal(result.stack, undefined); // Stack should be removed
});

test("toSerializableError converts string error", () => {
  const result = toSerializableError("Error message");

  assert.equal(result.message, "Error message");
});

test("toSerializableError converts object error", () => {
  const error = { message: "Custom error", code: 500, stack: "..." };
  const result = toSerializableError(error);

  assert.equal(result.message, "Custom error");
  assert.equal(result.code, 500);
  assert.equal(result.stack, undefined); // Stack should be removed
});

test("toSerializableError converts unknown types", () => {
  const result = toSerializableError(42);

  assert.equal(result.message, "42");
});

test("toSerializableError removes stack from TypeError", () => {
  const error = new TypeError("Type error");
  const result = toSerializableError(error);

  assert.equal(result.name, "TypeError");
  assert.equal(result.message, "Type error");
  assert.equal(result.stack, undefined);
});
