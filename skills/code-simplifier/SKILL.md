---
name: code-simplifier
description: Use when recently modified code should be simplified or refined for clarity, consistency, maintainability, and project conventions while preserving exact behavior. Also use when the user asks to simplify, polish, clean up, reduce complexity, or make code easier to read without changing functionality.
---

# Code Simplifier

## Purpose

Refine recently modified code without changing what it does.

## Rules

- Preserve behavior exactly.
- Keep scope to recently modified files unless the user asks for broader cleanup.
- Follow project instructions and existing style.
- Prefer clarity over fewer lines.
- Do not create speculative abstractions.
- Do not refactor unrelated code.
- Verify after simplification with the same tests or smoke checks used for the original change.

## Simplification Targets

Look for:

- unnecessary nesting
- duplicated logic
- unclear names
- dead imports or variables introduced by the current change
- avoidable indirection
- comments that describe obvious code
- dense one-liners or nested ternaries that reduce readability
- inconsistent local patterns

Avoid:

- changing public APIs without request
- broad formatting churn
- removing helpful domain abstractions
- replacing simple explicit code with clever compact code
- deleting pre-existing dead code unless asked

## Workflow

1. Inspect current diff and project style.
2. Identify simplification candidates tied to the current task.
3. Make the smallest readability-preserving edits.
4. Run the relevant verification.
5. Report what was simplified and what behavior was verified unchanged.
