/**
 * Safely parse JSON string with type safety
 * @template T The type to parse into
 * @param raw JSON string or null
 * @returns Parsed object or null if parsing fails
 */
export function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Format duration in seconds to HH:MM:SS or MM:SS format
 * @param rawSeconds Total seconds (may be NaN or negative)
 * @returns Formatted duration string
 */
export function formatDuration(rawSeconds: number): string {
  if (!Number.isFinite(rawSeconds)) return "0:00";
  const totalSeconds = Math.max(0, Math.floor(rawSeconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Format duration in milliseconds to HH:MM:SS or MM:SS format
 * @param ms Total milliseconds
 * @returns Formatted duration string
 */
export function formatDurationMs(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  return formatDuration(Math.round(ms / 1000));
}
