/**
 * Input Validation and Path Security Utilities
 *
 * This module provides comprehensive validation for file paths and user inputs
 * to prevent security vulnerabilities including:
 * - Path traversal attacks (../)
 * - Command injection
 * - Access to sensitive system files
 * - Malicious file extensions
 *
 * @security CRITICAL - These functions are the first line of defense against
 * path traversal and command injection attacks. Any modifications must be
 * carefully reviewed for security implications.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// Custom Error Types
// ============================================================================

/**
 * Error thrown when path validation fails
 * This error type allows catching and handling validation failures separately
 */
export class PathValidationError extends Error {
  public readonly validationIssue: string;
  public readonly attemptedPath: string;
  public readonly hint?: string;

  constructor(message: string, attemptedPath: string, hint?: string) {
    super(message);
    this.name = "PathValidationError";
    this.validationIssue = message;
    this.attemptedPath = attemptedPath;
    this.hint = hint;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, PathValidationError.prototype);
  }
}

// ============================================================================
// Validation Result Types
// ============================================================================

/**
 * Result of path validation operation
 */
export interface ValidationResult {
  /** Whether the validation passed */
  valid: boolean;
  /** Sanitized/normalized path (only present if valid) */
  sanitizedPath?: string;
  /** Error message (only present if invalid) */
  error?: string;
  /** Helpful hint for the user (only present if invalid) */
  hint?: string;
}

// ============================================================================
// Security Constants
// ============================================================================

/**
 * Dangerous path patterns that should be blocked
 * These patterns indicate potential path traversal or access to sensitive files
 */
