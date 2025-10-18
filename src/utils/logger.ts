/**
 * Structured Logging Module
 *
 * This module provides a centralized logging solution using Pino.
 * Features:
 * - Structured JSON logging in production
 * - Pretty-printed logs in development
 * - Configurable log levels
 * - Automatic redaction of sensitive fields
 * - Child loggers for module-specific contexts
 */

import pino, { type LevelWithSilent, type Logger } from "pino";

/**
 * Determine if we're in development mode
 */
const isDevelopment = process.env.NODE_ENV !== "production";

/**
 * Get log level from environment or use default
 * Priority: LOG_LEVEL env var > default 'info'
 */
const logLevel = (process.env.LOG_LEVEL || "info") as LevelWithSilent;

/**
 * Configure pino transport for pretty printing in development
 * DISABLED: pino-pretty uses worker threads which don't work in Next.js webpack builds
 * Use basic pino logging instead
 */
const transport = undefined;

/**
 * Main logger instance
 * Configured with:
 * - Environment-based formatting (pretty in dev, JSON in prod)
 * - Sensitive field redaction
 * - Configurable log level
 */
export const logger = pino({
  level: logLevel,
  transport,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['set-cookie']",
      "req.headers['x-api-key']",
      "req.headers['x-auth-token']"
    ],
    remove: true
  },
  formatters: {
    level: (label: string) => {
      return { level: label };
    }
  },
  // Add timestamp in production
  timestamp: !isDevelopment ? pino.stdTimeFunctions.isoTime : undefined
});

/**
 * Create a child logger with a specific name/context
 * Useful for module-specific logging
 *
 * @param name - Name of the module or component
 * @returns Child logger instance with name context
 *
 * @example
 * const moduleLogger = createChildLogger('gemini-transcriber');
 * moduleLogger.info('Processing audio file');
 */
export function createChildLogger(name: string): Logger {
  return logger.child({ module: name });
}

// Export default logger for convenience
export default logger;
