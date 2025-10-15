import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = process.env.PIP_PROJECT_ROOT
  ? path.resolve(process.env.PIP_PROJECT_ROOT)
  : path.resolve(moduleDir, "../../../..");

export function resolveProjectPath(candidate: string): string {
  return path.resolve(PROJECT_ROOT, candidate);
}
