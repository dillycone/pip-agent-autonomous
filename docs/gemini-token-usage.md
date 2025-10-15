# Gemini token usage metadata discrepancies

This note captures why Gemini token usage numbers were not showing up correctly and what changed to make the counters reliable again.

## What we observed

The pipeline relies on the `tokenUsage` object that the Gemini MCP tool returns (see `buildSuccess` in `src/mcp/geminiTranscriber.ts`). That object is populated from the Google Gen AI SDK's `usageMetadata` field. However, every Gemini transcription run was reporting zero output tokens while non-zero input tokens still appeared. That made the downstream cost summary inaccurate.

## Root cause analysis

1. **SDK response schema drift** – The project is pinned to `@google/genai@0.11.0`. In this release the SDK exposes two closely related usage metadata shapes:
   * `GenerateContentResponseUsageMetadata` keeps the older camelCase fields such as `candidatesTokenCount` and `promptTokenCount`.
   * `UsageMetadata` (used by the realtime/live surfaces and some batch responses) now prefers `responseTokenCount` instead of `candidatesTokenCount` for outputs.

   The TypeScript definitions in the SDK show the new field name explicitly, but our extractor never checked it, so any response that only populated `responseTokenCount` would look like "no output tokens" to us.【F:node_modules/@google/genai/dist/genai.d.ts†L1694-L1712】【F:node_modules/@google/genai/dist/genai.d.ts†L4778-L4792】

2. **Extractor limited to legacy keys** – `extractTokenUsageFromMetadata` in `src/mcp/geminiTranscriber.ts` only looked for `candidatesTokenCount`/`outputTokenCount` keys plus a couple of snake_case variants. When Gemini returned `responseTokenCount` the function fell through to `null`, so the MCP result omitted `tokenUsage.outputTokens` altogether.【F:src/mcp/geminiTranscriber.ts†L152-L175】

3. **Downstream parser mirrored the same blind spot** – The CLI summary (`extractGeminiTokenUsage` in `src/main.ts`) reads the serialized MCP payload. It used the same limited key list, which meant even if we added `responseTokenCount` upstream the console would still ignore it.【F:src/main.ts†L134-L173】

Because both layers ignored the newer field name, any response that preferred `responseTokenCount` produced a zero output-token tally and, by extension, a wrong total/cost estimate.

## Remediation

* The metadata extractor now accepts both legacy (`candidatesTokenCount`, `outputTokenCount`) and newer (`responseTokenCount`) key names, covering snake_case variants as well. That ensures the MCP tool always emits a filled `tokenUsage` block when Gemini provides output counts.【F:src/mcp/geminiTranscriber.ts†L152-L175】
* The CLI parser was updated with the same fallback list so the numbers flow through to the final cost summary display.【F:src/main.ts†L134-L173】

With these guards in place, the solution can ingest whichever schema the SDK chooses without losing the output-token figures that power the billing math.
