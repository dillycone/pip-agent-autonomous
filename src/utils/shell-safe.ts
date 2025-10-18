/**
 * Shell-Safe Command Execution Utilities
 *
 * This module provides secure wrappers for executing shell commands with
 * comprehensive validation and sanitization to prevent command injection attacks.
 *
 * @security CRITICAL - This module prevents command injection vulnerabilities.
 * All external command execution should go through these wrappers.
 *
 * @warning NEVER use child_process.exec() or shell: true with user input.
 * Always use spawn() with argument arrays and validation.
 */

import { spawn, SpawnOptions } from "node:child_process";
import { extname } from "node:path";
import { validateFilePath } from "./validation.js";
import { PROJECT_ROOT } from "./paths.js";
import { FILE_OPERATION_TIMEOUT, BUFFER_SIZE } from "../constants/timeouts.js";

// ============================================================================
// Command Whitelist
// ============================================================================

/**
 * Whitelist of allowed commands
 * Only these commands can be executed through safeSpawn
 *
 * @security This whitelist prevents arbitrary command execution.
 * Add commands with extreme caution.
 */
const ALLOWED_COMMANDS = new Set([
  "ffmpeg",
  "ffprobe",
]);

// ============================================================================
// Types
// ============================================================================

/**
 * Result of safe command execution
 */
export interface CommandResult {
  /** Standard output from the command */
  stdout: string;
  /** Standard error from the command */
  stderr: string;
  /** Exit code (0 = success) */
  exitCode: number;
}

/**
 * Options for safe command execution
 */
export interface SafeSpawnOptions {
  /** Working directory for command execution */
  cwd?: string;
  /** Environment variables (merged with process.env) */
  env?: Record<string, string>;
  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeout?: number;
  /** Maximum stdout buffer size in bytes (default: 10MB) */
  maxBuffer?: number;
  /** Validate file path arguments (default: true) */
  validatePaths?: boolean;
}

// ============================================================================
// Command Validation
// ============================================================================

/**
 * Validates that a command is in the whitelist
 *
 * @param command - The command to validate
 * @throws Error if command is not whitelisted
 *
 * @security This prevents execution of arbitrary commands
 */
function validateCommand(command: string): void {
  if (!command || typeof command !== "string") {
    throw new Error("Command must be a non-empty string");
  }

  // Extract base command name (remove path)
  const baseCommand = command.split("/").pop()?.split("\\").pop() || command;

  if (!ALLOWED_COMMANDS.has(baseCommand)) {
    throw new Error(
      `Command "${baseCommand}" is not whitelisted. ` +
      `Allowed commands: ${Array.from(ALLOWED_COMMANDS).join(", ")}`
    );
  }
}

/**
 * Validates command arguments for safety
 *
 * @param args - Arguments to validate
 * @param options - Validation options
 * @returns Validated and potentially sanitized arguments
 *
 * @security This function detects and blocks injection attempts
 */
function validateArguments(
  args: string[],
  options: { validatePaths?: boolean } = {}
): string[] {
  const validatedArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (typeof arg !== "string") {
      throw new Error(`Argument at index ${i} must be a string`);
    }

    // Check for null bytes
    if (arg.includes("\x00")) {
      throw new Error(
        `Argument at index ${i} contains null bytes (potential injection attempt)`
      );
    }

    // Check for newlines (potential injection)
    if (arg.includes("\n") || arg.includes("\r")) {
      throw new Error(
        `Argument at index ${i} contains newlines (potential injection attempt)`
      );
    }

    // If this looks like a file path argument, validate it
    if (options.validatePaths && isFilePath(arg, args[i - 1])) {
      // Path validation for file arguments
      // Allow paths that exist or look like output paths
      const validation = validateFilePath(arg, {
        mustExist: false, // Don't require existence (output files may not exist yet)
        allowAbsolute: true, // ffmpeg/ffprobe may need absolute paths
        baseDir: PROJECT_ROOT
      });

      if (!validation.valid) {
        throw new Error(
          `Invalid file path at argument ${i}: ${validation.error}. ${validation.hint || ""}`
        );
      }

      // Use the sanitized path
      validatedArgs.push(validation.sanitizedPath!);
    } else {
      validatedArgs.push(arg);
    }
  }

  return validatedArgs;
}

/**
 * Heuristic to detect if an argument is likely a file path
 *
 * @param arg - The argument to check
 * @param previousArg - The previous argument (to check for file flags)
 * @returns True if argument appears to be a file path
 */
