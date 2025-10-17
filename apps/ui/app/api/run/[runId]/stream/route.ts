import { NextRequest } from "next/server";
import { runStore, type RunEvent } from "@pip/server/runStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function sseLine(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function GET(
  req: NextRequest,
  { params }: { params: { runId: string } }
): Response {
  const runId = params.runId;

  if (!runId || typeof runId !== "string") {
    return new Response("Run ID is required", { status: 400 });
  }

  if (!runStore.has(runId)) {
    return new Response("Run not found", { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const flush = () => write(": keep-alive\n\n");
      const heartbeat = setInterval(flush, 15000);

      let unsubscribe: () => void = () => {};

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try {
          unsubscribe();
        } catch {
          // ignore
        }
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      const subscription = runStore.subscribe(runId, (event: RunEvent) => {
        write(sseLine(event.event, event.data));

        const status = runStore.getStatus(runId);
        if (
          event.event === "final" ||
          (event.event === "error" &&
            status !== "running" &&
            status !== "pending")
        ) {
          cleanup();
        }
      });

      unsubscribe = subscription.unsubscribe;
      flush();

      if (req.signal) {
        req.signal.addEventListener("abort", cleanup, { once: true });
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
