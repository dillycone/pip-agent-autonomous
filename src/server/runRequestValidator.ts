import path from "node:path";
import { z } from "zod";

import {
  ALLOWED_AUDIO_EXTENSIONS,
  ALLOWED_TEMPLATE_EXTENSIONS,
  ALLOWED_OUTPUT_EXTENSIONS
} from "../config.js";
import {
  validateFilePath,
  validateOutputPath
} from "../utils/validation.js";

const NON_EMPTY_STRING = z
  .string()
  .trim()
  .transform(value => value.trim())
  .pipe(z.string().min(1, "Value cannot be empty"));

export const RunRequestSchema = z.object({
  audio: NON_EMPTY_STRING.optional(),
  template: NON_EMPTY_STRING.optional(),
  outdoc: NON_EMPTY_STRING.optional(),
  inputLanguage: NON_EMPTY_STRING.optional(),
  outputLanguage: NON_EMPTY_STRING.optional()
}).strict();

export type RunRequestBody = z.infer<typeof RunRequestSchema>;

export type ParsedRunRequest =
  | { ok: true; data: RunRequestBody }
  | { ok: false; issues: z.ZodIssue[] };

const LANGUAGE_PATTERN = /^[a-z]{2,5}(?:-[a-z]{2,5})?$/i;

export interface LanguageValidationResult {
  valid: boolean;
  value?: string;
  error?: string;
  hint?: string;
}

export function parseRunRequestBody(raw: unknown): ParsedRunRequest {
  const result = RunRequestSchema.safeParse(raw ?? {});
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, issues: result.error.issues };
}

export function normalizeLanguage(
  value: string,
  { allowAuto = false }: { allowAuto?: boolean } = {}
): LanguageValidationResult {
  const candidate = value.trim().toLowerCase();
  if (allowAuto && candidate === "auto") {
    return { valid: true, value: "auto" };
  }

  if (!LANGUAGE_PATTERN.test(candidate)) {
    return {
      valid: false,
      error: "Invalid language code",
      hint: "Use ISO language codes like en, es, or en-US"
    };
  }

  return { valid: true, value: candidate };
}

export interface ValidateRunRequestParams {
  audio: string;
  template: string;
  outdoc: string;
  inputLanguage: string;
  outputLanguage: string;
  projectRoot: string;
}

export type ValidateRunRequestResult =
  | {
      ok: true;
      audioPath: string;
      templatePath: string;
      outputPath: string;
      inputLanguage: string;
      outputLanguage: string;
    }
  | {
      ok: false;
      error: string;
      details: {
        audio?: unknown;
        template?: unknown;
        outdoc?: unknown;
        inputLanguage?: LanguageValidationResult;
        outputLanguage?: LanguageValidationResult;
      };
    };

export function validateRunRequest(params: ValidateRunRequestParams): ValidateRunRequestResult {
  const {
    audio,
    template,
    outdoc,
    inputLanguage,
    outputLanguage,
    projectRoot
  } = params;

  const inputLang = normalizeLanguage(inputLanguage, { allowAuto: true });
  if (!inputLang.valid) {
    return {
      ok: false,
      error: "Invalid input language",
      details: { inputLanguage: inputLang }
    };
  }

  const outputLang = normalizeLanguage(outputLanguage, { allowAuto: false });
  if (!outputLang.valid) {
    return {
      ok: false,
      error: "Invalid output language",
      details: { outputLanguage: outputLang }
    };
  }

  const audioValidation = validateFilePath(audio, {
    mustExist: true,
    mustBeFile: true,
    extensions: [...ALLOWED_AUDIO_EXTENSIONS],
    allowAbsolute: false,
    baseDir: projectRoot
  });

  const templateValidation = validateFilePath(template, {
    mustExist: true,
    mustBeFile: true,
    extensions: [...ALLOWED_TEMPLATE_EXTENSIONS],
    allowAbsolute: false,
    baseDir: projectRoot
  });

  const outputValidation = validateOutputPath(outdoc, {
    extensions: [...ALLOWED_OUTPUT_EXTENSIONS],
    allowOverwrite: true,
    baseDir: projectRoot,
    allowAbsolute: false
  });

  if (!audioValidation.valid || !templateValidation.valid || !outputValidation.valid) {
    return {
      ok: false,
      error: "Invalid path parameter(s)",
      details: {
        audio: audioValidation,
        template: templateValidation,
        outdoc: outputValidation
      }
    };
  }

  const audioPath = audioValidation.sanitizedPath!;
  const templatePath = templateValidation.sanitizedPath!;
  const outputPath = outputValidation.sanitizedPath!;

  if (
    !isWithinProjectRoot(audioPath, projectRoot) ||
    !isWithinProjectRoot(templatePath, projectRoot) ||
    !isWithinProjectRoot(outputPath, projectRoot)
  ) {
    return {
      ok: false,
      error: "Paths must reside within the project directory",
      details: {
        audio: audioValidation,
        template: templateValidation,
        outdoc: outputValidation
      }
    };
  }

  return {
    ok: true,
    audioPath,
    templatePath,
    outputPath,
    inputLanguage: inputLang.value!,
    outputLanguage: outputLang.value!
  };
}

function isWithinProjectRoot(candidate: string, projectRoot: string): boolean {
  const normalizedRoot = path.resolve(projectRoot);
  const relative = path.relative(normalizedRoot, path.resolve(candidate));
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}
