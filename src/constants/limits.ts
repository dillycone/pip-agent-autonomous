/**
 * Size and limit constants for the PIP Agent application.
 *
 * This module centralizes all size/limit-related configuration to improve
 * maintainability and prevent magic numbers from being scattered throughout
 * the codebase.
 */

/**
 * Maximum supported audio file size (in bytes) for Gemini transcription.
 *
 * This hard cap prevents processing of excessively large audio files that
 * could cause memory issues or exceed API limits. Files larger than this
 * will be rejected with a validation error.
 *
 * @default 209715200 (200 MB)
 */
export const MAX_FILE_SIZE = 200 * 1024 * 1024;

/**
 * Duration threshold (in seconds) for warning users about long transcription times.
 *
 * When audio files exceed this duration, the system displays a warning to
 * users that transcription may take several minutes. This helps set appropriate
 * expectations for processing time.
 *
 * @default 120 (2 minutes)
 */
export const DURATION_THRESHOLD_SECONDS = 120;

/**
 * Maximum length (in characters) for stringified JSON output.
 *
 * This limit is used by the safe-stringify utility to prevent excessively
 * large output from overwhelming logs or responses. Content exceeding this
 * length will be truncated with an indication of how much was omitted.
 *
 * @default 10000
 */
export const MAX_STRING_LENGTH = 10000;
