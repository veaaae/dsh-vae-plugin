---
name: dsh-issue-triage
description: Triage GitHub issues against DeepSeek Harness conventions. Use when the user asks to classify, label, or respond to a DSH issue or PR.
---

# DSH issue triage

Work in the DeepSeek Harness checkout the session already has. Do not invent labels or owners that the repository does not use.

## Read first

1. `AGENTS.md` and the package-group `AGENTS.md` that owns the report.
2. The issue or PR body, comments, and linked notes.
3. Whether an Agent Note or package README already covers the same decision.

## Classify

Pick one:

- **bug** — shipped behavior disagrees with a documented contract.
- **docs** — the code matches the contract; the prose does not.
- **feature** — new behavior; needs an Agent Note if it is non-trivial.
- **question** — no product change requested.
- **duplicate** — link the earlier issue and stop.

## Reply shape

- Restate the observed vs documented behavior in one paragraph.
- Name the owning package or document.
- If a change is warranted, name the first file to edit. Do not open a speculative refactor.

Keep secrets out of comments. Do not claim CI is green unless you read the check.
