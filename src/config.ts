/**
 * Centralized Configuration Module
 *
 * This module consolidates all configuration values from environment variables,
 * default values, and constants used throughout the application.
 *
 * All configuration should be imported from this module rather than reading
 * process.env directly or using inline constants.
 */

import "dotenv/config";

// ============================================================================
// API Keys
// ============================================================================

/**
 * Anthropic API key for Claude models
 * Required for main agent and PIP generation
 */
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

/**
 * Gemini API key for transcription services
 * Required for audio transcription
 */
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ============================================================================
// API Key Format Validation
// ============================================================================

/**
 * Validates the format of an Anthropic API key
 * Anthropic keys follow the pattern: sk-ant-api03-...
 *
 * @param key - The API key to validate
 * @returns True if the key format is valid
 *
 * @security Validates key format to catch configuration errors early
 */
export function isValidAnthropicKeyFormat(key: string | undefined): boolean {
  if (!key || typeof key !== "string") return false;
  // Anthropic keys start with sk-ant- and have at least 40 characters
  return key.startsWith("sk-ant-") && key.length >= 40;
}

/**
 * Validates the format of a Google Gemini API key
 * Gemini keys follow the pattern: AIza... (39 characters total)
 *
 * @param key - The API key to validate
 * @returns True if the key format is valid
 *
 * @security Validates key format to catch configuration errors early
 */
export function isValidGeminiKeyFormat(key: string | undefined): boolean {
  if (!key || typeof key !== "string") return false;
  // Gemini keys start with AIza and are typically 39 characters
  return key.startsWith("AIza") && key.length >= 35;
}

// ============================================================================
// Model Configuration
// ============================================================================

/**
 * Model identifiers and names
 */
export const MODELS = {
  /**
   * Main Claude model for orchestration and PIP generation
   * Default: claude-sonnet-4-5-20250929
   */
  CLAUDE_SONNET: process.env.CLAUDE_MODEL_ID || "claude-sonnet-4-5-20250929",

  /**
   * Claude model specifically for PIP generation (overrides main model if set)
   * Falls back to CLAUDE_SONNET if not specified
   */
  CLAUDE_PIP: process.env.CLAUDE_PIP_MODEL_ID || process.env.CLAUDE_MODEL_ID || "claude-sonnet-4-5-20250929",

  /**
   * Gemini model for audio transcription
   * Default: gemini-2.5-pro
   */
  GEMINI_PRO: process.env.GEMINI_TRANSCRIBE_MODEL || "gemini-2.5-pro"
} as const;

// ============================================================================
// Claude Model Parameters
// ============================================================================

/**
 * Temperature for PIP generation (0-1)
 * Lower values = more focused and deterministic
 * Higher values = more creative and varied
 * Default: 0.2
 */
export const PIP_TEMPERATURE = Number.isFinite(Number(process.env.PIP_TEMPERATURE))
  ? Number(process.env.PIP_TEMPERATURE)
  : 0.2;

/**
 * Maximum output tokens for PIP generation
 * Default: 4096
 */
export const PIP_MAX_OUTPUT_TOKENS = Number.isFinite(Number(process.env.PIP_MAX_OUTPUT_TOKENS))
  ? Number(process.env.PIP_MAX_OUTPUT_TOKENS)
  : 4096;

/**
 * Model to use for PIP draft generation
 * Supports: "claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001", "gemini-2.5-pro"
 * Default: claude-sonnet-4-5-20250929
 */
export const PIP_DRAFT_MODEL = process.env.PIP_DRAFT_MODEL || "claude-sonnet-4-5-20250929";

/**
 * Thinking budget for PIP generation (tokens)
 *
 * PIP generation requires deep reasoning about HR policy, legal compliance,
 * tone, and specificity. We use HIGH thinking budgets for maximum quality.
 *
 * Valid ranges by model:
 * - Claude Sonnet/Haiku: 1024-128000 tokens
 * - Gemini 2.5 Pro: 128-32768 tokens
 *
 * Default: 64000 for Claude, 16384 for Gemini (high budgets for quality)
 * Set to 0 to disable thinking (not recommended for PIP generation)
 */
