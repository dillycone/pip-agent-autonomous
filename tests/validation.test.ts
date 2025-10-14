import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { validateFilePath } from "../src/utils/validation.js";

test("allows absolute paths when allowed", () => {
  const absolute = path.resolve("src", "main.ts");
  const result = validateFilePath(absolute, { allowAbsolute: true });

  assert.equal(result.valid, true, "absolute path should be valid");
  assert.equal(result.sanitizedPath, absolute);
});

test("rejects traversal outside base directory", () => {
  const baseDir = path.resolve("uploads");
  const result = validateFilePath("../etc/passwd", { baseDir, allowAbsolute: false });

  assert.equal(result.valid, false, "path escaping base directory must be rejected");
  assert.ok(result.error, "an error message should be provided");
});

test("passes for relative path within base directory", () => {
  const baseDir = path.resolve("uploads");
  const result = validateFilePath("audio/sample.mp3", {
    baseDir,
    allowAbsolute: false
  });

  assert.equal(result.valid, true, "relative path inside base should be valid");
  assert.ok(result.sanitizedPath?.startsWith(baseDir));
});
