# Refactor Feedback To-Do

Tracking progress for the 19 feedback items and subsequent structural recommendations.

## 🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Nice-to-have

- [x] 1. Guard API file path params (audio/template/outdoc) against traversal using `validateFilePath`/`validateOutputPath` with `baseDir` + `allowAbsolute: false`; consider language whitelists.
- [x] 2. Replace singleton `CURRENT_RUN` with per-run store keyed by id and expose run id to clients.
- [x] 3. Unify cost computation with shared utility leveraging `PRICING`.
- [x] 4. Replace brittle project root resolution with shared `PROJECT_ROOT` helper (env override + fallback).
- [x] 5. Extract shared pipeline orchestration (`runPipeline`) reused by CLI and Next API.
- [x] 6. Align `GEMINI_INPUT_MODE` comment and behavior (default `upload`, explicit override).
- [x] 7. Tighten sensitive-field redaction patterns (avoid `/key/i` false positives).
- [x] 8. Improve `sanitizePath` to return repo-relative paths and avoid leaking username.
- [x] 9. Remove redundant prompt path `resolve`.
- [x] 10. Harden SSE teardown guard against double-close.
- [x] 11. Normalize path validation behavior across CLI/API (ensure consistent options; consider writable root allowlist).
- [x] 12. Revisit `sanitizeForShellCommand` to avoid silently altering args (prefer escaping / spawn args).
- [x] 13. Increase Gemini JSON parsing robustness (ensure segments synthesized when transcript exists; consider schema validation).
- [x] 14. Add ffmpeg chunking fallback for fragile codecs (re-encode to WAV on failures).
- [x] 15. Encapsulate Gemini SDK response handling and broaden upload inputs (paths + streams).
- [x] 16. Clarify S3 presign “audit mode” behavior or add `presigned_only` option.
- [x] 17. Expand `safe-stringify` sensitive key detection to match new regex list.
- [x] 18. Evaluate more efficient diffing for large drafts (existing UI no longer renders diffs, no action required).
- [x] 19. Externalize Progress ring colors into theme tokens / CSS vars.

## 🧱 Structural Recommendations

- [x] S1. Create shared modules: `src/pipeline/runPipeline.ts`, `src/utils/cost.ts`, `src/utils/paths.ts`, `src/server/runStore.ts`.
- [x] S2. Introduce zod validation for run query params in `apps/ui/app/api/run/route.ts`.
- [x] S3. Add tests for path validation, cost summaries, and concurrent run handling.