export const PIP_THINKING_BUDGET = (() => {
  const envValue = process.env.PIP_THINKING_BUDGET;
  if (envValue !== undefined && envValue !== "") {
    const parsed = Number(envValue);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  // Auto-select default based on model
  if (PIP_DRAFT_MODEL.includes("gemini")) {
    return 16384; // High budget for Gemini (within 128-32768 range)
  }
  return 64000; // High budget for Claude (within 1024-128000 range)
})();

/**
 * Validate and clamp thinking budget to model-specific ranges
 */
export function getValidatedThinkingBudget(model: string, budget: number): number {
  if (budget === 0) return 0; // Allow disabling thinking if explicitly set to 0

  if (model.includes("gemini")) {
    // Gemini 2.5 Pro: 128-32768 tokens
    return Math.max(128, Math.min(32768, budget));
  } else {
    // Claude models: 1024-128000 tokens
    return Math.max(1024, Math.min(128000, budget));
  }
}

// ============================================================================
// Pipeline Configuration
// ============================================================================

/**
 * Maximum number of review rounds with policy judge
 * Clamped to 0–1 so the judge is consulted at most once per run.
 * Default (and maximum): 1
 */
const REQUESTED_REVIEW_ROUNDS = Number(process.env.MAX_REVIEW_ROUNDS);
export const MAX_REVIEW_ROUNDS = Number.isFinite(REQUESTED_REVIEW_ROUNDS)
  ? Math.max(0, Math.min(1, Math.floor(REQUESTED_REVIEW_ROUNDS)))
  : 1;

/**
 * Maximum turns allowed for the main agent orchestration
 * Default: 60
 */
export const MAX_TURNS = 60;

// ============================================================================
// Logging Configuration
// ============================================================================

/**
 * Log level for the application
 * Valid values: 'trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'
 * Default: 'info'
 */
export const LOG_LEVEL = process.env.LOG_LEVEL || "info";

/**
 * Enable pretty printing for logs (development mode)
 * In production (NODE_ENV=production), logs are always JSON
 * Default: true in development, false in production
 */
export const LOG_PRETTY = process.env.NODE_ENV !== "production";

// ============================================================================
// Transcription Configuration
// ============================================================================

/**
 * Default chunk duration in seconds for long audio files
 *
 * Used ONLY as a fallback when single-pass transcription fails due to
 * timeout or file-too-large errors. The system always attempts single-pass
 * first regardless of file duration.
 *
 * Audio will be split into chunks of this size when chunking is needed.
 * Default: 30 seconds (minimum 10)
 */
export const GEMINI_CHUNK_SECONDS = Math.max(10, Number(process.env.GEMINI_CHUNK_SECONDS || 30));

/**
 * Duration threshold hint for single-pass transcription (seconds)
 *
 * NOTE: This is now INFORMATIONAL ONLY. The system ALWAYS attempts
 * single-pass transcription first regardless of duration, and only
 * chunks if Gemini explicitly fails (timeout or file too large).
 *
 * Gemini 2.5 Pro supports up to ~9.5 hours (34,200 seconds) of audio.
 * This threshold is used only for logging and progress estimation.
 *
 * Default: 34,200 seconds (~9.5 hours)
 */
export const GEMINI_SINGLE_PASS_MAX = Number(process.env.GEMINI_SINGLE_PASS_MAX || 34200);

/**
 * Concurrency for parallel chunk transcription
 * Number of chunks to transcribe simultaneously
 * Default: 4 (minimum 1)
 */
export const GEMINI_TRANSCRIBE_CONCURRENCY = Math.max(1, Number(process.env.GEMINI_TRANSCRIBE_CONCURRENCY || 4));

/**
 * Number of retries for failed transcription attempts
 * Default: 2 (minimum 0)
 */
export const GEMINI_TRANSCRIBE_RETRIES = Math.max(0, Number(process.env.GEMINI_TRANSCRIBE_RETRIES || 2));

/**
 * Thinking budget for Gemini transcription (tokens)
 *
 * Gemini 2.5 Pro cannot fully disable thinking (minimum 128 tokens).
 * For transcription (a straightforward task), we use the minimum to reduce costs.
 * Thinking provides no benefit for audio-to-text conversion.
 *
 * Valid range: 128-32768 tokens
 * Default: 128 (minimum to minimize unnecessary reasoning costs)
 */
export const GEMINI_TRANSCRIBE_THINKING_BUDGET = Math.max(128, Math.min(32768, Number(process.env.GEMINI_TRANSCRIBE_THINKING_BUDGET || 128)));

// ============================================================================
// S3 + Presigned URL Configuration
// ============================================================================

/**
 * AWS CLI profile to use for S3 ops
 * Default: BCRoot (per user instruction)
 */
export const S3_PROFILE = process.env.S3_PROFILE || "BCRoot";

/**
 * Target S3 bucket for audio uploads
 * If unset, the app may attempt to create one on the fly
 */
export const S3_BUCKET = process.env.S3_BUCKET;

/**
 * Optional key prefix for uploaded audio objects (no leading slash)
 * Default: "audio"
 */
export const S3_PREFIX = (process.env.S3_PREFIX || "audio").replace(/^\/+|\/+$/g, "");

/**
 * TTL for presigned URLs in seconds
 * Default: 3600
 */
export const S3_PRESIGN_TTL_SECONDS = Math.max(60, Number(process.env.S3_PRESIGN_TTL_SECONDS || 3600));

/**
 * Whether to delete S3 object after transcription completes
 * Default: true
 */
export const S3_DELETE_AFTER = String(process.env.S3_DELETE_AFTER || "true").toLowerCase() === "true";

/**
 * Input mode for Gemini file ingestion
 * - "upload"    → Upload file directly to Gemini via SDK (default)
 * - "presigned" → Store an audit copy in S3 (presigned URL) before Gemini SDK upload
 * Set GEMINI_INPUT_MODE to override; defaults to "upload".
 */
export const GEMINI_INPUT_MODE = (process.env.GEMINI_INPUT_MODE || "upload").toLowerCase();

// ============================================================================
// File Paths
// ============================================================================

/**
 * Default path to the PIP drafting prompt template
 * Default: prompts/draft-pip.txt
 */
export const PIP_PROMPT_PATH = process.env.PIP_PROMPT_PATH || "prompts/draft-pip.txt";

/**
 * Default path to company policy guidelines
 * Default: policies/guidelines.txt
 */
export const GUIDELINES_PATH = "policies/guidelines.txt";

// ============================================================================
// Security Configuration
// ============================================================================

/**
 * Maximum allowed path length in characters
 * Prevents buffer overflow and extremely long path attacks
 * Default: 4096 (standard on most Unix systems)
 */
export const MAX_PATH_LENGTH = 4096;

/**
 * Allowed audio file extensions for transcription
 * Whitelist of safe audio formats supported by ffmpeg/Gemini
 *
 * @security This whitelist prevents uploading malicious file types
 */
export const ALLOWED_AUDIO_EXTENSIONS = [
  ".mp3",
  ".wav",
  ".flac",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".wma",
  ".aiff",
  ".ape",
  ".ac3"
] as const;

/**
 * Allowed document template extensions
 * Whitelist of safe document formats for templates
 *
 * @security This whitelist prevents template injection attacks
 */
export const ALLOWED_TEMPLATE_EXTENSIONS = [
  ".docx"
] as const;

/**
 * Allowed output document extensions
 * Whitelist of safe document formats for output
 */
export const ALLOWED_OUTPUT_EXTENSIONS = [
  ".docx"
] as const;

// ============================================================================
// Pricing Constants
// ============================================================================

/**
 * Claude API pricing as of January 2025
 * Source: https://www.anthropic.com/pricing
 *
 * Update these values when pricing changes to maintain accurate cost tracking.
 */
export const PRICING = {
  /**
   * Cost per million input tokens (MTK)
   * $3.00 per MTK as of January 2025
   */
  INPUT_PER_MTK: 3.0,

  /**
   * Cost per million output tokens (MTK)
   * $15.00 per MTK as of January 2025
   */
  OUTPUT_PER_MTK: 15.0,

  /**
   * Cost per million tokens for cache creation (prompt caching)
   * $3.75 per MTK as of January 2025
   */
  CACHE_CREATION_PER_MTK: 3.75,

  /**
   * Cost per million tokens for cache reads (prompt caching)
   * $0.30 per MTK as of January 2025
   */
  CACHE_READ_PER_MTK: 0.30,

  /**
   * Gemini 2.5 Pro transcription input cost per MTK (≤200k tokens per request)
   * $1.25 per MTK as of January 2025
   * NOTE: For >200k tokens, pricing is $2.50/MTK input and $15/MTK output
   */
  GEMINI_TRANSCRIBE_INPUT_PER_MTK: 1.25,

  /**
   * Gemini 2.5 Pro transcription output cost per MTK (≤200k tokens per request)
   * $10.00 per MTK as of January 2025
   * NOTE: For >200k tokens, pricing is $15/MTK output
   * NOTE: Thinking tokens are billed as output tokens at this rate
   */
  GEMINI_TRANSCRIBE_OUTPUT_PER_MTK: 10.0
} as const;

// ============================================================================
// CLI Argument Parsing Utilities
// ============================================================================

/**
 * Parse command-line arguments in the format --key value
 * Returns a Map of argument keys to values
 */
export function parseCliArgs(): Map<string, string> {
  const args = new Map<string, string>();
  const tokens = process.argv.slice(2);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const trimmed = token.slice(2);
    if (!trimmed) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex !== -1) {
      const key = trimmed.slice(0, equalsIndex);
      const value = trimmed.slice(equalsIndex + 1);
      args.set(key, value || "true");
      continue;
    }

    const nextToken = tokens[i + 1];
    if (!nextToken || nextToken.startsWith("--")) {
      args.set(trimmed, "true");
      continue;
    }

    args.set(trimmed, nextToken);
    i += 1;
  }

  return args;
}

