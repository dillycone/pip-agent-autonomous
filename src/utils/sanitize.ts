/**
 * Sanitization utilities to prevent sensitive data leakage in error messages and logs.
 */

export interface SanitizedError {
  name: string;
  message: string;
  code?: string;
  stack?: string;
  [key: string]: unknown;
}

const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /apikey/i,
  /api_key/i,
  /token/i,
  /secret/i,
  /authorization/i,
  /auth/i,
  /bearer/i,
  /credential/i,
  /key/i
];

const API_KEY_PATTERN = /\b(sk-[a-zA-Z0-9]{32,}|AIza[a-zA-Z0-9_-]{35})\b/g;
const REDACTED = "[REDACTED]";

/**
 * Sanitizes an error object by removing sensitive fields and truncating stack traces.
 * @param error - The error to sanitize
 * @returns A sanitized error object safe for logging
 */
export function sanitizeError(error: unknown): SanitizedError {
  if (!error) {
    return {
      name: "UnknownError",
      message: "An unknown error occurred"
    };
  }

  // Handle Error objects
  if (error instanceof Error) {
    const sanitized: SanitizedError = {
      name: error.name || "Error",
      message: redactApiKey(error.message || "Unknown error")
    };

    // Include error code if present (e.g., ENOENT)
    if ("code" in error && typeof error.code === "string") {
      sanitized.code = error.code;
    }

    // Sanitize and truncate stack trace (remove absolute paths)
    if (error.stack) {
      sanitized.stack = sanitizePath(error.stack)
        .split("\n")
        .slice(0, 5) // Only keep first 5 lines
        .join("\n");
    }

    // Check for additional properties on the error object
    const errorObj = error as any;
    for (const key in errorObj) {
      if (key === "name" || key === "message" || key === "stack" || key === "code") {
        continue;
      }

      // Skip sensitive fields
      if (isSensitiveField(key)) {
        continue;
      }

      // Include safe additional properties
      const value = errorObj[key];
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        sanitized[key] = typeof value === "string" ? redactApiKey(value) : value;
      }
    }

    return sanitized;
  }

  // Handle string errors
  if (typeof error === "string") {
    return {
      name: "Error",
      message: redactApiKey(error)
    };
  }

  // Handle plain objects
  if (typeof error === "object") {
    const errorObj = error as any;
    const sanitized: SanitizedError = {
      name: errorObj.name || "Error",
      message: redactApiKey(errorObj.message || errorObj.error || "Unknown error")
    };

    // Include safe properties
    for (const key in errorObj) {
      if (key === "name" || key === "message" || key === "error") {
        continue;
      }

      if (isSensitiveField(key)) {
        continue;
      }

      const value = errorObj[key];
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        sanitized[key] = typeof value === "string" ? redactApiKey(value) : value;
      }
    }

    return sanitized;
  }

  // Fallback for primitives
  return {
    name: "Error",
    message: String(error)
  };
}

/**
 * Sanitizes file paths by converting absolute paths to relative paths.
 * @param path - The path string to sanitize
 * @returns A sanitized path with sensitive directory information removed
 */
export function sanitizePath(path: string): string {
  if (!path) return path;

  // Remove common sensitive path prefixes
  const sensitivePatterns = [
    /\/Users\/[^/]+/g,
    /\/home\/[^/]+/g,
    /C:\\Users\\[^\\]+/g,
    /\/private\/[^/]+/g
  ];

  let sanitized = path;
  for (const pattern of sensitivePatterns) {
    sanitized = sanitized.replace(pattern, "~");
  }

  return sanitized;
}

/**
 * Redacts API keys and tokens from text.
 * @param text - The text to redact
 * @returns Text with API keys replaced with [REDACTED]
 */
export function redactApiKey(text: string): string {
  if (!text) return text;
  return text.replace(API_KEY_PATTERN, REDACTED);
}

/**
 * Deep sanitizes data structures for logging, removing sensitive fields and truncating large values.
 * @param data - The data to sanitize
 * @param maxDepth - Maximum recursion depth
 * @returns Sanitized data safe for logging
 */
export function sanitizeForLogging(data: unknown, maxDepth: number = 3): unknown {
  if (maxDepth <= 0) {
    return "[Max depth reached]";
  }

  // Handle null/undefined
  if (data === null || data === undefined) {
    return data;
  }

  // Handle primitives
  if (typeof data === "string") {
    // Truncate long strings
    const truncated = data.length > 1000 ? data.slice(0, 1000) + "..." : data;
    return redactApiKey(truncated);
  }

  if (typeof data === "number" || typeof data === "boolean") {
    return data;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data
      .slice(0, 50) // Limit array length
      .map(item => sanitizeForLogging(item, maxDepth - 1));
  }

  // Handle objects
  if (typeof data === "object") {
    const sanitized: Record<string, unknown> = {};
    let count = 0;
    const maxKeys = 50;

    for (const key in data) {
      if (count >= maxKeys) {
        sanitized["..."] = `[${Object.keys(data).length - maxKeys} more keys]`;
        break;
      }

      // Skip sensitive fields
      if (isSensitiveField(key)) {
        sanitized[key] = REDACTED;
        count++;
        continue;
      }

      const value = (data as any)[key];
      sanitized[key] = sanitizeForLogging(value, maxDepth - 1);
      count++;
    }

    return sanitized;
  }

  // Fallback for functions, symbols, etc.
  return String(data);
}

/**
 * Checks if a field name is sensitive.
 * @param fieldName - The field name to check
 * @returns True if the field is sensitive
 */
function isSensitiveField(fieldName: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some(pattern => pattern.test(fieldName));
}
