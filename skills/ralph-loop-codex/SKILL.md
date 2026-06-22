---
name: ralph-loop-codex
description: Use when the user asks for Ralph loop, ralph-loop, continuous self-improvement loop, iterative agent loop, keep working until completion, bounded autonomous iteration, or to adapt Claude ralph-loop behavior to Codex without relying on Claude Stop hooks.
---

# Ralph Loop For Codex

## Purpose

Adapt the Claude `ralph-loop` concept to Codex. Claude's original plugin uses a Stop hook to feed the same prompt back until a completion promise appears. Codex does not expose that hook here, so use a bounded manual loop with explicit state and verification.

## Safety Rules

- Always set a maximum iteration count.
- Define a concrete completion promise or success condition.
- Do not claim completion unless the condition is verified.
- If stuck, report blockers and attempted approaches instead of looping blindly.
- Do not perform destructive actions inside the loop without explicit approval.

## Loop Setup

Capture:

- task prompt
- completion condition
- max iterations
- allowed files/commands
- verification command or checklist
- stop conditions for blocked, unsafe, or unproductive work

## Iteration Pattern

For each iteration:

1. Re-read the task prompt and current state.
2. Inspect changed files, logs, tests, or previous notes.
3. Identify the next smallest useful action.
4. Execute the action.
5. Verify with the agreed check.
6. Record progress, blocker, or completion.

Stop when:

- completion condition is true and verified
- max iterations is reached
- the same blocker repeats and no safe progress remains
- user interrupts or changes direction

## Output

At each checkpoint or final response, report:

- iteration number
- what changed
- verification result
- whether the completion condition is satisfied
- next action or blocker
