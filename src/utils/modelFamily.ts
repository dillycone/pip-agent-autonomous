import path from "node:path";

const SLUG_SAFE_REGEX = /[^a-z0-9]+/g;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(SLUG_SAFE_REGEX, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .trim();
}

export function extractModelFamily(modelName: string | null | undefined): string {
  if (!modelName) {
    return "unknown";
  }
  const normalized = modelName.trim().toLowerCase();
  if (!normalized) {
    return "unknown";
  }

  if (normalized.startsWith("claude-")) {
    const parts = normalized.split("-");
    if (parts.length >= 2) {
      return slugify(`${parts[0]}-${parts[1]}`) || "claude";
    }
    return "claude";
  }

  if (normalized.startsWith("gemini")) {
    return "gemini";
  }

  const tokens = normalized
    .split(/[\s:/_-]+/)
    .map(token => token.trim())
    .filter(Boolean);

  if (tokens.length >= 2 && tokens[0] === "claude") {
    return slugify(`${tokens[0]}-${tokens[1]}`) || "claude";
  }

  if (tokens.length > 0) {
    return slugify(tokens[0]) || "unknown";
  }

  return "unknown";
}

export function withModelFamilyInDocxPath(originalPath: string, modelFamily: string): string {
  const safeFamily = slugify(modelFamily) || "unknown";
  const parsed = path.parse(originalPath);
  const parts = parsed.name.split("-").filter(Boolean);

  if (!parts.includes(safeFamily)) {
    if (parts[0] === "pip") {
      parts.splice(1, 0, safeFamily);
    } else {
      parts.push(safeFamily);
    }
  }

  const nextName = parts.join("-") || `pip-${safeFamily}`;
  return path.join(parsed.dir, `${nextName}${parsed.ext || ".docx"}`);
}
