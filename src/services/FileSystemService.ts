/**
 * File System Service - Dependency Injection Wrapper for Node.js fs module
 *
 * This service encapsulates all file system operations, making the codebase
 * more testable by allowing file system interactions to be mocked.
 *
 * @example
 * ```typescript
 * const service = createFileSystemService();
 * const content = await service.readFile("/path/to/file.txt", "utf-8");
 * await service.writeFile("/path/to/output.txt", "content");
 * ```
 */

import * as fs from "node:fs/promises";
import * as fssync from "node:fs";

/**
 * Options for mkdir operation
 */
export interface MkdirOptions {
  /** Create parent directories if they don't exist */
  recursive?: boolean;
}

/**
 * Interface for file system service operations
 *
 * This interface allows for easy mocking in tests:
 * ```typescript
 * const mockFs: IFileSystemService = {
 *   readFile: async () => "mock content",
 *   writeFile: async () => {},
 *   mkdir: async () => {},
 *   exists: async () => true,
 *   existsSync: () => true
 * };
 * ```
 */
export interface IFileSystemService {
  /**
   * Read file contents asynchronously
   *
   * @param path - Path to the file to read
   * @param encoding - Text encoding (e.g., "utf-8") or null for Buffer
   * @returns File contents as string (if encoding specified) or Buffer
   * @throws Error if file doesn't exist or cannot be read
   */
  readFile(path: string, encoding?: BufferEncoding | null): Promise<string | Buffer>;

  /**
   * Write content to a file asynchronously
   *
   * @param path - Path to the file to write
   * @param data - Content to write (string or Buffer)
   * @throws Error if file cannot be written
   */
  writeFile(path: string, data: string | Buffer): Promise<void>;

  /**
   * Create a directory asynchronously
   *
   * @param path - Path to the directory to create
   * @param options - Options like recursive directory creation
   * @throws Error if directory cannot be created
   */
  mkdir(path: string, options?: MkdirOptions): Promise<void>;

  /**
   * Check if a file or directory exists asynchronously
   *
   * @param path - Path to check
   * @returns true if the path exists, false otherwise
   */
  exists(path: string): Promise<boolean>;

  /**
   * Check if a file or directory exists synchronously
   *
   * @param path - Path to check
   * @returns true if the path exists, false otherwise
   */
  existsSync(path: string): boolean;

  /**
   * Read directory contents asynchronously
   *
   * @param path - Path to the directory to read
   * @returns Array of file and directory names
   * @throws Error if directory cannot be read
   */
  readdir(path: string): Promise<string[]>;

  /**
   * Create a temporary directory asynchronously
   *
   * @param prefix - Prefix for the temporary directory name
   * @returns Path to the created temporary directory
   * @throws Error if directory cannot be created
   */
  mkdtemp(prefix: string): Promise<string>;

  /**
   * Remove a directory and its contents recursively asynchronously
   *
   * @param path - Path to the directory to remove
   * @param options - Options like recursive removal
   * @throws Error if directory cannot be removed
   */
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;

  /**
   * Get file or directory statistics asynchronously
   *
   * @param path - Path to the file or directory
   * @returns File statistics including size, modification time, etc.
   * @throws Error if path doesn't exist or cannot be accessed
   */
  stat(path: string): Promise<{ size: number; isFile: () => boolean; isDirectory: () => boolean }>;
}

/**
 * Implementation of the file system service
 *
 * Wraps the Node.js fs module and provides a clean interface
 * for file system operations.
 */
export class FileSystemService implements IFileSystemService {
  /**
   * Read file contents asynchronously
   */
  async readFile(path: string, encoding?: BufferEncoding | null): Promise<string | Buffer> {
    if (encoding) {
      return await fs.readFile(path, encoding);
    }
    return await fs.readFile(path);
  }

  /**
   * Write content to a file asynchronously
   */
  async writeFile(path: string, data: string | Buffer): Promise<void> {
    await fs.writeFile(path, data);
  }

  /**
   * Create a directory asynchronously
   */
  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    await fs.mkdir(path, options);
  }

  /**
   * Check if a file or directory exists asynchronously
   */
  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a file or directory exists synchronously
   */
  existsSync(path: string): boolean {
    return fssync.existsSync(path);
  }

  /**
   * Read directory contents asynchronously
   */
  async readdir(path: string): Promise<string[]> {
    return await fs.readdir(path);
  }

  /**
   * Create a temporary directory asynchronously
   */
  async mkdtemp(prefix: string): Promise<string> {
    return await fs.mkdtemp(prefix);
  }

  /**
   * Remove a directory and its contents recursively asynchronously
   */
  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    await fs.rm(path, options);
  }

  /**
   * Get file or directory statistics asynchronously
   */
  async stat(path: string): Promise<{ size: number; isFile: () => boolean; isDirectory: () => boolean }> {
    const stats = await fs.stat(path);
    return {
      size: stats.size,
      isFile: () => stats.isFile(),
      isDirectory: () => stats.isDirectory()
    };
  }
}

/**
 * Factory function to create a file system service instance
 *
 * This pattern allows for easy service creation while maintaining
 * the ability to swap implementations for testing.
 *
 * @returns An instance of IFileSystemService
 *
 * @example
 * ```typescript
 * const service = createFileSystemService();
 * const content = await service.readFile("/path/to/file.txt", "utf-8");
 * ```
 */
export function createFileSystemService(): IFileSystemService {
  return new FileSystemService();
}
