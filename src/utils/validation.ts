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
  "C:\\Users\\Public",
  "C:\\Users\\Default",
  "C:\\Users\\Default User",
  "C:\\Users\\All Users"
];

// ============================================================================
// Path Validation Functions
// ============================================================================

function tolerantDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

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

  const normalized = filePath.replace(/\\/g, "/");
  const decoded = tolerantDecode(normalized);

  const containsTraversalSegment = (candidate: string) =>
    candidate
      .split("/")
      .filter((segment) => segment.length > 0)
      .some((segment) => segment === "..");

  if (containsTraversalSegment(normalized) || containsTraversalSegment(decoded)) {
    return true;
  }

  return DANGEROUS_PATH_PATTERNS.some((pattern) => pattern.test(normalized) || pattern.test(decoded));
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
  } catch (error: unknown) {
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

// ============================================================================
// Shell Command Sanitization
// ============================================================================

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
    baseDir?: string;
    allowAbsolute?: boolean;
  }
): ValidationResult {
  const opts = {
    extensions: options?.extensions ?? [],
    allowOverwrite: options?.allowOverwrite ?? true,
    baseDir: options?.baseDir ?? process.cwd(),
    allowAbsolute: options?.allowAbsolute ?? false
  };

  // Validate basic path security
  const pathValidation = validateFilePath(outputPath, {
    mustExist: false,
    extensions: opts.extensions,
    mustBeFile: false,
    allowAbsolute: opts.allowAbsolute,
    baseDir: opts.baseDir
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
  } catch (error: unknown) {
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
