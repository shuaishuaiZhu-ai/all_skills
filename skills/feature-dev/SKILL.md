---
name: feature-dev
description: Use when implementing a new feature or substantial behavior change where requirements, codebase patterns, architecture, integration points, or quality risks need to be understood before editing. Also use when the user explicitly asks for feature-dev, /feature-dev, guided feature development, architecture-first implementation, codebase exploration before building, or a Claude feature-dev style workflow.
---

# Feature Development

## Purpose

Use this skill to run the Claude `feature-dev` workflow inside Codex. It turns feature work into a gated sequence: understand the request, explore the codebase, resolve ambiguity, design the approach, implement only after approval when required, review, and summarize.

This skill is for new features and substantial behavior changes. For tiny edits with fully specified behavior, keep the process lightweight and use the smallest meaningful subset.

## Core Rules

1. Do not jump straight to implementation unless the change is trivial and fully specified.
2. Read the existing code and project instructions before designing.
3. Ask concrete clarifying questions when ambiguity affects behavior, scope, compatibility, data model, security, performance, or user experience.
4. Present implementation approaches with tradeoffs before editing when the architecture is non-obvious.
5. If this skill's workflow reaches an explicit approval gate, wait for user approval before continuing.
6. Keep changes surgical and verify with the narrowest meaningful check.

## Workflow

### Phase 1: Discovery

Clarify what is being built.

- Restate the feature goal and assumptions.
- Identify constraints, users, non-goals, and success criteria.
- If the request is unclear, ask concise questions before proceeding.

### Phase 2: Codebase Exploration

Understand relevant existing patterns.

- Search for similar features, entry points, APIs, UI surfaces, tests, config, and deployment/runtime boundaries.
- Trace control flow and data flow through the relevant modules.
- Produce a short findings summary with key files and line references.
- If independent exploration tracks exist, use parallel file reads or available subagent mechanisms. If no subagent tool is available, perform the tracks directly.

For deeper exploration guidance, read `references/code-explorer.md`.

### Phase 3: Clarifying Questions

Resolve meaningful ambiguity before architecture design.

Ask about only the details that materially affect implementation:

- edge cases and error handling
- integration points and backwards compatibility
- data ownership and persistence
- security, privacy, permissions, and audit behavior
- performance or operational constraints
- UI/UX behavior and accessibility
- rollout, migration, and testing expectations

If the user says "use your judgment", give a recommendation and proceed only when approval is not required by project or safety rules.

### Phase 4: Architecture Design

Design the implementation.

- Offer one recommended approach for straightforward work.
- Offer 2-3 approaches only when there are real tradeoffs.
- Explain concrete file-level changes, data flow, tests, and risk.
- Prefer the simplest approach that fits existing project conventions.

For architecture blueprint guidance, read `references/code-architect.md`.

### Phase 5: Implementation

Build after the design is accepted or when the task is small enough not to need a gate.

- Read all files needed for the chosen approach.
- Implement the minimum change that satisfies the request.
- Match existing style and abstractions.
- Avoid unrelated refactors.
- Update tests, docs, or runbooks only when they are part of the requested behavior or needed to keep the project accurate.

### Phase 6: Quality Review

Review the result before claiming completion.

- Check for bugs, missing edge cases, regressions, security issues, and project convention violations.
- Use code review stance for non-trivial diffs: findings first, file and line references, then summary.
- Report only issues that matter; do not create noise from speculative nits.

For review criteria, read `references/code-reviewer.md`.

### Phase 7: Summary

Close with:

- what changed
- files changed
- verification run and result
- remaining risk or unverified boundary
- any follow-up that directly builds on the request

## When To Use A Smaller Flow

Use a compact path when the requested change is narrow:

1. Discovery: one-sentence goal and assumption.
2. Exploration: read the directly relevant files.
3. Implementation: make the minimal edit.
4. Review and verification: run the smallest meaningful check.

Still do not skip verification before completion.

## Reference Files

- `references/code-explorer.md`: how to investigate similar code and trace implementation paths.
- `references/code-architect.md`: how to produce an implementation blueprint.
- `references/code-reviewer.md`: how to review the resulting changes with high signal.
