import { AsyncLocalStorage } from "node:async_hooks";

type DraftStreamContext = {
  runId: string;
  streamingEnabled: boolean;
  emit: (event: string, data: unknown) => void;
};

const storage = new AsyncLocalStorage<DraftStreamContext>();

export function runWithDraftStreamContext<T>(
  context: DraftStreamContext,
  fn: () => T | Promise<T>
): T | Promise<T> {
  return storage.run(context, fn);
}

export function getDraftStreamContext(): DraftStreamContext | undefined {
  return storage.getStore();
}

export function emitDraftStreamEvent(
  event: "delta" | "complete" | "reset",
  data: Record<string, unknown>
): void {
  const ctx = storage.getStore();
  if (!ctx || !ctx.streamingEnabled) {
    return;
  }

  const eventName =
    event === "delta"
      ? "draft_stream_delta"
      : event === "complete"
        ? "draft_stream_complete"
        : "draft_stream_reset";

  ctx.emit(eventName, data);
}
