# Agent Command Handoff

## Ask Claude …
- **Trigger**: Any instruction that starts with `Ask Claude ` followed by a prompt.
- **Run**: `claude --print "<prompt> Be sure to ultrathink."`
  - If you already have an active Claude conversation to continue, add `--continue` before `--print` so context carries over.
- **Example**: `Ask Claude for deployment checklist` → `claude --print "Please list the deployment checklist. Be sure to ultrathink."`

Prefer second-person wording ("How are you doing?" vs. "How is he doing?") so Claude receives the prompt as a direct question.

Keep the user’s wording intact before the appended `Be sure to ultrathink.` phrase so Codex and Claude stay aligned.
