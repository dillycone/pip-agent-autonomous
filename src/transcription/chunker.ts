import * as path from "node:path";
import * as os from "node:os";
import type { IFileSystemService } from "../services/index.js";
import { sanitizeError } from "../utils/sanitize.js";
import { runCommand, probeDuration } from "./audioValidation.js";

export type ChunkInfo = { path: string; index: number; offsetSeconds: number };

export type LogFn = (level: "info" | "warn" | "error", data: Record<string, unknown>, message: string) => void;

export async function runWithConcurrency<T>(
  items: ChunkInfo[],
  worker: (item: ChunkInfo) => Promise<T>,
  options: { concurrency: number; onProgress?: (completed: number, total: number) => void }
): Promise<T[]> {
  const { concurrency, onProgress } = options;
  const results: T[] = new Array(items.length);
  let cursor = 0;
  let completed = 0;

  const runner = async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) break;
      const item = items[index];
      results[index] = await worker(item);
      completed++;
      if (onProgress) {
        onProgress(completed, items.length);
      }
    }
  };

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const workers = Array.from({ length: workerCount }, runner);
  await Promise.all(workers);
  return results;
}

export async function splitAudio(params: {
  fsService: IFileSystemService;
  filePath: string;
  chunkSeconds: number;
  log: LogFn;
}): Promise<{ tmpDir: string; chunks: ChunkInfo[] }> {
  const { fsService, filePath, chunkSeconds, log } = params;
  const tmpDir = await fsService.mkdtemp(path.join(os.tmpdir(), "gemini-chunks-"));
  const ext = path.extname(filePath) || ".mp3";
  let chunkExtension = ext;
  let pattern = path.join(tmpDir, `chunk_%03d${chunkExtension}`);

  const duration = await probeDuration(filePath);
  const estimatedChunks = duration ? Math.ceil(duration / chunkSeconds) : "unknown";
  log("info", { estimatedChunks, chunkSeconds, duration }, `🎵 Splitting audio into ~${estimatedChunks} chunks (${chunkSeconds} seconds each)...`);

  try {
    await runCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      filePath,
      "-f",
      "segment",
      "-segment_time",
      String(chunkSeconds),
      "-c",
      "copy",
      pattern
    ]);
  } catch (error) {
    const sanitized = sanitizeError(error);
    log("warn", { error: sanitized }, "⚠️  Copy-based chunking failed, falling back to PCM re-encode");
    const existing = await fsService.readdir(tmpDir);
    await Promise.all(
      existing
        .filter(name => name.startsWith("chunk_"))
        .map(name => fsService.rm(path.join(tmpDir, name), { force: true }))
    );

    chunkExtension = ".wav";
    pattern = path.join(tmpDir, `chunk_%03d${chunkExtension}`);

    await runCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      filePath,
      "-f",
      "segment",
      "-segment_time",
      String(chunkSeconds),
      "-c:a",
      "pcm_s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      pattern
    ]);
  }

  const entries = await fsService.readdir(tmpDir);
  const chunks = entries
    .filter(name => name.startsWith("chunk_") && name.endsWith(chunkExtension))
    .sort()
    .map((name, index) => ({
      path: path.join(tmpDir, name),
      index,
      offsetSeconds: index * chunkSeconds
    }));

  log("info", { chunkCount: chunks.length }, `✂️  Created ${chunks.length} chunks from audio file`);

  return { tmpDir, chunks };
}
