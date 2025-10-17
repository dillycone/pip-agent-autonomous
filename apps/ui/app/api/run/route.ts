import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { GUIDELINES_PATH, PIP_PROMPT_PATH } from "@pip/config";
import { sanitizeError, sanitizePath } from "@pip/utils/sanitize";
import { PROJECT_ROOT, resolveProjectPath } from "@pip/utils/paths";
import { runStore } from "@pip/server/runStore";
import {
  parseRunRequestBody,
  validateRunRequest
} from "@pip/server/runRequestValidator";
import { executeRun } from "../../../server/runPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULTS = {
  audio: "uploads/meeting.mp3",
  inputLanguage: "auto",
  outputLanguage: "en",
  template: "templates/pip-template.docx",
  outdoc: () => `exports/pip-${Date.now()}.docx`
} as const;

export async function POST(req: NextRequest) {
  let rawBody: unknown = {};
  try {
    rawBody = await req.json();
  } catch {
    rawBody = {};
  }

  const parsed = parseRunRequestBody(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({
      error: "Invalid request body",
      issues: parsed.issues
    }, { status: 400 });
  }

  const body = parsed.data;

  const audioParam = body.audio ?? DEFAULTS.audio;
  const templateParam = body.template ?? DEFAULTS.template;
  const outdocParam = body.outdoc ?? DEFAULTS.outdoc();
  const inputLanguage = body.inputLanguage ?? DEFAULTS.inputLanguage;
  const outputLanguage = body.outputLanguage ?? DEFAULTS.outputLanguage;

  const projectRoot = PROJECT_ROOT;
  const guidelinesPath = resolveProjectPath(GUIDELINES_PATH);
  const promptPath = resolveProjectPath(PIP_PROMPT_PATH);

  const validation = validateRunRequest({
    audio: audioParam,
    template: templateParam,
    outdoc: outdocParam,
    inputLanguage,
    outputLanguage,
    projectRoot
  });

  if (!validation.ok) {
    return NextResponse.json({
      error: validation.error,
      details: validation.details
    }, { status: 400 });
  }

  const {
    audioPath,
    templatePath,
    outputPath,
    inputLanguage: safeInputLanguage,
    outputLanguage: safeOutputLanguage
  } = validation;

  const { id: runId, signal } = runStore.createRun();

  const payload = {
    runId,
    audio: sanitizePath(path.relative(projectRoot, audioPath)),
    template: sanitizePath(path.relative(projectRoot, templatePath)),
    outdoc: sanitizePath(path.relative(projectRoot, outputPath)),
    inputLanguage: safeInputLanguage,
    outputLanguage: safeOutputLanguage
  };

  // Kick off the pipeline asynchronously
  console.log(`[API /api/run] Starting executeRun for ${runId}`);
  void executeRun({
    runId,
    audioPath,
    templatePath,
    outputPath,
    promptPath,
    guidelinesPath,
    inputLanguage: safeInputLanguage,
    outputLanguage: safeOutputLanguage,
    projectRoot,
    signal
  }).catch((error: unknown) => {
    console.error(`[API /api/run] executeRun error for ${runId}:`, error);
    const sanitized = sanitizeError(error);
    runStore.setStatus(runId, "error", sanitized);
    runStore.appendEvent(runId, "error", {
      message: sanitized.message,
      details: sanitized
    });
    runStore.finish(runId);
  });

  return NextResponse.json(payload, { status: 201 });
}
