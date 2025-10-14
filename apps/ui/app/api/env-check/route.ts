import { NextRequest, NextResponse } from "next/server";
import { GEMINI_API_KEY, ANTHROPIC_API_KEY, isValidGeminiKeyFormat, isValidAnthropicKeyFormat } from "@pip/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Diagnostic endpoint to check environment variable availability
 * GET /api/env-check
 */
export async function GET(req: NextRequest) {
  const geminiKeyPresent = Boolean(GEMINI_API_KEY);
  const anthropicKeyPresent = Boolean(ANTHROPIC_API_KEY);

  const geminiKeyValid = geminiKeyPresent && isValidGeminiKeyFormat(GEMINI_API_KEY);
  const anthropicKeyValid = anthropicKeyPresent && isValidAnthropicKeyFormat(ANTHROPIC_API_KEY);

  // Mask keys for security - only show first/last 4 characters
  const maskKey = (key: string | undefined) => {
    if (!key) return "NOT_SET";
    if (key.length < 12) return "TOO_SHORT";
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  };

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      cwd: process.cwd(),
    },
    apiKeys: {
      GEMINI_API_KEY: {
        present: geminiKeyPresent,
        valid: geminiKeyValid,
        masked: maskKey(GEMINI_API_KEY),
        length: GEMINI_API_KEY?.length ?? 0,
      },
      ANTHROPIC_API_KEY: {
        present: anthropicKeyPresent,
        valid: anthropicKeyValid,
        masked: maskKey(ANTHROPIC_API_KEY),
        length: ANTHROPIC_API_KEY?.length ?? 0,
      },
    },
    processEnv: {
      GEMINI_API_KEY_direct: {
        present: Boolean(process.env.GEMINI_API_KEY),
        masked: maskKey(process.env.GEMINI_API_KEY),
        length: process.env.GEMINI_API_KEY?.length ?? 0,
      },
      ANTHROPIC_API_KEY_direct: {
        present: Boolean(process.env.ANTHROPIC_API_KEY),
        masked: maskKey(process.env.ANTHROPIC_API_KEY),
        length: process.env.ANTHROPIC_API_KEY?.length ?? 0,
      },
    },
  });
}
