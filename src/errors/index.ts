/**
 * Custom error classes for the PIP Agent application.
 * All errors extend from AppError for consistent error handling.
 */

import { AppError, ErrorMetadata } from "./BaseError.js";

/**
 * Error thrown when audio file validation fails.
 * Used for: invalid formats, corrupted files, missing audio streams, zero duration.
 */
export class AudioValidationError extends AppError {
  constructor(message: string, metadata?: ErrorMetadata & { hint?: string }) {
    super(
      message,
      "AUDIO_VALIDATION_ERROR",
      400,
      metadata,
      true
    );
  }
}

/**
 * Error thrown when transcription fails.
 * Used for: Gemini API failures, invalid responses, file upload errors.
 */
export class TranscriptionError extends AppError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super(
      message,
      "TRANSCRIPTION_ERROR",
      500,
      metadata,
      true
    );
  }
}

/**
 * Error thrown when PIP generation fails.
 * Used for: Claude API failures, empty drafts, prompt errors.
 */
export class PIPGenerationError extends AppError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super(
      message,
      "PIP_GENERATION_ERROR",
      500,
      metadata,
      true
    );
  }
}

/**
 * Error thrown when DOCX export fails.
 * Used for: template rendering errors, file write failures, path issues.
 */
export class DocumentExportError extends AppError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super(
      message,
      "DOCUMENT_EXPORT_ERROR",
      500,
      metadata,
      true
    );
  }
}

/**
 * Error thrown when configuration is missing or invalid.
 * Used for: missing API keys, invalid config values, missing required files.
 */
export class ConfigurationError extends AppError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super(
      message,
      "CONFIGURATION_ERROR",
      400,
      metadata,
      true
    );
  }
}

// Re-export AppError for convenience
export { AppError } from "./BaseError.js";
