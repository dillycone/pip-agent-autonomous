import * as fsp from "node:fs/promises";
import { createChildLogger } from "./logger.js";

const logger = createChildLogger("cleanup");

/**
 * Clean up a temporary directory with proper error logging
 * @param dirPath - Path to the temporary directory to remove
 * @throws Never throws - logs errors instead
 */
export async function cleanupTempDir(dirPath: string): Promise<void> {
  try {
    await fsp.rm(dirPath, { recursive: true, force: true });
    logger.debug({ dirPath }, `✓ Cleaned up temporary directory: ${dirPath}`);
  } catch (error: unknown) {
    // Log the error instead of silently swallowing it
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ dirPath, error: message }, `⚠️  Failed to clean up temporary directory: ${dirPath}`);
    logger.warn(`   Error: ${message}`);
    // Don't throw - cleanup failures shouldn't break the main operation
  }
}

