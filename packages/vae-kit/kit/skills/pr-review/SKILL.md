---
name: pr-review
description: Review a pull request with a consistent checklist. Use when the user asks to review a PR, a diff, or a merge request.
---

# PR review

Review the change the user named. Prefer the GitHub MCP tools when they are enabled; otherwise use `gh` or local git.

## Read before commenting

1. Title, body, linked issues, and the test plan.
2. The full diff, not only the files the user mentioned.
3. CI status when it is available.

## Checklist

- Correctness: the change does what the description claims, including error paths.
- Scope: no unrelated refactors or leftover debug code.
- Tests: new behavior has coverage, or the review states why not.
- Secrets: no tokens, private keys, or machine-local paths.
- Docs: user-visible behavior updates its owner document.

## Output

Write:

1. A one-line verdict: approve, request changes, or comment.
2. Blocking findings first, each with a file and line when possible.
3. Non-blocking notes last.

Do not rubber-stamp. If the diff is too large to finish, say what was read and what remains.
