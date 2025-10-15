# PIP Agent (Gemini 2.5 Pro + Claude Sonnet 4.5) — Autonomous

**What it does**
1) Transcribes your HRBP–Manager audio using **Gemini‑2.5‑pro** (with input/output language control).  
2) Drafts a PIP using **your prompt** (provided in `prompts/draft-pip.txt`).  
3) Reviews the draft with a **Claude Sonnet 4.5** judge against your guardrails.  
4) Exports an approved draft to **.docx** (uses a template if provided; otherwise generates a clean fallback .docx).

**Models**
- Agent SDK model: `claude-sonnet-4-5-20250929`
- Judge model (subagent): `claude-sonnet-4-5-20250929`
- Transcription model: `gemini-2.5-pro`

## Quick start

1) **Install** (Node 20+ recommended)
```bash
npm install
```

2) **Create `.env`** (copy from `.env.example`)
```bash
cp .env.example .env
# Edit .env and add your API keys
```

```
ANTHROPIC_API_KEY=your_anthropic_key
GEMINI_API_KEY=your_gemini_key
```

**Important Security Notes:**
- Never commit `.env` to version control (already in `.gitignore`)
- Get your Anthropic API key from: https://console.anthropic.com/
- Get your Gemini API key from: https://aistudio.google.com/app/apikey
- For production deployments, use a secrets manager (AWS Secrets Manager, Azure Key Vault, Google Secret Manager, etc.)
- Rotate API keys immediately if they are ever exposed

3) **Put your audio** in `uploads/` (e.g., `uploads/meeting.mp3`) or point to an absolute path.  
   Optionally, place a Word template in `templates/pip-template.docx` containing the tag `{pip_body}`. If the template is missing, the exporter falls back automatically.

4) **Run**
```bash
npm run dev -- --audio uploads/meeting.mp3 --in en-US --out en --template templates/pip-template.docx --outdoc exports/PIP.docx
```
Flags:
- `--audio` (required): path to your audio
- `--in` (optional): input audio language (e.g., `en-US`, `es-ES`, or `auto`), default `auto`
- `--out` (optional): output language for transcript + draft (e.g., `en`, `fr`), default `en`
- `--template` (optional): .docx template with `{pip_body}` tag. Omit it to auto-generate formatting.
- `--outdoc` (optional): output .docx path (default `exports/pip-<timestamp>.docx`). Only `.docx` is supported currently.

Example without a template (fallback export):

```bash
npm run dev -- --audio /absolute/path/to/meeting.mp3 --outdoc exports/PIP.docx
```

## ASCII flow

```
[User]
   └─ audio + languages (in/out) + keys in .env
        ▼
[Gemini 2.5 Pro Transcriber  (MCP tool)]
   ├─ Attempt single-pass transcription first (up to 9.5 hours supported)
   ├─ On timeout/too-large: automatic fallback to chunked transcription
   └─ transcript (outLang), segments[]
        ▼
[Claude Agent SDK  (claude-sonnet-4-5-20250929)]
   ├─ Apply YOUR prompt (prompts/draft-pip.txt) to transcript → Draft
   ├─ Subagent: policy-judge (same model)
   │    └─ approves? yes → go on; no → suggest fixes → self-revise → re-judge (≤ 2)
   └─ Exporter (MCP tool): render to DOCX (template or fallback)
        ▼
[Output]
   └─ exports/PIP.docx
```

## Transcription Strategy

The pipeline uses an intelligent transcription approach:

1. **Always attempt single-pass first** - Regardless of audio duration, the system first attempts to transcribe the entire file in one pass using Gemini 2.5 Pro (which supports up to 9.5 hours of audio).

2. **Automatic fallback to chunking** - Only if Gemini explicitly fails (timeout or file too large), the system automatically falls back to chunked transcription with the following process:
   - Splits audio into 30-second chunks using ffmpeg
   - Transcribes chunks in parallel (configurable concurrency)
   - Merges segments with proper timestamp alignment
   - Automatic retries for failed chunks

3. **Presigned URL mode (default)** - Uploads audio to S3 and passes presigned URL to Gemini for audit logging while using Gemini's File API for transcription.

This approach optimizes for speed (single-pass is faster) while maintaining reliability (chunking as fallback).

## Files of interest

