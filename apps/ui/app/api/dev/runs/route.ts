import { NextResponse } from "next/server";
import { runStore } from "@pip/server/runStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  // Return all available runs from the runStore
  // For now, we'll return an empty array since runStore doesn't expose a method to list all runs
  // This will need to be enhanced with proper run persistence/history
  
  return NextResponse.json({
    runs: []
  });
}