/**
 * Get a configuration value from CLI args, environment, or default
 * Priority: CLI args > environment > default
 */
export function getConfigValue(
  cliArgs: Map<string, string>,
  cliKey: string,
  envKey: string,
  defaultValue: string
): string {
  return cliArgs.get(cliKey) || process.env[envKey] || defaultValue;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate that required API keys are present and properly formatted
 * @returns Validation result with list of errors if any
 *
 * @security Validates both presence and format of API keys to catch
 * configuration errors early before making API calls
 */
export function validateRequiredConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!ANTHROPIC_API_KEY) {
    errors.push("Missing ANTHROPIC_API_KEY in environment");
  } else if (!isValidAnthropicKeyFormat(ANTHROPIC_API_KEY)) {
    errors.push(
      "Invalid ANTHROPIC_API_KEY format. Expected format: sk-ant-api03-... (at least 40 characters). " +
      "Please check your API key from https://console.anthropic.com/"
    );
  }

  if (!GEMINI_API_KEY) {
    errors.push("Missing GEMINI_API_KEY in environment");
  } else if (!isValidGeminiKeyFormat(GEMINI_API_KEY)) {
    errors.push(
      "Invalid GEMINI_API_KEY format. Expected format: AIza... (at least 35 characters). " +
      "Please check your API key from https://aistudio.google.com/app/apikey"
    );
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// ============================================================================
// Configuration Summary
// ============================================================================

/**
 * Get a summary of the current configuration
 * Useful for debugging and logging
 */
export function getConfigSummary() {
  return {
    models: {
      claude: MODELS.CLAUDE_SONNET,
      claudePip: MODELS.CLAUDE_PIP,
      gemini: MODELS.GEMINI_PRO
    },
    pipeline: {
      maxReviewRounds: MAX_REVIEW_ROUNDS,
      maxTurns: MAX_TURNS
    },
    transcription: {
      chunkSeconds: GEMINI_CHUNK_SECONDS,
      singlePassMax: GEMINI_SINGLE_PASS_MAX,
      concurrency: GEMINI_TRANSCRIBE_CONCURRENCY,
      retries: GEMINI_TRANSCRIBE_RETRIES
    },
    pipGeneration: {
      model: PIP_DRAFT_MODEL,
      temperature: PIP_TEMPERATURE,
      maxOutputTokens: PIP_MAX_OUTPUT_TOKENS,
      thinkingBudget: PIP_THINKING_BUDGET,
      promptPath: PIP_PROMPT_PATH
    },
    paths: {
      pipPrompt: PIP_PROMPT_PATH,
      guidelines: GUIDELINES_PATH
    },
    pricing: PRICING
  };
}
