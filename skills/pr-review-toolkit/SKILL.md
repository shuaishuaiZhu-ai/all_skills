---
name: pr-review-toolkit
description: Use when the user asks for a comprehensive PR review, review-pr, specialized review passes, test review, comment review, error handling review, type design review, silent failure hunting, or post-implementation quality review across changed files.
---

# PR Review Toolkit

## Purpose

Adapt the Claude `pr-review-toolkit` command and agents for Codex. Use it for a comprehensive multi-angle review of a PR or current diff.

## Review Aspects

- `code`: general correctness and project conventions
- `tests`: test quality, assertions, missing coverage, brittle setup
- `comments`: stale, misleading, or over-specific comments
- `errors`: silent failures, swallowed exceptions, weak error handling
- `types`: type design, invariants, impossible states, API contracts
- `simplify`: clarity and maintainability after correctness is established
- `all`: run all applicable passes

## Workflow

1. Determine scope:
   - PR via `gh pr view` / `gh pr diff`, or local diff via `git diff`.
2. Read project instructions and changed files.
3. Select applicable aspects based on the changed files and user request.
4. Run focused review passes, using parallel investigation when independent.
5. Aggregate findings by severity.
6. Provide an action plan and avoid low-confidence noise.

## Output

Lead with findings:

```markdown
Critical Issues
- ...

Important Issues
- ...

Suggestions
- ...

Strengths
- ...

Verification / Scope
- ...
```

If no meaningful issues exist, say so clearly and list remaining risk or unverified checks.
