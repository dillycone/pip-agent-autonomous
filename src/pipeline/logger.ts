/**
 * Pipeline Logger Module
 *
 * This module provides a structured logging interface for the pipeline.
 * It replaces direct console.log/console.error calls with a consistent
 * logging API that can emit events and optionally write to console.
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LogMessage {
  level: LogLevel;
  message: string;
  details?: unknown;
  timestamp?: string;
}

export interface Logger {
  trace(message: string, details?: unknown): void;
  debug(message: string, details?: unknown): void;
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
  fatal(message: string, details?: unknown): void;
}

/**
 * Creates a logger that emits structured log events
 *
 * @param emit - Event emitter function
 * @param enableConsole - Whether to also log to console (default: true)
 * @returns Logger instance
 */
export function createLogger(
  emit: (event: string, data: unknown) => void,
  enableConsole: boolean = true
): Logger {
  const log = (level: LogLevel, message: string, details?: unknown): void => {
    const logMessage: LogMessage = {
      level,
      message,
      timestamp: new Date().toISOString()
    };

    if (details !== undefined) {
      logMessage.details = details;
    }

    // Emit structured log event
    emit("log", logMessage);

    // Also log to console if enabled
    if (enableConsole) {
      const prefix = `[${level.toUpperCase()}]`;
      const logFn = level === "error" || level === "fatal" ? console.error : console.log;

      if (details !== undefined) {
        logFn(prefix, message, details);
      } else {
        logFn(prefix, message);
      }
    }
  };

  return {
    trace: (message: string, details?: unknown) => log("trace", message, details),
    debug: (message: string, details?: unknown) => log("debug", message, details),
    info: (message: string, details?: unknown) => log("info", message, details),
    warn: (message: string, details?: unknown) => log("warn", message, details),
    error: (message: string, details?: unknown) => log("error", message, details),
    fatal: (message: string, details?: unknown) => log("fatal", message, details)
  };
}
