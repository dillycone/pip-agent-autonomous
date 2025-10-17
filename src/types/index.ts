/**
 * Type definitions for the PIP Agent Autonomous application
 * This file provides proper TypeScript types to eliminate all 'any' usage
 */

import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKSystemMessage
} from "@anthropic-ai/claude-agent-sdk";

// ===== MCP Tool Result Types =====

/**
 * Standard MCP tool result with success status
 */
export interface MCPToolResult {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
}

// ===== Claude Agent SDK Stream Message Types =====

/**
 * Type guard to check if a message is an assistant message
 */
export function isAssistantMessage(msg: SDKMessage): msg is SDKAssistantMessage {
  return msg.type === "assistant";
}

/**
 * Type guard to check if a message is a stream event
 */
export function isStreamEvent(msg: SDKMessage): msg is SDKPartialAssistantMessage {
  return msg.type === "stream_event";
}

/**
 * Type guard to check if a message is a result message
 */
export function isResultMessage(msg: SDKMessage): msg is SDKResultMessage {
  return msg.type === "result";
}

/**
 * Type guard to check if a message is a system message
 */
export function isSystemMessage(msg: SDKMessage): msg is SDKSystemMessage {
  return msg.type === "system";
}

/**
 * Message with usage metrics
 */
export interface MessageWithUsage {
  id?: string;
  messageId?: string;
  usage?: UsageMetrics;
}

/**
 * Type guard to check if a message has usage metrics
 */
export function hasUsage(msg: unknown): msg is MessageWithUsage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "usage" in msg &&
    typeof (msg as MessageWithUsage).usage === "object"
  );
}

// ===== Usage Metrics =====

/**
 * Token usage metrics from Claude API
 */
export interface UsageMetrics {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  provider?: string;
  model?: string;
}

/**
 * Cost breakdown for token usage
 */
export interface CostBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  geminiInputTokens: number;
  geminiOutputTokens: number;
  inputCostUSD: number;
  outputCostUSD: number;
  cacheCreationCostUSD: number;
  cacheReadCostUSD: number;
  geminiInputCostUSD: number;
  geminiOutputCostUSD: number;
}

/**
 * Complete cost summary
 */
export interface CostSummary {
  totalTokens: number;
  estimatedCostUSD: number;
  breakdown: CostBreakdown;
}

// ===== Gemini API Types =====

/**
 * Gemini file upload response
 */
export interface GeminiUploadResponse {
  file?: GeminiFile;
  uri?: string;
  fileUri?: string;
  mimeType?: string;
  fileMimeType?: string;
}

/**
 * Gemini file metadata
 */
export interface GeminiFile {
  uri?: string;
  fileUri?: string;
  mimeType?: string;
  fileMimeType?: string;
  name?: string;
}

/**
 * Gemini generate content response
 */
export interface GeminiGenerateResponse {
  text?: string;
  response?: {
    text?: () => string;
  };
}

/**
 * Gemini transcription segment (raw from API)
 */
export interface GeminiRawSegment {
  start?: string | number | null;
  begin?: string | number | null;
  from?: string | number | null;
  end?: string | number | null;
  finish?: string | number | null;
  to?: string | number | null;
  text?: string;
  transcript?: string;
  speaker?: string;
}

/**
 * Gemini transcription result (raw from API)
 */
export interface GeminiTranscriptionResult {
  transcript?: string;
  segments?: GeminiRawSegment[];
}

/**
 * Type guard for Gemini transcription result
 */
export function isGeminiTranscriptionResult(
  data: unknown
): data is GeminiTranscriptionResult {
  return (
    typeof data === "object" &&
    data !== null &&
    (typeof (data as GeminiTranscriptionResult).transcript === "string" ||
      Array.isArray((data as GeminiTranscriptionResult).segments))
  );
}

// ===== FFprobe Types =====

/**
 * FFprobe audio stream data
 */
