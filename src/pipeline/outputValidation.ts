/**
 * Output Validation Module
 *
 * This module handles validation and processing of pipeline outputs,
 * specifically DOCX file validation and model family extraction.
 *
 * Key responsibilities:
 * - Validating DOCX file structure and content
 * - Extracting model family information from content
 * - Renaming output files to include model family
 * - Final result validation
 */

import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import { extractModelFamily, withModelFamilyInDocxPath } from "../utils/modelFamily.js";
import { sanitizePath } from "../utils/sanitize.js";

export interface DocxValidationResult {
  valid: boolean;
  reason?: string;
}

export interface ModelFamilyResult {
  modelFamily: string | null;
  model: string | null;
}

/**
 * Validates that a DOCX file exists and has valid structure
 *
 * @param pathToDocx - Absolute path to the DOCX file
 * @param failureReason - Optional object to receive failure reason
 * @returns True if the DOCX is valid, false otherwise
 */
export function isValidDocx(
  pathToDocx: string,
  failureReason?: { reason?: string }
): boolean {
  try {
    if (!fs.existsSync(pathToDocx)) {
      if (failureReason) failureReason.reason = "DOCX file is missing";
      return false;
    }

    const content = fs.readFileSync(pathToDocx);
    if (content.length === 0) {
      if (failureReason) failureReason.reason = "DOCX file is empty";
      return false;
    }

    const zip = new PizZip(content);
    const requiredEntries = ["[Content_Types].xml", "_rels/.rels", "word/document.xml"];

    for (const entry of requiredEntries) {
      const file = zip.file(entry);
      if (!file || file.dir) {
        if (failureReason) failureReason.reason = `Missing required entry: ${entry}`;
        return false;
      }
    }

    return true;
  } catch (error: unknown) {
    if (failureReason) {
      failureReason.reason = error instanceof Error ? error.message : "Unknown validation error";
    }
    return false;
  }
}

/**
 * Extracts model family from various content sources
 *
 * @param content - Content to extract model family from (could be draft text, metadata, etc.)
 * @returns Model family and model information
 */
export function extractModelFamilyFromContent(content: unknown): ModelFamilyResult {
  let model: string | null = null;
  let modelFamily: string | null = null;

  // Try to extract from different content structures
  if (typeof content === "string") {
    model = content.trim();
  } else if (content && typeof content === "object" && !Array.isArray(content)) {
    const obj = content as Record<string, unknown>;

    // Check common model field names
    if (typeof obj.model === "string") {
      model = obj.model;
    } else if (typeof obj.modelId === "string") {
      model = obj.modelId;
    } else if (typeof obj.draft_model === "string") {
      model = obj.draft_model;
    } else if (obj.usage && typeof obj.usage === "object") {
      const usage = obj.usage as Record<string, unknown>;
      if (typeof usage.model === "string") {
        model = usage.model;
      }
    }
  }

  if (model) {
    modelFamily = extractModelFamily(model);
  }

  return { modelFamily, model };
}

/**
 * Renames a DOCX file to include the model family in the filename
 *
 * @param docxPath - Original DOCX path
 * @param pipModelFamily - Model family to include in filename
 * @param emit - Event emitter for logging
 * @returns Updated DOCX path (renamed file) or original path if renaming failed
 */
export function renameDocxWithModelFamily(
  docxPath: string,
  pipModelFamily: string | null,
  emit: (event: string, data: unknown) => void
): string {
  if (!pipModelFamily) {
    return docxPath;
  }

  const desiredPath = withModelFamilyInDocxPath(docxPath, pipModelFamily);
  const resolvedSource = path.resolve(docxPath);
  const resolvedTarget = path.resolve(desiredPath);

  if (resolvedSource === resolvedTarget) {
    return resolvedTarget;
  }

  try {
    if (!fs.existsSync(resolvedSource)) {
      emit("log", {
        level: "warn",
        message: `Expected DOCX not found for renaming: ${sanitizePath(resolvedSource)}`
      });
      return docxPath;
    }

    const targetDir = path.dirname(resolvedTarget);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    let candidateTarget = resolvedTarget;
    if (fs.existsSync(candidateTarget)) {
      const parsedCandidate = path.parse(candidateTarget);
      candidateTarget = path.join(
        parsedCandidate.dir,
        `${parsedCandidate.name}-${Date.now()}${parsedCandidate.ext}`
      );
    }

    fs.renameSync(resolvedSource, candidateTarget);
    emit("log", {
      level: "info",
      message: `Renamed DOCX to include model (${pipModelFamily}): ${sanitizePath(candidateTarget)}`
    });

    return candidateTarget;
  } catch (renameError: unknown) {
    const errorMessage =
      renameError instanceof Error ? renameError.message : "unknown error";
    emit("log", {
      level: "warn",
      message: `Failed to rename DOCX with model: ${errorMessage}`
    });
    return docxPath;
  }
}