- `src/main.ts` — Orchestrates the autonomous end‑to‑end run using the Agent SDK (streaming mode).  
- `src/mcp/geminiTranscriber.ts` — MCP tool that calls **Gemini 2.5 Pro** to transcribe audio with language control.  

## S3 Presigned Audit Mode

You can optionally keep an audit copy of each audio file in S3 while still using the Gemini SDK upload path. The default mode is `upload` (direct SDK). Set `GEMINI_INPUT_MODE=presigned` to store an S3 copy first (useful for compliance) and then upload the same local file to Gemini.

Env config (see `.env.example`):

- `S3_PROFILE` — AWS CLI profile to use (default `BCRoot`)
- `S3_BUCKET` — Target bucket; if unset, the app attempts to create a bucket automatically
- `S3_PREFIX` — Key prefix for uploads (default `audio`)
- `S3_PRESIGN_TTL_SECONDS` — URL TTL in seconds (default `3600`)
- `S3_DELETE_AFTER` — Delete object after transcription (default `true`)
- `GEMINI_INPUT_MODE` — `upload` (default) or `presigned` (audit copy then SDK upload)

Notes:

- For first use, ensure the profile has `s3:*` and `sts:GetCallerIdentity` permissions.
- If presigned single-pass fails (e.g., timeout), the tool falls back to the direct SDK upload path (and chunking if needed). The S3 object is cleaned up automatically.
- `src/mcp/docxExporter.ts` — MCP tool that fills a DOCX template with `{pip_body}`, or generates a fallback DOCX.  
- `src/agents/policyJudge.ts` — Subagent that judges the draft against your **policies/guardrails**.  
- `prompts/draft-pip.txt` — Your exact drafting prompt (already included).  
- `policies/guidelines.txt` — Placeholder for your guardrails; edit to your policy.  

## Template format (optional)

If you provide `templates/pip-template.docx`, include the placeholder `{pip_body}` where the drafted text should go.
You can also add `{language}`, `{date}`, `{title}`; they’ll be available to the template.

## New Features (Claude Agent SDK Aligned)

This codebase is now fully aligned with Claude Agent SDK best practices:

- **Cost Tracking** - See token usage and estimated costs after each run
- **Progress Visibility** - Real-time todo tracking shows pipeline progress
- **Session Management** - Session IDs for resuming failed runs
- **Tool Monitoring** - See exactly which tools are being called
- **Enhanced Output** - Rich console formatting with emojis and clear structure
- **Official SDKs** - Uses `@anthropic-ai/sdk` for API calls
- **TypeScript Strict Mode** - Full type safety enabled

### Example Output
```bash
🚀 Running autonomous PIP pipeline...
📝 Session ID: session-abc123
🔧 Tool: mcp__gemini-transcriber__transcribe_audio
✓ Progress: 2/6 tasks completed
  ⏳ Generating PIP draft from transcript
📊 Cost Summary:
  Total Tokens: 45,234
  Estimated Cost: $0.2845
✅ Pipeline completed successfully!
```

For detailed documentation:
- **[IMPROVEMENTS_SUMMARY.md](./IMPROVEMENTS_SUMMARY.md)** - Complete list of SDK improvements
- **[SDK_FEATURES_GUIDE.md](./SDK_FEATURES_GUIDE.md)** - How to use the new features
- **[SECURITY.md](./SECURITY.md)** - Security best practices and deployment guidelines

## Notes

- This repository **does not provide legal advice**. Always include human HR/legal review when appropriate.
- The pipeline runs with `permissionMode: 'bypassPermissions'` and a **minimal allowedTools list** for safe autonomy.
- If your tenancy names the model differently (Vertex/Bedrock), adjust `MODEL_ID` in `src/main.ts`.

## Troubleshooting

- **Transcription fails**: verify `GEMINI_API_KEY` and supported audio type (`.mp3/.wav/.flac` etc.).
- **Template errors**: remove the `--template` flag to let the fallback generator create a docx.
- **Judge loops**: review rounds are capped at 1 (set `MAX_REVIEW_ROUNDS=0` in the environment to skip the judge entirely).
- **Unexpected chunking**: If you see chunking for short audio files, check logs for the fallback reason (timeout or file-too-large). Single-pass is always attempted first.  
