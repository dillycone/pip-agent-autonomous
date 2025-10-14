import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import mime from "mime";
import { createGeminiService } from "../services/GeminiService.js";
import { createS3Service } from "../services/S3Service.js";
import {
  GEMINI_API_KEY,
  MODELS,
  S3_PROFILE,
  S3_BUCKET,
  S3_PREFIX,
  S3_PRESIGN_TTL_SECONDS,
  S3_DELETE_AFTER
} from "../config.js";

async function main() {
  const argv = process.argv.slice(2);
  const audioPath = argv[0];
  const jsonOutIndex = argv.indexOf("--json-out");
  const jsonOut = jsonOutIndex !== -1 ? argv[jsonOutIndex + 1] : undefined;
  if (!audioPath) {
    console.error("Usage: tsx src/scripts/transcribe-presigned.ts <audioPath> [--json-out <path>]");
    process.exit(1);
  }

  const abs = path.resolve(audioPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    console.error(`File not found: ${abs}`);
    process.exit(1);
  }

  if (!GEMINI_API_KEY) {
    console.error("Missing GEMINI_API_KEY in environment");
    process.exit(1);
  }

  const gemini = createGeminiService(GEMINI_API_KEY);
  const modelId = MODELS.GEMINI_PRO;
  const mimeType = mime.getType(abs) || "audio/wav";

  console.log("[1/4] Preparing upload...");

  let fileUri: string | null = null;
  let uploadedBucket: string | null = null;
  let uploadedKey: string | null = null;

  // Try presigned first (for storage-of-record). Note: Gemini cannot consume S3 URLs directly.
  try {
    console.log("[2/4] Uploading to S3 (profile:", S3_PROFILE, ")...");
    const s3 = createS3Service(S3_PROFILE);
    const up = await s3.uploadAndPresign({
      filePath: abs,
      mimeType,
      bucket: S3_BUCKET,
      prefix: S3_PREFIX,
      expiresInSeconds: S3_PRESIGN_TTL_SECONDS
    });
    fileUri = up.url;
    uploadedBucket = up.bucket;
    uploadedKey = up.key;
    console.log("      S3 object:", `${up.bucket}/${up.key}`);
    console.log("      Presigned for", S3_PRESIGN_TTL_SECONDS, "seconds");
  } catch (e: any) {
    console.warn("      S3 presigned upload failed:", e?.message || e);
  }

  // Always upload to Gemini File API (required for fileUri support)
  console.log("[3/4] Uploading to Gemini File API...");
  const up = await gemini.uploadFile(abs, mimeType);
  fileUri = up.uri || up.fileUri || null;
  if (!fileUri) {
    throw new Error("Upload failed: missing file URI");
  }

  console.log("[4/4] Requesting transcription from Gemini (", modelId, ")...");

  const instructions = [
    "You are a professional HR meeting transcriber.",
    "Audio language hint: auto.",
    "Output language: en.",
    "Return ONLY JSON with keys: transcript (string), segments (array of {start, end, speaker, text}).",
    "Perform speaker diarization; infer 'Manager'/'HRBP' if obvious else SPEAKER_1..n.",
    "Include start/end times HH:MM:SS."
  ].join("\n");

  const result = await gemini.generateContent({
    model: modelId,
    contents: [
      {
        role: "user",
        parts: [
          { text: instructions },
          { fileData: { fileUri, mimeType } }
        ]
      }
    ],
    config: { responseMimeType: "application/json" }
  });

  const text = (result.text || result.response?.text?.() || "").trim();
  const cleaned = text.replace(/```json|```/g, "").trim();

  console.log("Parsing response...");
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err: any) {
    console.error("Failed to parse JSON response:", err?.message || err);
    process.exit(1);
  }

  // Best-effort cleanup of S3 object
  if (uploadedBucket && uploadedKey && S3_DELETE_AFTER) {
    try {
      const s3 = createS3Service(S3_PROFILE);
      await s3.deleteObject(uploadedBucket, uploadedKey);
      console.log("      Deleted S3 object");
    } catch {
      // ignore
    }
  }

  // Print concise summary and full transcript to stdout
  const transcript = typeof parsed?.transcript === "string" && parsed.transcript.trim()
    ? parsed.transcript.trim()
    : Array.isArray(parsed)
      ? parsed.map((s: any) => String(s?.text || "").trim()).filter(Boolean).join("\n").trim()
      : Array.isArray(parsed?.segments)
        ? parsed.segments.map((s: any) => String(s?.text || "").trim()).filter(Boolean).join("\n").trim()
        : "";

  console.log("\n=== Transcription Summary ===");
  console.log("Model:", modelId);
  console.log("Input:", abs);
  console.log("Storage:", uploadedBucket ? `s3://${uploadedBucket}/${uploadedKey}` : "(skipped)");
  console.log("Transcript length:", transcript.length, "chars");
  console.log("===========================\n");

  if (jsonOut) {
    try {
      const outAbs = path.resolve(jsonOut);
      fs.writeFileSync(outAbs, cleaned + "\n", "utf8");
      console.log("Saved JSON to:", outAbs);
    } catch (err: any) {
      console.error("Failed to write JSON:", err?.message || err);
      process.exit(1);
    }
  } else {
    // Emit the full JSON to stdout (callers can redirect)
    process.stdout.write(cleaned + "\n");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err?.message || err);
  process.exit(1);
});