/**
 * Validates the final export phase and checks for output file
 *
 * @param outputPath - Expected output file path
 * @param emit - Event emitter for logging
 * @returns Validation result with optional reason
 */
export function validateExportPhase(
  outputPath: string,
  emit: (event: string, data: unknown) => void
): DocxValidationResult {
  if (!fs.existsSync(outputPath)) {
    return {
      valid: false,
      reason: "Output file does not exist"
    };
  }

  const failureReason: { reason?: string } = {};
  if (!isValidDocx(outputPath, failureReason)) {
    emit("log", {
      level: "warn",
      message: `Output DOCX validation failed: ${failureReason.reason || "unknown reason"}`
    });
    return {
      valid: false,
      reason: failureReason.reason
    };
  }

  emit("log", {
    level: "info",
    message: "Output DOCX validated successfully"
  });

  return { valid: true };
}

/**
 * Handles worker error recovery by checking if output was created
 *
 * @param outputPath - Expected output file path
 * @param projectRoot - Project root directory
 * @param pipModelFamily - Model family for file renaming
 * @param emit - Event emitter
 * @param sendStatus - Status update function
 * @returns Recovery result with path info if successful
 */
export function handleWorkerErrorRecovery(
  outputPath: string,
  projectRoot: string,
  pipModelFamily: string | null,
  emit: (event: string, data: unknown) => void,
  sendStatus: (step: string, status: string, meta?: Record<string, unknown>) => void
): {
  recovered: boolean;
  finalDocxPath?: string;
  docxRelative?: string;
} {
  if (!fs.existsSync(outputPath)) {
    return { recovered: false };
  }

  const failureReason: { reason?: string } = {};
  if (!isValidDocx(outputPath, failureReason)) {
    if (failureReason.reason) {
      emit("log", {
        level: "warn",
        message: `Recovered DOCX failed validation: ${failureReason.reason}`
      });
    } else {
      emit("log", {
        level: "warn",
        message: "Recovered DOCX failed validation for an unknown reason"
      });
    }
    return { recovered: false };
  }

  emit("log", {
    level: "info",
    message: "Output file was created successfully despite worker error"
  });

  sendStatus("export", "success");

  const finalDocxPath = renameDocxWithModelFamily(outputPath, pipModelFamily, emit);
  const docxRelative = sanitizePath(path.relative(projectRoot, finalDocxPath));

  return {
    recovered: true,
    finalDocxPath,
    docxRelative
  };
}

/**
 * Parses final result payload from the pipeline
 *
 * @param rawResult - Raw result from the pipeline
 * @param logJsonParseFailure - Function to log JSON parse failures
 * @returns Parsed result object or original if parsing fails
 */
export function parseFinalResult(
  rawResult: unknown,
  logJsonParseFailure: (source: string, raw: string, error: unknown) => void
): unknown {
  if (typeof rawResult === "string") {
    const cleaned = rawResult.replace(/```json\s*|```/g, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch (error: unknown) {
      logJsonParseFailure("final_result_payload", cleaned, error);
      return rawResult;
    }
  }
  return rawResult;
}

/**
 * Validates and processes successful final result
 *
 * @param payload - Parsed payload from final result
 * @param outputPath - Expected output path
 * @param projectRoot - Project root directory
 * @param pipModelFamily - Model family for file renaming
 * @param emit - Event emitter
 * @param sendStatus - Status update function
 * @returns Processing result with final paths
 */
export function processFinalResult(
  payload: unknown,
  outputPath: string,
  projectRoot: string,
  pipModelFamily: string | null,
  emit: (event: string, data: unknown) => void,
  sendStatus: (step: string, status: string, meta?: Record<string, unknown>) => void
): {
  success: boolean;
  draft?: string;
  finalDocxPath?: string;
  docxRelative?: string;
} {
  if (!payload || typeof payload !== "object") {
    return { success: false };
  }

  const obj = payload as Record<string, unknown>;
  if (obj.status !== "ok") {
    return { success: false };
  }

  const draft = typeof obj.draft === "string" ? obj.draft : "";
  const docxRaw = typeof obj.docx === "string" ? obj.docx : outputPath;
  const finalDocxPath = renameDocxWithModelFamily(docxRaw, pipModelFamily, emit);
  const docxRelative = sanitizePath(path.relative(projectRoot, finalDocxPath));

  sendStatus("export", "success");

  return {
    success: true,
    draft,
    finalDocxPath,
    docxRelative
  };
}

/**
 * Sanitizes errors for safe JSON serialization
 *
 * @param error - Error to sanitize
 * @returns Sanitized error object without stack trace
 */
export function toSerializableError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const { stack, ...rest } = {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
    return rest;
  }
  if (typeof error === "string") {
    return { message: error };
  }
  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    const { stack, ...rest } = obj;
    return rest;
  }
  return { message: String(error) };
}
