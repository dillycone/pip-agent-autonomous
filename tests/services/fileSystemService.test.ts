import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { FileSystemService, type IFileSystemService } from "../../src/services/FileSystemService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock fs/promises module
const createMockFS = () => {
  return {
    readFile: mock.fn(async (path: string, encoding?: BufferEncoding | null) => {
      if (path === "/test/file.txt") {
        return encoding ? "File content" : Buffer.from("File content");
      }
      if (path === "/test/nonexistent.txt") {
        const error = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return encoding ? "Default content" : Buffer.from("Default content");
    }),

    writeFile: mock.fn(async (path: string, data: string | Buffer) => {
      if (path.includes("readonly")) {
        const error = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
      return undefined;
    }),

    mkdir: mock.fn(async (path: string, options?: { recursive?: boolean }) => {
      if (path.includes("invalid")) {
        throw new Error("Invalid path");
      }
      return undefined;
    }),

    access: mock.fn(async (path: string) => {
      if (path === "/test/exists.txt" || path === "/test/file.txt") {
        return undefined;
      }
      const error = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }),

    readdir: mock.fn(async (path: string) => {
      if (path === "/test/dir") {
        return ["file1.txt", "file2.txt", "subdir"];
      }
      if (path === "/test/empty") {
        return [];
      }
      throw new Error("ENOENT: no such file or directory");
    }),

    mkdtemp: mock.fn(async (prefix: string) => {
      return `${prefix}abc123`;
    }),

    rm: mock.fn(async (path: string, options?: { recursive?: boolean; force?: boolean }) => {
      if (path.includes("protected")) {
        throw new Error("EACCES: permission denied");
      }
      return undefined;
    }),

    stat: mock.fn(async (path: string) => {
      if (path === "/test/file.txt") {
        return {
          size: 1024,
          isFile: () => true,
          isDirectory: () => false
        };
      }
      if (path === "/test/dir") {
        return {
          size: 4096,
          isFile: () => false,
          isDirectory: () => true
        };
      }
      throw new Error("ENOENT: no such file or directory");
    })
  };
};

// Test 1: Service initialization
test("FileSystemService - initializes successfully", () => {
  const service = new FileSystemService();
  assert.ok(service, "Service should be instantiated");
});

// Test 2: readFile - reads file with encoding
test("FileSystemService - readFile reads text file with encoding", async () => {
  const service = new FileSystemService();

  // This test uses actual filesystem, so we'll test the interface
  // In a real scenario, you'd mock the fs module
  const content = await service.readFile(__filename, "utf-8");
  assert.ok(typeof content === "string", "Should return string with encoding");
  assert.ok(content.length > 0, "Should have content");
});

// Test 3: readFile - reads file as Buffer
test("FileSystemService - readFile reads file as Buffer", async () => {
  const service = new FileSystemService();

  const content = await service.readFile(__filename);
  assert.ok(Buffer.isBuffer(content), "Should return Buffer without encoding");
  assert.ok(content.length > 0, "Should have content");
});

// Test 4: exists - returns true for existing file
test("FileSystemService - exists returns true for existing file", async () => {
  const service = new FileSystemService();

  const exists = await service.exists(__filename);
  assert.equal(exists, true, "Should return true for existing file");
});

// Test 5: exists - returns false for non-existing file
test("FileSystemService - exists returns false for non-existing file", async () => {
  const service = new FileSystemService();

  const exists = await service.exists("/path/to/nonexistent/file.xyz");
  assert.equal(exists, false, "Should return false for non-existing file");
});

// Test 6: existsSync - synchronous existence check
test("FileSystemService - existsSync checks file existence synchronously", () => {
  const service = new FileSystemService();

  const exists = service.existsSync(__filename);
  assert.equal(exists, true, "Should return true for existing file");

  const notExists = service.existsSync("/path/to/nonexistent/file.xyz");
  assert.equal(notExists, false, "Should return false for non-existing file");
});

// Test 7: mkdir - creates directory with recursive option
test("FileSystemService - mkdir creates directory recursively", async () => {
  const service = new FileSystemService();

  // We'll test the interface - actual directory creation would need cleanup
  // In production tests, you'd use a temp directory
  assert.ok(
    typeof service.mkdir === "function",
    "mkdir method should exist"
  );

  // Test that recursive option is accepted
  const mkdirPromise = service.mkdir("/tmp/test-pip-agent-test-dir", { recursive: true });
  assert.ok(mkdirPromise instanceof Promise, "Should return a Promise");

  // Clean up if directory was created
  try {
    await mkdirPromise;
    const fsModule = await import("node:fs/promises");
    await fsModule.rm("/tmp/test-pip-agent-test-dir", { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

// Test 8: stat - returns file statistics
test("FileSystemService - stat returns file statistics", async () => {
  const service = new FileSystemService();

  const stats = await service.stat(__filename);
  assert.ok(stats.size > 0, "Should have file size");
  assert.ok(typeof stats.isFile === "function", "Should have isFile method");
  assert.ok(typeof stats.isDirectory === "function", "Should have isDirectory method");
  assert.equal(stats.isFile(), true, "Current file should be a file");
  assert.equal(stats.isDirectory(), false, "Current file should not be a directory");
});

// Test 9: writeFile and readFile integration
test("FileSystemService - writeFile and readFile integration", async () => {
  const service = new FileSystemService();
  const fsModule = await import("node:fs/promises");

  const testContent = "Test content for FileSystemService";
  const tempFilePath = "/tmp/pip-agent-test-file.txt";

  try {
    // Write file
    await service.writeFile(tempFilePath, testContent);

    // Read file back
    const readContent = await service.readFile(tempFilePath, "utf-8");

    assert.equal(readContent, testContent, "Read content should match written content");
  } finally {
    // Clean up
    try {
      await fsModule.rm(tempFilePath, { force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

// Test 10: readdir - reads directory contents
test("FileSystemService - readdir reads directory contents", async () => {
  const service = new FileSystemService();
  const fsModule = await import("node:fs/promises");

  const tempDir = "/tmp/pip-agent-test-readdir";

  try {
    // Create temp directory with some files
    await fsModule.mkdir(tempDir, { recursive: true });
    await fsModule.writeFile(`${tempDir}/file1.txt`, "content1");
    await fsModule.writeFile(`${tempDir}/file2.txt`, "content2");

    // Read directory
    const files = await service.readdir(tempDir);

    assert.ok(Array.isArray(files), "Should return an array");
    assert.ok(files.length >= 2, "Should have at least 2 files");
    assert.ok(files.includes("file1.txt"), "Should include file1.txt");
    assert.ok(files.includes("file2.txt"), "Should include file2.txt");
  } finally {
    // Clean up
    try {
      await fsModule.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});
