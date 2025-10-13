/**
 * Centralized error handling utilities.
 * Provides consistent error handling, formatting, and logging across the application.
 */

import { AppError } from "./BaseError.js";
import { sanitizeError, sanitizeForLogging } from "../utils/sanitize.js";
import { safeStringify } from "../utils/safe-stringify.js";

/**
 * Checks if an error is an operational error (expected/recoverable).
 * Operational errors are expected errors like validation failures, network issues, etc.
 * Programming errors are bugs that should not occur in normal operation.
 *
 * @param error - The error to check
 * @returns True if the error is operational and can be handled gracefully
 *
 * @example
 * if (isOperationalError(error)) {
 *   // Handle gracefully, show user-friendly message
 * } else {
 *   // Programming error - log stack trace and exit
 * }
 */
export function isOperationalError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }

  // Check for common operational error codes
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as any).code;

    // Node.js system error codes that are operational
    const operationalCodes = [
      "ENOENT",      // File not found
      "EACCES",      // Permission denied
      "EADDRINUSE",  // Port already in use
      "ECONNREFUSED",// Connection refused
      "ETIMEDOUT",   // Timeout
      "ENOTDIR",     // Not a directory
      "EISDIR",      // Is a directory
      "EMFILE",      // Too many open files
      "ENOSPC"       // No space left on device
    ];

    if (operationalCodes.includes(code)) {
      return true;
    }
  }

  // Unknown errors are considered non-operational (programming errors)
  return false;
}

/**
 * Formats an error into a user-friendly message.
 * Strips technical details and provides actionable guidance.
 *
 * @param error - The error to format
 * @returns A user-friendly error message
 *
 * @example
 * const message = formatErrorForUser(error);
 * console.error(message); // "Audio file validation failed: ..."
 */
export function formatErrorForUser(error: unknown): string {
  // Handle AppError instances with metadata hints
  if (error instanceof AppError) {
    let message = `${error.name}: ${error.message}`;

    if (error.metadata?.hint && typeof error.metadata.hint === "string") {
      message += `\nHint: ${error.metadata.hint}`;
    }

    return message;
  }

  // Handle Error objects
  if (error instanceof Error) {
    return `Error: ${error.message}`;
  }

  // Handle string errors
  if (typeof error === "string") {
    return error;
  }

  // Handle plain objects with error/message properties
  if (error && typeof error === "object") {
    const errorObj = error as any;
    if (errorObj.message) {
      return `Error: ${errorObj.message}`;
    }
    if (errorObj.error) {
      return `Error: ${errorObj.error}`;
    }
  }

  // Fallback
  return "An unknown error occurred";
}

/**
 * Central error handler for the application.
 * Logs errors appropriately and provides consistent error handling.
 *
 * @param error - The error to handle
 * @param context - Optional context information (e.g., "transcription", "pip-generation")
 *
 * @example
 * try {
 *   await transcribeAudio(path);
 * } catch (error) {
 *   handleError(error, "transcription");
 * }
 */
export function handleError(error: unknown, context?: string): void {
  const sanitized = sanitizeError(error);
  const userMessage = formatErrorForUser(error);

  // Log context if provided
  if (context) {
    console.error(`\n❌ Error in ${context}:`);
  } else {
    console.error("\n❌ Error:");
  }

  // Always show user-friendly message
  console.error(`   ${userMessage}`);

  // For operational errors, show minimal technical details
  if (isOperationalError(error)) {
    if (sanitized.code) {
      console.error(`   Code: ${sanitized.code}`);
    }
  } else {
    // For programming errors, show full details for debugging
    console.error("\n   Technical details:");
    console.error(`   ${safeStringify(sanitizeForLogging(sanitized), 500)}`);
  }
}

/**
 * Wraps an error with additional context.
 * Useful for adding context while preserving the original error.
 *
 * @param error - The original error
 * @param context - Context message to prepend
 * @returns A new error with the added context
 *
 * @example
 * try {
 *   await processFile(path);
 * } catch (error) {
 *   throw wrapError(error, "Failed to process audio file");
 * }
 */
export function wrapError(error: unknown, context: string): Error {
  if (error instanceof Error) {
    const wrappedMessage = `${context}: ${error.message}`;

    // Preserve AppError structure if possible
    if (error instanceof AppError) {
      // Create a new AppError with the same code and metadata
      return new AppError(
        wrappedMessage,
        error.code,
        error.statusCode,
        error.metadata,
        error.isOperational
      );
    }

    // Otherwise create a standard Error
    const wrapped = new Error(wrappedMessage);
    wrapped.stack = error.stack;
    return wrapped;
  }

  return new Error(`${context}: ${String(error)}`);
}
