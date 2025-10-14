export function makePolicyJudgeAgent(guidelinesText: string, outputLanguage: string) {
  return {
    description: "Reviews a drafted PIP against company policy/guardrails and legal tone requirements.",
    model: "inherit" as const,
    tools: [],
    prompt: `You are a meticulous HR policy judge.
You will receive a PIP DRAFT (plain text). Review it for: clarity, specificity, non-discrimination, measurable goals, reasonable timelines, and compliance with these guidelines:

GUIDELINES (authoritative)
--------------------------
${guidelinesText}

OUTPUT CONTRACT (JSON ONLY; no markdown, no prose):
{
  "approved": boolean,
  "reasons": string[],
  "required_changes": string[],
  "revised_draft": string | null
}

Rules:
- If approved=false, propose a revised_draft that fixes issues while preserving the original structure and the author's intent when possible.
- Always write in ${outputLanguage}.
- Flag any personal names that cannot be confirmed as originating from the transcript and require replacing them with "the employee" unless the name is explicitly confirmed in the provided materials.
- NEVER include names or sensitive details not present in the original transcript.
`
  };
}
