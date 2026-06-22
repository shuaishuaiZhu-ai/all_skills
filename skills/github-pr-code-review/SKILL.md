---
name: github-pr-code-review
description: Use when reviewing a GitHub pull request with gh, especially when the user asks for /code-review, PR review, review a pull request, comment on a PR, check CLAUDE.md compliance, or produce a confidence-filtered review focused on real bugs.
---

# GitHub PR Code Review

## Purpose

Adapt the Claude `code-review` command for Codex. This is a GitHub PR review workflow using `gh` and a confidence filter.

## Preconditions

- Use only when the repository has a GitHub remote and `gh` is available/authenticated, or when the user only wants a local PR-style review from diffs.
- Do not post comments to GitHub unless the user explicitly asks for posting.
- Prefer review-first output: findings first, ordered by severity, with file/line references.

## Workflow

1. Identify the PR or review scope:
   - `gh pr view`, `gh pr diff`, `gh pr list`, or local `git diff` if no PR is available.
2. Check eligibility:
   - skip closed PRs, drafts, bot-only trivial updates, or PRs already reviewed by this agent unless the user asks to re-review.
3. Read project guidance:
   - root `AGENTS.md`, `CLAUDE.md`, `README`, and any guidance files in modified directories.
4. Review changed lines and necessary surrounding context.
5. Look for only high-signal issues:
   - real bugs
   - broken behavior
   - security or permission problems
   - incorrect error handling
   - violations of explicit project instructions
   - historical-context regressions when cheap to verify
6. Apply confidence filtering:
   - report only issues that would score at least 80/100 confidence.
   - ignore nits, speculative issues, formatter/linter-only issues, and pre-existing unrelated problems.
7. If posting to GitHub, use full commit SHA links and keep the comment brief.

## Output

Use this structure:

```markdown
Findings
- [severity] file:line - issue, evidence, impact, suggested fix

Open Questions / Assumptions
- ...

Summary
- Scope reviewed
- Verification or commands run
```

If no issues are found, say that clearly and mention remaining test gaps or residual risk.
