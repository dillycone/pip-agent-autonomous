import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

export type RunStatus = "pending" | "running" | "success" | "error" | "aborted";

export interface RunEvent {
  id: string;
  event: string;
  data: unknown;
  at: string;
}

interface RunRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: RunStatus;
  error?: unknown;
  events: RunEvent[];
  emitter: EventEmitter;
  controller: AbortController;
  subscribers: number;
}

const RUN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_BUFFERED_EVENTS = 1000;

class RunStore {
  private runs = new Map<string, RunRecord>();

  constructor() {
    setInterval(() => this.cleanup(), 5 * 60 * 1000).unref?.();
  }

  createRun(): { id: string; signal: AbortSignal } {
    const id = randomUUID();
    const controller = new AbortController();
    const record: RunRecord = {
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "pending",
      events: [],
      emitter: new EventEmitter(),
      controller,
      subscribers: 0
    };
    this.runs.set(id, record);
    return { id, signal: controller.signal };
  }

  has(runId: string): boolean {
    return this.runs.has(runId);
  }

  getStatus(runId: string): RunStatus | undefined {
    return this.runs.get(runId)?.status;
  }

  setStatus(runId: string, status: RunStatus, error?: unknown): void {
    const record = this.runs.get(runId);
    if (!record) return;
    record.status = status;
    record.updatedAt = Date.now();
    if (error) {
      record.error = error;
    }
  }

  appendEvent(runId: string, event: string, data: unknown): void {
    const record = this.runs.get(runId);
    if (!record) return;

    const item: RunEvent = {
      id: `${record.id}:${record.events.length + 1}`,
      event,
      data,
      at: new Date().toISOString()
    };

    record.events.push(item);
    if (record.events.length > MAX_BUFFERED_EVENTS) {
      record.events.splice(0, record.events.length - MAX_BUFFERED_EVENTS);
    }

    record.updatedAt = Date.now();
    queueMicrotask(() => {
      record.emitter.emit("event", item);
    });
  }

  subscribe(
    runId: string,
    handler: (event: RunEvent) => void
  ): { unsubscribe: () => void; replayed: number; signal: AbortSignal } {
    const record = this.runs.get(runId);
    if (!record) {
      throw new Error(`Unknown run: ${runId}`);
    }

    record.subscribers += 1;

    // Replay buffered events to new subscriber
    for (const evt of record.events) {
      handler(evt);
    }

    const listener = (evt: RunEvent) => handler(evt);
    record.emitter.on("event", listener);

    const unsubscribe = () => {
      record.emitter.off("event", listener);
      record.subscribers = Math.max(0, record.subscribers - 1);
      if (
        record.subscribers === 0 &&
        (record.status === "pending" || record.status === "running")
      ) {
        this.abort(runId, "Client disconnected");
      }
    };

    return { unsubscribe, replayed: record.events.length, signal: record.controller.signal };
  }

  abort(runId: string, reason?: string): void {
    const record = this.runs.get(runId);
    if (!record) return;
    if (!record.controller.signal.aborted) {
      record.controller.abort(reason ? new Error(reason) : undefined);
    }
    record.status = "aborted";
    record.updatedAt = Date.now();
    this.appendEvent(runId, "error", {
      message: reason || "Run aborted",
      aborted: true
    });
  }

  finish(runId: string): void {
    const record = this.runs.get(runId);
    if (!record) return;
    record.updatedAt = Date.now();
    setTimeout(() => {
      this.runs.delete(runId);
    }, RUN_TTL_MS).unref?.();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [runId, record] of this.runs.entries()) {
      if (now - record.updatedAt > RUN_TTL_MS) {
        this.runs.delete(runId);
      }
    }
  }
}

const globalKey = Symbol.for("pip.runStore");
const globalStore = (globalThis as any)[globalKey] as RunStore | undefined;

const store = globalStore ?? new RunStore();

if (!globalStore) {
  (globalThis as any)[globalKey] = store;
}

export { store as runStore };
