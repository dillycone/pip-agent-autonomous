/**
 * Consolidated sensitive data detection and sanitization utilities.
 * This module provides a single source of truth for identifying and redacting
 * sensitive fields across the application.
 */

const REDACTED = "[REDACTED]";

/**
 * Regex patterns that identify sensitive field names.
 * Used across sanitization, logging, and stringification utilities.
 */
export const SENSITIVE_PATTERNS = [
  /\bpassword\b/i,
  /\bapi[_-]?key\b/i,
  /\btoken\b/i,
  /\bsecret\b/i,
  /\bauthorization\b/i,
  /\bauth\b/i,
  /\bbearer\b/i,
  /\bcredential(?:s)?\b/i,
  /\baccess[_-]?token\b/i,
  /\brefresh[_-]?token\b/i,
  /\bprivate[_-]?key\b/i,
  /\bclient[_-]?secret\b/i,
  /\bid[_-]?token\b/i
];

/**
 * Checks if a field name matches sensitive data patterns.
 * @param fieldName - The field name to check
 * @returns True if the field is sensitive and should be redacted
 */
export function isSensitiveField(fieldName: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(fieldName));
}

/**
 * Sanitizes a value based on its key name.
 * If the key is sensitive, returns [REDACTED], otherwise returns the value unchanged.
 * @param key - The field name
 * @param value - The value to potentially sanitize
 * @returns The original value or [REDACTED] if the key is sensitive
 */
export function sanitizeValue(key: string, value: unknown): unknown {
  if (isSensitiveField(key)) {
    return REDACTED;
  }
  return value;
}
