import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
  normalizeLanguage,
  parseRunRequestBody,
  validateRunRequest
} from "../src/server/runRequestValidator.js";

const PROJECT_ROOT = path.resolve(".");

test("parseRunRequestBody trims whitespace and accepts optional fields", () => {
  const raw = {
    audio: "  uploads/meeting.mp3  ",
    template: " templates/pip-template.docx ",
    outdoc: " exports/output.docx ",
    inputLanguage: " en ",
    outputLanguage: " es "
  };

  const result = parseRunRequestBody(raw);

  assert.equal(result.ok, true);
  assert.equal(result.data.audio, "uploads/meeting.mp3");
  assert.equal(result.data.template, "templates/pip-template.docx");
  assert.equal(result.data.outdoc, "exports/output.docx");
  assert.equal(result.data.inputLanguage, "en");
  assert.equal(result.data.outputLanguage, "es");
});

test("parseRunRequestBody rejects non-string values", () => {
  const result = parseRunRequestBody({ audio: 123 });

  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.issues));
  assert.ok(result.issues.length > 0);
});

test("normalizeLanguage allows auto for input and enforces ISO pattern", () => {
  const auto = normalizeLanguage("Auto", { allowAuto: true });
  assert.equal(auto.valid, true);
  assert.equal(auto.value, "auto");

  const valid = normalizeLanguage("EN-us");
  assert.equal(valid.valid, true);
  assert.equal(valid.value, "en-us");

  const invalid = normalizeLanguage("english");
  assert.equal(invalid.valid, false);
});

test("validateRunRequest accepts valid paths and languages", () => {
  const result = validateRunRequest({
    audio: "uploads/meeting.mp3",
    template: "templates/pip-template.docx",
    outdoc: "exports/test-output.docx",
    inputLanguage: "auto",
    outputLanguage: "en",
    projectRoot: PROJECT_ROOT
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.audioPath.endsWith("uploads/meeting.mp3"));
    assert.ok(result.templatePath.endsWith("templates/pip-template.docx"));
    assert.ok(result.outputPath.endsWith("exports/test-output.docx"));
    assert.equal(result.inputLanguage, "auto");
    assert.equal(result.outputLanguage, "en");
  }
});

test("validateRunRequest rejects traversal attempt", () => {
  const result = validateRunRequest({
    audio: "../etc/passwd",
    template: "templates/pip-template.docx",
    outdoc: "exports/test-output.docx",
    inputLanguage: "auto",
    outputLanguage: "en",
    projectRoot: PROJECT_ROOT
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "Invalid path parameter(s)");
});

test("validateRunRequest rejects invalid output extension", () => {
  const result = validateRunRequest({
    audio: "uploads/meeting.mp3",
    template: "templates/pip-template.docx",
    outdoc: "exports/output.exe",
    inputLanguage: "auto",
    outputLanguage: "en",
    projectRoot: PROJECT_ROOT
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "Invalid path parameter(s)");
});

test("validateRunRequest rejects invalid languages", () => {
  const inputInvalid = validateRunRequest({
    audio: "uploads/meeting.mp3",
    template: "templates/pip-template.docx",
    outdoc: "exports/test-output.docx",
    inputLanguage: "english",
    outputLanguage: "en",
    projectRoot: PROJECT_ROOT
  });
  assert.equal(inputInvalid.ok, false);
  assert.equal(inputInvalid.error, "Invalid input language");

  const outputInvalid = validateRunRequest({
    audio: "uploads/meeting.mp3",
    template: "templates/pip-template.docx",
    outdoc: "exports/test-output.docx",
    inputLanguage: "auto",
    outputLanguage: "english",
    projectRoot: PROJECT_ROOT
  });
  assert.equal(outputInvalid.ok, false);
  assert.equal(outputInvalid.error, "Invalid output language");
});
