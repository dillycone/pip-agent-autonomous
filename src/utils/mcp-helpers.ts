/**
 * Helper functions for standardized MCP tool responses.
 * These utilities eliminate duplicate JSON response patterns across MCP tools.
 *
 * Note: For error responses, use mcpError from safe-stringify.ts which includes
 * sanitization and redaction of sensitive data.
 */

import type { MCPToolResult } from "../types/index.js";

/**
 * Structure for successful MCP responses.
 */
export interface MCPSuccessResponse {
  ok: true;
  [key: string]: unknown;
}

/**
 * Creates a standardized successful MCP tool response.
 *
 * @param data - The success data to return (will be merged with { ok: true })
 * @returns Formatted MCP tool result with success payload
 *
 * @example
 * return mcpSuccess({ transcript: "...", segments: [...] });
 * // Returns: { content: [{ type: "text", text: '{"ok":true,"transcript":"...","segments":[...]}' }] }
 *
 * @example
 * return mcpSuccess({ draft: "Performance Improvement Plan..." });
 * // Returns: { content: [{ type: "text", text: '{"ok":true,"draft":"..."}' }] }
 *
 * @example
 * return mcpSuccess({ outputPath: "/path/to/file.docx" });
 * // Returns: { content: [{ type: "text", text: '{"ok":true,"outputPath":"/path/to/file.docx"}' }] }
 */
export function mcpSuccess(data: Record<string, unknown>): MCPToolResult {
  const response: MCPSuccessResponse = {
    ok: true,
    ...data
  };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(response)
      }
    ]
  };
}

