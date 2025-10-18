/**
 * Timeout and interval constants for the PIP Agent application.
 *
 * This module centralizes all timeout-related configuration to improve
 * maintainability and prevent magic numbers from being scattered throughout
 * the codebase.
 */

/**
 * Maximum time (in milliseconds) to wait for MCP (Model Context Protocol) requests.
 *
 * This timeout is used for long-running operations like:
 * - Gemini audio transcription (which can take several minutes for longer files)
 * - Claude drafting and review operations
 *
 * Set to 10 minutes to accommodate large audio files and complex drafting tasks.
 * The Anthropic SDK reads this value when handling MCP requests.
 *
 * @default 600000 (10 minutes)
 */
export const MCP_REQUEST_TIMEOUT = 10 * 60 * 1000;

/**
 * Time-to-live (in milliseconds) for pipeline run records in the run store.
 *
 * After this duration of inactivity, run records are eligible for cleanup
 * to prevent memory leaks from abandoned or completed pipeline runs.
 *
 * @default 1800000 (30 minutes)
 */
export const RUN_TTL = 30 * 60 * 1000;

/**
 * Interval (in milliseconds) at which the run store cleanup routine executes.
 *
 * The cleanup routine periodically removes expired run records to maintain
 * optimal memory usage.
 *
 * @default 300000 (5 minutes)
 */
export const CLEANUP_INTERVAL = 5 * 60 * 1000;

/**
 * Maximum number of events to buffer per pipeline run in the run store.
 *
 * This prevents unbounded memory growth for long-running pipelines by
 * limiting the number of historical events kept in memory. Older events
 * are removed when this limit is exceeded.
 *
 * @default 1000
 */
export const MAX_BUFFERED_EVENTS = 1000;

/**
 * Timeout (in milliseconds) for file system operations in shell-safe utilities.
 *
 * This timeout prevents hanging operations when executing commands like
 * ffmpeg or ffprobe that interact with the file system.
 *
 * @default 5000 (5 seconds)
 */
export const FILE_OPERATION_TIMEOUT = 5000;

/**
 * Maximum buffer size (in bytes) for command output streams.
 *
 * This limit prevents memory exhaustion from commands that produce
 * excessive output (stdout/stderr). Commands exceeding this buffer
 * size will be terminated.
 *
 * @default 10485760 (10 MB)
 */
export const BUFFER_SIZE = 10 * 1024 * 1024;