export interface AudioStream {
  codec_type: string;
  codec_name: string;
  bit_rate?: string;
  duration?: string;
  sample_rate?: string;
  channels?: number;
}

/**
 * FFprobe format data
 */
export interface AudioFormat {
  duration?: string;
  bit_rate?: string;
  format_name?: string;
  size?: string;
}

/**
 * FFprobe JSON output structure
 */
export interface AudioProbeData {
  streams: AudioStream[];
  format: AudioFormat;
}

/**
 * Type guard for audio probe data
 */
export function isAudioProbeData(data: unknown): data is AudioProbeData {
  return (
    typeof data === "object" &&
    data !== null &&
    "streams" in data &&
    Array.isArray((data as AudioProbeData).streams) &&
    "format" in data &&
    typeof (data as AudioProbeData).format === "object"
  );
}

// ===== Docx Import Types =====

/**
 * Dynamic import of docx library
 */
export interface DocxImport {
  Document: new (options: unknown) => unknown;
  Packer: {
    toBuffer: (doc: unknown) => Promise<Buffer>;
  };
  Paragraph: new (options: unknown) => unknown;
  HeadingLevel: {
    HEADING_1: unknown;
  };
  TextRun: new (options: unknown) => unknown;
}

/**
 * Type guard for docx import
 */
export function isDocxImport(module: unknown): module is DocxImport {
  return (
    typeof module === "object" &&
    module !== null &&
    "Document" in module &&
    "Packer" in module &&
    "Paragraph" in module &&
    "HeadingLevel" in module &&
    "TextRun" in module
  );
}

// ===== Pipeline Result Types =====

/**
 * Final pipeline result (success case)
 */
export interface PipelineSuccess {
  status: "ok";
  draft: string;
  docx?: string;
}

/**
 * Final pipeline result (error case)
 */
export interface PipelineError {
  status: "error";
  message: string;
}

/**
 * Union type for pipeline results
 */
export type PipelineResult = PipelineSuccess | PipelineError;

/**
 * Type guard for pipeline success
 */
export function isPipelineSuccess(result: unknown): result is PipelineSuccess {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as PipelineResult).status === "ok" &&
    typeof (result as PipelineSuccess).draft === "string"
  );
}

/**
 * Type guard for pipeline error
 */
export function isPipelineError(result: unknown): result is PipelineError {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as PipelineResult).status === "error" &&
    typeof (result as PipelineError).message === "string"
  );
}

// ===== Stream Event Data Types =====

/**
 * Tool use stream event data
 */
export interface ToolUseEventData {
  type: "tool_use";
  name: string;
  input: unknown;
  id?: string;
}

/**
 * Tool result stream event data
 */
export interface ToolResultEventData {
  type: "tool_result";
  name?: string;
  content: unknown;
  isError?: boolean;
  id?: string;
}

/**
 * Generic stream event data
 */
export interface StreamEventData {
  type: string;
  [key: string]: unknown;
}

/**
 * Type guard for tool use event
 */
export function isToolUseEvent(data: unknown): data is ToolUseEventData {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as ToolUseEventData).type === "tool_use" &&
    typeof (data as ToolUseEventData).name === "string"
  );
}

/**
 * Type guard for tool result event
 */
export function isToolResultEvent(data: unknown): data is ToolResultEventData {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as ToolResultEventData).type === "tool_result"
  );
}

// ===== Error Types =====

/**
 * Error with additional context
 */
export interface ErrorWithMessage {
  message: string;
  code?: string;
  stack?: string;
  [key: string]: unknown;
}

/**
 * Type guard for error-like objects
 */
export function isErrorWithMessage(error: unknown): error is ErrorWithMessage {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as ErrorWithMessage).message === "string"
  );
}

/**
 * Extracts error message from unknown error type
 */
export function getErrorMessage(error: unknown): string {
  if (isErrorWithMessage(error)) {
    return error.message;
  }
  return String(error);
}
