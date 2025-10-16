# Agent Command Handoff

## Ask Claude …
- **Trigger**: Any instruction that starts with `Ask Claude ` followed by a prompt.
- **Run**: `claude --print "<prompt> Be sure to ultrathink."`
  - If you already have an active Claude conversation to continue, add `--continue` before `--print` so context carries over.
- **Example**: `Ask Claude for deployment checklist` → `claude --print "Please list the deployment checklist. Be sure to ultrathink."`

Prefer second-person wording ("How are you doing?" vs. "How is he doing?") so Claude receives the prompt as a direct question.

Keep the user’s wording intact before the appended `Be sure to ultrathink.` phrase so Codex and Claude stay aligned.

## Server Startup Guardrails
- Always launch servers on their framework defaults. Frontend (`next dev`) must run on port `3000`. Backend/CLI services should respect their built-in defaults—do not override `PORT` unless the user explicitly instructs otherwise.
- Before starting a server, check for blockers with `lsof -i :<port>` and, if occupied, clear it via `npx kill-port <port>`.
- After freeing a port, re-run the intended start command and confirm the listener is bound to the default port.
- If a port conflict cannot be cleared, pause and ask the user rather than selecting an alternate port on your own.
