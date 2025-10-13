import * as fsp from "node:fs/promises";
import { createChildLogger } from "./logger.js";

const logger = createChildLogger("cleanup");

/**
 * Resource interface for generic cleanup wrapper
 */
export interface Resource {
  cleanup(): Promise<void>;
}

/**
 * Clean up a temporary directory with proper error logging
 * @param dirPath - Path to the temporary directory to remove
 * @throws Never throws - logs errors instead
 */
export async function cleanupTempDir(dirPath: string): Promise<void> {
  try {
    await fsp.rm(dirPath, { recursive: true, force: true });
    logger.debug({ dirPath }, `✓ Cleaned up temporary directory: ${dirPath}`);
  } catch (error: any) {
    // Log the error instead of silently swallowing it
    logger.warn({ dirPath, error: error?.message }, `⚠️  Failed to clean up temporary directory: ${dirPath}`);
    logger.warn(`   Error: ${error?.message || String(error)}`);
    // Don't throw - cleanup failures shouldn't break the main operation
  }
}

/**
 * Execute a function with automatic resource cleanup
 * @param resource - Resource with cleanup method
 * @param fn - Function to execute
 * @returns The result of the function
 * @throws Rethrows any error from fn after ensuring cleanup
 */
export async function withCleanup<T>(
  resource: Resource,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } finally {
    // Always attempt cleanup, even if fn throws
    try {
      await resource.cleanup();
    } catch (cleanupError: any) {
      // Log cleanup errors but don't mask the original error
      logger.warn({ error: cleanupError?.message }, `⚠️  Resource cleanup failed: ${cleanupError?.message || String(cleanupError)}`);
    }
  }
}

/**
 * Create a resource wrapper for a temp directory
 * @param dirPath - Path to the temporary directory
 * @returns Resource object with cleanup method
 */
export function tempDirResource(dirPath: string): Resource {
  return {
    async cleanup() {
      await cleanupTempDir(dirPath);
    }
  };
}
