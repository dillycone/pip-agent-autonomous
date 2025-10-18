import { runStore } from "@pip/server/runStore";

export async function POST(
  request: Request,
  { params }: { params: { runId: string } }
) {
  try {
    const runId = params.runId;

    if (!runId) {
      return Response.json(
        { error: "Missing runId parameter" },
        { status: 400 }
      );
    }

    if (typeof runStore.abort === "function") {
      await runStore.abort(runId);
    }

    return Response.json({
      ok: true,
      message: `Run ${runId} abort requested`
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      { error: message, details: error },
      { status: 500 }
    );
  }
}