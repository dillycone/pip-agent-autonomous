import { NextRequest, NextResponse } from "next/server";
import { runStore } from "@pip/server/runStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(
  _req: NextRequest,
  { params }: { params: { runId: string } }
): NextResponse {
  const { runId } = params;

  if (!runId || typeof runId !== "string") {
    return NextResponse.json({ error: "Run ID is required" }, { status: 400 });
  }

  if (!runStore.has(runId)) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const status = runStore.getStatus(runId);

  // Return basic run information
  // In a production app, you'd want to store more metadata about runs
  return NextResponse.json({
    runId,
    status
  });
}