function isFilePath(arg: string, previousArg?: string): boolean {
  const normalizedArg = arg.trim();
  if (/^(https?:|data:|pipe:)/i.test(normalizedArg)) {
    return false;
  }

  // Check if previous argument was a file-related flag
  const fileFlags = ["-i", "-o", "--input", "--output", "--file"];
  if (previousArg && fileFlags.includes(previousArg)) {
    return true;
  }

  const hasSeparator = normalizedArg.includes("/") || normalizedArg.includes("\\");
  const hasRelativePrefix = normalizedArg.startsWith("./") || normalizedArg.startsWith("../");
  const hasExtension = Boolean(extname(normalizedArg));

  return hasSeparator || hasRelativePrefix || hasExtension;
}

// ============================================================================
// Safe Command Execution
// ============================================================================

/**
 * Safely executes a shell command with comprehensive validation
 *
 * @param command - The command to execute (must be whitelisted)
 * @param args - Command arguments (will be validated)
 * @param options - Execution options
 * @returns Promise resolving to command output
 *
 * @throws Error if command is not whitelisted, arguments are invalid,
 *         or command execution fails
 *
 * @example
 * // Safe usage
 * const result = await safeSpawn("ffprobe", ["-v", "error", "audio.mp3"]);
 *
 * // Unsafe - will throw error
 * await safeSpawn("rm", ["-rf", "/"]); // Not whitelisted
 * await safeSpawn("ffmpeg", ["file.mp3; rm -rf /"]); // Injection detected
 *
 * @security This is the primary defense against command injection.
 * Key security features:
 * - Command whitelist prevents arbitrary command execution
 * - Argument validation detects injection patterns
 * - File path validation prevents path traversal
 * - No shell interpretation (spawn vs exec)
 * - Timeout prevents resource exhaustion
 * - Buffer limits prevent memory exhaustion
 */
export async function safeSpawn(
  command: string,
  args: string[],
  options?: SafeSpawnOptions
): Promise<CommandResult> {
  // Normalize options
  const baseEnv: Record<string, string> = {};
  if (process.env) {
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        baseEnv[key] = value;
      }
    }
  }

  const opts: Required<SafeSpawnOptions> = {
    cwd: options?.cwd || process.cwd(),
    env: { ...baseEnv, ...options?.env },
    timeout: options?.timeout ?? 300000, // 5 minutes default
    maxBuffer: options?.maxBuffer ?? BUFFER_SIZE, // 10MB default
    validatePaths: options?.validatePaths ?? true,
  };

  // Validate command is whitelisted
  validateCommand(command);

  // Validate and sanitize arguments
  const validatedArgs = validateArguments(args, {
    validatePaths: opts.validatePaths
  });

  // Prepare spawn options
  const spawnOptions: SpawnOptions = {
    cwd: opts.cwd,
    env: opts.env as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"], // No stdin, capture stdout/stderr
  };

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let killed = false;

    // Start the process
    const child = spawn(command, validatedArgs, spawnOptions);

    // Set timeout
    const timeoutId = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");

      // Force kill after 5 seconds
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, FILE_OPERATION_TIMEOUT);
    }, opts.timeout);

    // Collect stdout
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();

      // Check buffer size
      if (stdout.length > opts.maxBuffer) {
        killed = true;
        child.kill("SIGTERM");
        reject(new Error(
          `Command output exceeded maximum buffer size (${opts.maxBuffer} bytes)`
        ));
      }
    });

    // Collect stderr
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();

      // Check buffer size
      if (stderr.length > opts.maxBuffer) {
        killed = true;
        child.kill("SIGTERM");
        reject(new Error(
          `Command error output exceeded maximum buffer size (${opts.maxBuffer} bytes)`
        ));
      }
    });

    // Handle process errors (e.g., command not found)
    child.on("error", (error) => {
      clearTimeout(timeoutId);
      reject(new Error(
        `Failed to execute command "${command}": ${error.message}`
      ));
    });

    // Handle process exit
    child.on("close", (code) => {
      clearTimeout(timeoutId);

      if (killed) {
        reject(new Error(
          `Command "${command}" was killed (timeout or buffer exceeded)`
        ));
        return;
      }

      const exitCode = code ?? -1;

      if (exitCode === 0) {
        // Success
        resolve({ stdout, stderr, exitCode: 0 });
      } else {
        // Non-zero exit code
        reject(new Error(
          `${command} exited with code ${exitCode}: ${stderr || stdout}`
        ));
      }
    });
  });
}