const DANGEROUS_PATH_PATTERNS = [
  /\.\./,           // Path traversal (..)
  /\/\.\./,         // Path traversal with slash
  /\.\.\//,         // Path traversal with trailing slash
  /\.\.\\/,         // Windows path traversal
  /~\//,            // Home directory expansion
  /\$\{/,           // Variable interpolation
  /\$\(/,           // Command substitution
  /`/,              // Backticks for command substitution
  /\|/,             // Pipe operator
  /;/,              // Command separator
  /&/,              // Background operator
  /\n/,             // Newline (multiline injection)
  /\r/,             // Carriage return
  /\x00/,           // Null byte
];

/**
 * File paths that should always be blocked (sensitive system files)
 */
const BLOCKED_PATHS = [
  "/etc/passwd",
  "/etc/shadow",
  "/etc/hosts",
  "/.env",
  "/.aws/credentials",
  "/.ssh/id_rsa",
  "/proc/self/environ",
  "C:\\Windows\\System32",
  "C:\\Users\\",
];

/**
 * Shell metacharacters that need escaping
 * These characters have special meaning in shells and must be escaped
 */
const SHELL_METACHARACTERS = /[;&|`$()\\<>\n\r\x00"']/g;

// ============================================================================
// Path Validation Functions
// ============================================================================

/**
 * Detects potential path traversal attempts
 *
 * @param filePath - The path to check
 * @returns True if path traversal is detected
 *
 * @example
 * isPathTraversal("../etc/passwd") // true
 * isPathTraversal("uploads/file.mp3") // false
 */
export function isPathTraversal(filePath: string): boolean {
  if (!filePath) return false;

  // Check for .. in the path
  if (filePath.includes("..")) {
    return true;
  }

  // Check for dangerous patterns
  return DANGEROUS_PATH_PATTERNS.some(pattern => pattern.test(filePath));
}

/**
 * Checks if a path attempts to access sensitive system files
 *
 * @param filePath - The path to check
 * @returns True if path accesses sensitive files
 */
export function isSensitiveSystemPath(filePath: string): boolean {
  if (!filePath) return false;

  const normalized = path.normalize(filePath).toLowerCase();

  return BLOCKED_PATHS.some(blocked => {
    const blockedNormalized = path.normalize(blocked).toLowerCase();
    return normalized === blockedNormalized || normalized.startsWith(blockedNormalized);
  });
}

/**
 * Validates and normalizes a file path with comprehensive security checks
 *
 * @param filePath - The file path to validate
 * @param options - Validation options
 * @param options.mustExist - If true, path must exist on filesystem
 * @param options.allowAbsolute - If true, allow absolute paths
 * @param options.extensions - Allowed file extensions (e.g., [".mp3", ".wav"])
 * @param options.baseDir - Base directory to resolve relative paths against
 * @param options.mustBeFile - If true, path must be a file (not directory)
 * @param options.mustBeDirectory - If true, path must be a directory
 *
 * @returns Validation result with sanitized path if valid
 *
 * @example
 * validateFilePath("uploads/audio.mp3", {
 *   mustExist: true,
 *   extensions: [".mp3", ".wav"]
 * })
 *
 * @security This function is critical for preventing path traversal attacks
 */
export function validateFilePath(
  filePath: string,
  options?: {
    mustExist?: boolean;
    allowAbsolute?: boolean;
    extensions?: string[];
    baseDir?: string;
    mustBeFile?: boolean;
    mustBeDirectory?: boolean;
  }
): ValidationResult {
  // Normalize options
  const opts = {
    mustExist: options?.mustExist ?? false,
    allowAbsolute: options?.allowAbsolute ?? false,
    extensions: options?.extensions ?? [],
    baseDir: options?.baseDir ?? process.cwd(),
    mustBeFile: options?.mustBeFile ?? false,
    mustBeDirectory: options?.mustBeDirectory ?? false,
  };

  // Basic validation
  if (!filePath || typeof filePath !== "string") {
    return {
      valid: false,
      error: "File path must be a non-empty string",
      hint: "Provide a valid file path"
    };
  }

  // Check length limits
  if (filePath.length > 4096) {
    return {
      valid: false,
      error: "File path exceeds maximum length",
      hint: "Path must be less than 4096 characters"
    };
  }

  // Check for path traversal attempts
  if (isPathTraversal(filePath)) {
    return {
      valid: false,
      error: "Path traversal detected",
      hint: "Path contains invalid characters or patterns (../, ~/, etc.)"
    };
  }

  // Check for sensitive system paths
  if (isSensitiveSystemPath(filePath)) {
    return {
      valid: false,
      error: "Access to sensitive system files is blocked",
      hint: "Cannot access system configuration or credential files"
    };
  }

  // Normalize and resolve the path
  let normalizedPath: string;
  try {
    if (path.isAbsolute(filePath)) {
      if (!opts.allowAbsolute) {
        return {
          valid: false,
          error: "Absolute paths are not allowed",
          hint: "Use relative paths only"
        };
      }
      normalizedPath = path.normalize(filePath);
    } else {
      normalizedPath = path.resolve(opts.baseDir, filePath);
    }
  } catch (error) {
    return {
      valid: false,
      error: "Failed to normalize path",
      hint: "Path contains invalid characters"
    };
  }

  // Ensure normalized path is still within base directory (prevent traversal via normalization)
  if (!opts.allowAbsolute) {
    const normalizedBase = path.resolve(opts.baseDir);
    const relative = path.relative(normalizedBase, normalizedPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return {
        valid: false,
        error: "Path escapes base directory",
        hint: "Path must remain within the project directory"
      };
    }
  }

  // Check if path exists (if required)
  if (opts.mustExist) {
    if (!fs.existsSync(normalizedPath)) {
      return {
        valid: false,
        error: `File not found: ${filePath}`,
        hint: "Ensure the file exists at the specified path"
      };
    }

    // Check if it's a file or directory
    const stats = fs.statSync(normalizedPath);

    if (opts.mustBeFile && !stats.isFile()) {
      return {
        valid: false,
        error: "Path must be a file, not a directory",
        hint: "Specify a file path, not a directory"
      };
    }

    if (opts.mustBeDirectory && !stats.isDirectory()) {
      return {
        valid: false,
        error: "Path must be a directory, not a file",
        hint: "Specify a directory path, not a file"
      };
    }
  }

  // Validate file extension
  if (opts.extensions.length > 0) {
    const ext = path.extname(normalizedPath).toLowerCase();
    const allowedExtensions = opts.extensions.map(e => e.toLowerCase());

    if (!allowedExtensions.includes(ext)) {
      return {
        valid: false,
        error: `Invalid file extension: ${ext}`,
        hint: `Allowed extensions: ${opts.extensions.join(", ")}`
      };
    }
  }

  // All checks passed
  return {
    valid: true,
    sanitizedPath: normalizedPath
  };
}

/**
 * Normalizes and validates a path against a base directory
 * Ensures the resolved path remains within the base directory
 *
 * @param filePath - The path to validate
 * @param baseDir - The base directory to resolve against
 * @returns Normalized absolute path
 * @throws PathValidationError if validation fails
 *
 * @example
 * normalizeAndValidatePath("uploads/file.mp3", "/app")
 * // Returns: "/app/uploads/file.mp3"
 *
 * normalizeAndValidatePath("../etc/passwd", "/app")
 * // Throws: PathValidationError
 */
export function normalizeAndValidatePath(filePath: string, baseDir: string): string {
  const result = validateFilePath(filePath, {
    baseDir,
    allowAbsolute: false
  });

  if (!result.valid) {
    throw new PathValidationError(
      result.error || "Path validation failed",
      filePath,
      result.hint
    );
  }

  return result.sanitizedPath!;
}

/**
 * Validates that a directory path exists or can be created
 * If mustExist is false, validates that parent directory exists
 *
 * @param dirPath - Directory path to validate
 * @param options - Validation options
 * @returns Validation result
 */
export function validateDirectoryPath(
  dirPath: string,
  options?: {
    mustExist?: boolean;
    allowCreate?: boolean;
  }
): ValidationResult {
  const opts = {
    mustExist: options?.mustExist ?? false,
    allowCreate: options?.allowCreate ?? true,
  };

  // First validate as a general path
  const baseValidation = validateFilePath(dirPath, {
    mustExist: opts.mustExist,
    mustBeDirectory: opts.mustExist
  });

  if (!baseValidation.valid) {
    return baseValidation;
  }

  // If directory doesn't need to exist, check parent directory
  if (!opts.mustExist && opts.allowCreate) {
    const parentDir = path.dirname(baseValidation.sanitizedPath!);

    if (!fs.existsSync(parentDir)) {
      return {
        valid: false,
        error: "Parent directory does not exist",
        hint: `Create parent directory first: ${parentDir}`
      };
    }

    const parentStats = fs.statSync(parentDir);
    if (!parentStats.isDirectory()) {
      return {
        valid: false,
        error: "Parent path is not a directory",
        hint: "Parent must be a directory"
      };
    }
  }

  return baseValidation;
}

// ============================================================================
// Shell Command Sanitization
// ============================================================================

/**
 * Sanitizes a string for safe use in shell commands
 * Escapes shell metacharacters and dangerous patterns
 *
 * @param arg - The argument to sanitize
 * @returns Sanitized argument safe for shell execution
 *
 * @warning This function should be used with caution. Prefer using
 * argument arrays with spawn() over shell string concatenation.
 *
 * @example
 * sanitizeForShellCommand("file.mp3") // "file.mp3"
 * sanitizeForShellCommand("file; rm -rf /") // "file\\; rm -rf /"
 */
export function sanitizeForShellCommand(arg: string): string {
  if (!arg || typeof arg !== "string") {
    return "";
  }

  // Remove null bytes
  let sanitized = arg.replace(/\x00/g, "");

  // Escape shell metacharacters
  sanitized = sanitized.replace(SHELL_METACHARACTERS, (char) => {
    // For backtick, quote, and dollar sign, use backslash escape
    if (char === "`" || char === "$" || char === '"' || char === "'") {
      return "\\" + char;
    }
    // For other dangerous characters, replace with underscore
    return "_";
  });

  return sanitized;
}

/**
 * Validates that a string does not contain shell injection patterns
 *
 * @param input - The input to validate
 * @returns Validation result
 */
export function validateShellSafe(input: string): ValidationResult {
  if (!input || typeof input !== "string") {
    return {
      valid: false,
      error: "Input must be a non-empty string"
    };
  }

  // Check for shell metacharacters
  if (SHELL_METACHARACTERS.test(input)) {
    return {
      valid: false,
      error: "Input contains shell metacharacters",
      hint: "Remove special characters like ;, &, |, $, `, etc."
    };
  }

  // Check for command substitution patterns
  if (input.includes("$(") || input.includes("`")) {
    return {
      valid: false,
      error: "Command substitution detected",
      hint: "Remove $() or backtick command substitution"
    };
  }

  return {
    valid: true,
    sanitizedPath: input
  };
}

/**
 * Validates output path for writing files
 * Ensures parent directory exists and path is safe
 *
 * @param outputPath - The output file path
 * @param options - Validation options
 * @returns Validation result
 */
export function validateOutputPath(
  outputPath: string,
  options?: {
    extensions?: string[];
    allowOverwrite?: boolean;
  }
): ValidationResult {
  const opts = {
    extensions: options?.extensions ?? [],
    allowOverwrite: options?.allowOverwrite ?? true,
  };

  // Validate basic path security
  const pathValidation = validateFilePath(outputPath, {
    mustExist: false,
    extensions: opts.extensions,
    mustBeFile: false
  });

  if (!pathValidation.valid) {
    return pathValidation;
  }

  const sanitizedPath = pathValidation.sanitizedPath!;

  // Check if file already exists
  if (!opts.allowOverwrite && fs.existsSync(sanitizedPath)) {
    return {
      valid: false,
      error: "Output file already exists",
      hint: "Choose a different output path or enable overwrite"
    };
  }

  // Validate parent directory
  const parentDir = path.dirname(sanitizedPath);

  if (!fs.existsSync(parentDir)) {
    return {
      valid: false,
      error: "Output directory does not exist",
      hint: `Create directory first: ${parentDir}`
    };
  }

  const parentStats = fs.statSync(parentDir);
  if (!parentStats.isDirectory()) {
    return {
      valid: false,
      error: "Parent path is not a directory",
      hint: "Output path parent must be a directory"
    };
  }

  // Check write permissions by testing if directory is writable
  try {
    fs.accessSync(parentDir, fs.constants.W_OK);
  } catch (error) {
    return {
      valid: false,
      error: "No write permission for output directory",
      hint: "Ensure you have write permissions for the output directory"
    };
  }

  return {
    valid: true,
    sanitizedPath
  };
}
