/**
 * Safe JSON stringification utilities that handle circular references and redact sensitive data.
 */

import { SENSITIVE_FIELD_PATTERNS } from "./sanitize.js";

const SENSITIVE_KEYS = new Set([
  "password",
  "apiKey",
  "api_key",
  "token",
  "secret",
  "authorization",
  "auth",
  "bearer",
  "credential",
  "apikey",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "privateKey",
  "private_key",
  "client_secret",
  "id_token",
  "bearertoken"
].map(key => key.toLowerCase()));

const REDACTED = "[REDACTED]";
const CIRCULAR = "[Circular Reference]";

/**
 * Safely stringifies an object, handling circular references and redacting sensitive fields.
 * @param obj - The object to stringify
 * @param maxLength - Maximum length of the output string (default: 10000)
 * @returns A safe JSON string
 */
export function safeStringify(obj: unknown, maxLength: number = 10000): string {
  try {
    const seen = new WeakSet();

    const json = JSON.stringify(
      obj,
      (key, value) => {
        // Redact sensitive fields
        if (isSensitiveKey(key)) {
          return REDACTED;
        }

        // Handle null/undefined
        if (value === null || value === undefined) {
          return value;
        }

        // Handle primitives
        if (typeof value !== "object") {
          return value;
        }

        // Detect circular references
        if (seen.has(value)) {
          return CIRCULAR;
        }

        seen.add(value);

        // Handle errors specially
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack?.split("\n").slice(0, 3).join("\n")
          };
        }

        return value;
      },
      2 // Pretty print with 2 spaces
    );

    // Truncate if too long
    if (json.length > maxLength) {
      return json.slice(0, maxLength) + `\n... [truncated ${json.length - maxLength} characters]`;
    }

    return json;
  } catch (error) {
    // Fallback for non-serializable objects
    return `[Failed to stringify: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

/**
 * Creates a safe MCP error response with sanitized error details.
 * @param message - The error message
 * @param error - The error object (optional)
 * @returns An MCP-compatible error response
 */
export function mcpError(message: string, error?: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  const payload: Record<string, unknown> = {
    ok: false,
    error: message
  };

  if (error) {
    // Sanitize error details
    if (error instanceof Error) {
      payload.details = {
        name: error.name,
        message: error.message,
        code: (error as any).code
      };
    } else if (typeof error === "object" && error !== null) {
      payload.details = sanitizeObject(error);
    } else {
      payload.details = String(error);
    }
  }

  return {
    content: [
      {
        type: "text",
        text: safeStringify(payload)
      }
    ],
    isError: true
  };
}

/**
 * Sanitizes an object by removing sensitive fields and truncating large values.
 * @param obj - The object to sanitize
 * @param maxDepth - Maximum recursion depth
 * @returns A sanitized object
 */
function sanitizeObject(obj: unknown, maxDepth: number = 2): unknown {
  if (maxDepth <= 0) {
    return "[Max depth]";
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.slice(0, 10).map(item => sanitizeObject(item, maxDepth - 1));
  }

  const sanitized: Record<string, unknown> = {};
  let count = 0;

  for (const key in obj) {
    if (count >= 20) {
      sanitized["..."] = "[More fields omitted]";
      break;
    }

    if (isSensitiveKey(key)) {
      sanitized[key] = REDACTED;
    } else {
      sanitized[key] = sanitizeObject((obj as any)[key], maxDepth - 1);
    }

    count++;
  }

  return sanitized;
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_KEYS.has(lower)) {
    return true;
  }
  return SENSITIVE_FIELD_PATTERNS.some(pattern => pattern.test(key));
}
