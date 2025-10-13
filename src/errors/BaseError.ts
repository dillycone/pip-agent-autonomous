/**
 * Base error class for all application errors.
 * Extends the native Error class with additional metadata for better error handling.
 */

export interface ErrorMetadata {
  [key: string]: unknown;
}

/**
 * Base application error class.
 * All custom errors in the application should extend this class.
 */
export class AppError extends Error {
  /**
   * Unique error code for identifying error types.
   */
  public readonly code: string;

  /**
   * HTTP-style status code (e.g., 400, 500).
   */
  public readonly statusCode: number;

  /**
   * Indicates if this is an operational error (expected/recoverable) vs programming error.
   * Operational errors (true): network failures, validation errors, missing files.
   * Programming errors (false): null reference errors, type errors, logic bugs.
   */
  public readonly isOperational: boolean;

  /**
   * Additional metadata about the error.
   */
  public readonly metadata?: ErrorMetadata;

  /**
   * Creates a new AppError instance.
   *
   * @param message - Human-readable error message
   * @param code - Unique error code for identifying error types
   * @param statusCode - HTTP-style status code (default: 500)
   * @param metadata - Additional context about the error
   * @param isOperational - Whether this is an expected/recoverable error (default: true)
   */
  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    metadata?: ErrorMetadata,
    isOperational: boolean = true
  ) {
    super(message);

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.metadata = metadata;

    // Set the prototype explicitly to support instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Serializes the error to a JSON-safe object.
   * Useful for logging and API responses.
   *
   * @returns JSON-serializable error object
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      isOperational: this.isOperational,
      metadata: this.metadata,
      stack: this.stack
    };
  }
}
