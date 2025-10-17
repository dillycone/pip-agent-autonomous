import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import { PROJECT_ROOT } from "@pip/utils/paths";
import { sanitizeError, sanitizePath } from "@pip/utils/sanitize";
import { validateFilePath } from "@pip/utils/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_BASE_DIRECTORIES = [
  path.resolve(PROJECT_ROOT, "exports")
];

const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function isWithinAllowedDirs(candidate: string): boolean {
  const normalized = path.resolve(candidate);
  return ALLOWED_BASE_DIRECTORIES.some((allowedDir) => {
    const resolvedDir = path.resolve(allowedDir);
    return normalized === resolvedDir || normalized.startsWith(`${resolvedDir}${path.sep}`);
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const rawPath = url.searchParams.get("path") ?? "";
  const trimmed = rawPath.trim();

  if (!trimmed) {
    return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
  }

  const validation = validateFilePath(trimmed, {
    mustExist: true,
    mustBeFile: true,
    allowAbsolute: false,
    extensions: [".docx"],
    baseDir: PROJECT_ROOT
  });

  if (!validation.valid || !validation.sanitizedPath) {
    return NextResponse.json(
      {
        error: "File not found",
        details: sanitizeError(validation)
      },
      { status: 404 }
    );
  }

  const absolutePath = validation.sanitizedPath;

  if (!isWithinAllowedDirs(absolutePath)) {
    return NextResponse.json({ error: "Access to requested file is not permitted" }, { status: 403 });
  }

  try {
    const fileBuffer = await fs.readFile(absolutePath);
    const fileName = path.basename(absolutePath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": DOCX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Content-Length": fileBuffer.length.toString(),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Download-Path": sanitizePath(absolutePath)
      }
    });
  } catch (error) {
    const sanitized = sanitizeError(error);
    return NextResponse.json(
      {
        error: "Failed to read requested file",
        details: sanitized
      },
      { status: 500 }
    );
  }
}
