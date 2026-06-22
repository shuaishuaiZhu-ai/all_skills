---
name: commit-workflow
description: Use when the user asks to commit, stage, push, create a pull request, run /commit, run /commit-push-pr, clean gone branches, or streamline a git handoff workflow. Requires careful git status review, user-change protection, and explicit verification before mutating git state.
---

# Commit Workflow

## Purpose

Adapt the Claude `commit-commands` plugin for Codex. Use this for commit, push, PR, and stale branch cleanup workflows.

## Safety Rules

- Always inspect `git status --short` before staging or committing.
- Do not include unrelated user changes unless explicitly asked.
- Do not commit secrets, generated artifacts, caches, virtualenvs, or build outputs.
- Do not run destructive cleanup without explicit user approval.
- Use non-interactive git commands.
- After successful staging, commit, push, branch creation, or PR creation, emit the required Codex app git directive in the final response.

## `/commit` Equivalent

1. Inspect status and diff:
   - `git status --short`
   - `git diff`
   - `git diff --staged`
   - recent commit style with `git log --oneline -10`
2. Decide what belongs to this commit.
3. Stage only relevant files.
4. Create a concise commit message matching repository style.
5. Verify the resulting status and commit hash.

## `/commit-push-pr` Equivalent

1. Inspect status, branch, remote, and diff.
2. Create a feature branch if on the main branch and the user wants PR flow.
3. Commit relevant changes.
4. Push to `origin`.
5. Create a PR with summary and test plan using `gh pr create`.
6. Report PR URL and git directives.

## `clean_gone` Equivalent

Only run when explicitly requested.

1. Inspect stale branches with `git branch -v`.
2. Inspect worktrees with `git worktree list`.
3. Identify `[gone]` branches and associated worktrees.
4. Ask for approval before deleting branches or removing worktrees.
5. Remove only confirmed stale local branches/worktrees.
