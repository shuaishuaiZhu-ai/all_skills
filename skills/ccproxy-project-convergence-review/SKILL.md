---
name: ccproxy-project-convergence-review
description: Use after multiple ccproxy, Claude Code Proxy, or claude-code-proxy subtask sessions to consolidate implementation status, tests, docs, provider behavior, OAuth/login behavior, install/uninstall scripts, and remaining risks into one source-of-truth convergence report or plan. Use when the user asks to 收敛, 汇总, 复盘, review, audit, plan next steps, or decide what remains for ccproxy. Do not use for unrelated proxy projects or single isolated code edits.
---

# ccproxy Project Convergence Review

Consolidate many ccproxy / Claude Code Proxy investigation, implementation, and review threads into one evidence-backed project state report.

## When To Use

Use this skill when:

- The repo or task is about `ccproxy`, `claude-code-proxy`, Claude Code Proxy, or a tool that lets Claude Code CLI route through OpenAI-compatible APIs, ChatGPT subscription, Kimi, Zhipu, DeepSeek, MiniMax, or similar providers.
- Several parallel or prior sessions produced partial conclusions, patches, test ideas, or review findings.
- The user asks what is already done, what is missing, what to implement next, what risks remain, or how to converge the project.
- The task spans more than one area: provider/CLI, model mapping, OAuth, install scripts, README/docs, `ccproxy run`, tool execution, or regression testing.

Do not use this skill for:

- A single narrow bug where the current request already provides a specific file and expected patch.
- Generic proxy/network debugging unrelated to ccproxy or Claude Code Proxy.
- Claims of completion without reading current files or test evidence.

## Core Principle

Current repo state is the source of truth. Prior session summaries are hints, not proof.

Never mark a subtask complete unless it maps to current evidence:

- current code file
- current test file
- current docs file
- command output from this run
- explicit user-provided evidence

If evidence is missing, write: `证据不足，无法确认。`

## Standard Workflow

### 1. Establish Scope

Identify:

- repo path and branch/worktree if visible
- user goal
- whether this is read-only review, implementation planning, or patch execution
- constraints: no commit, no push, no secrets, no build/test unless allowed

If the user gives a repo path, inspect that path first. Do not rely on memory alone.

### 2. Build The Subtask Map

Create a table of all relevant areas:

| Area | Typical files/evidence | Questions to answer |
|---|---|---|
| Provider and CLI UX | `src/ccproxy`, CLI modules, config files | Are provider names user-facing? Are protocol details hidden? Is API key setup ergonomic? |
| Model mapping | model/provider registry, config, tests | Can user-facing model names map to provider/model/protocol cleanly? |
| OAuth / ChatGPT subscription | auth adapter, callback server, browser flow, logs | Where can consent/login hang? Is callback/state handling robust? |
| Install / uninstall | `scripts/`, packaging files, shell/PowerShell scripts | Is setup cross-platform and reversible? |
| README / product docs | `README.md`, localized docs | Does docs explain product value and shortest path without implementation clutter? |
| `ccproxy run` | run command, payload transformation, tests | Are real Claude Code payloads covered? |
| Tool execution | tool call request/response path, tests | Can Claude tool calls pass through provider adapters correctly? |
| Regression / bare mode | current tests, failing scenarios | What broke before, and what guards it now? |
| Claude Code skills/runtime | runtime logs, skill paths, compatibility notes | Are invalid tool parameters or missing skills runtime issues separated from app bugs? |

Add or remove areas based on the actual request.

### 3. Read Current Evidence

For each area, inspect only the files needed to answer the current question. Prefer `rg` and targeted reads.

Useful searches:

```powershell
rg -n "provider|model|oauth|consent|callback|api key|run|tool|install|uninstall|minimax|deepseek|kimi|zhipu" .
rg --files | rg "README|script|test|src|pyproject|package|lock"
```

Do not output tokens, API keys, account passwords, or auth files. If suspicious values appear, write only: `发现疑似敏感信息，已省略具体值。`

### 4. Classify Each Claim

Use these statuses:

| Status | Meaning |
|---|---|
| Implemented | Current code/docs/tests show it exists. |
| Tested | A relevant test or command was run in this session and passed. |
| Designed only | There is a plan or review conclusion, but no current implementation evidence. |
| Partial | Some code exists but coverage, docs, UX, or edge cases are incomplete. |
| Blocked | Needs user decision, credentials, external service, or unavailable environment. |
| Risk | Evidence suggests a bug, regression, or unclear behavior. |
| Unknown | Evidence insufficient. |

Do not collapse `Implemented` and `Tested`. Code presence is not test success.

### 5. Produce The Convergence Report

Use this structure by default:

```md
# ccproxy Project Convergence Review

## 1. Executive Summary

## 2. Scope And Evidence

## 3. Subtask Status Matrix

| Area | Current evidence | Status | Gap | Next action | Validation |
|---|---|---|---|---|---|

## 4. Cross-Cutting Risks

## 5. Recommended Implementation Order

## 6. Verification Plan

## 7. User Decisions Needed

## 8. Not Verified
```

Keep findings concrete and file-backed. Put high-risk correctness or UX issues before polish.

### 6. If Asked To Implement

Before editing:

1. Present the convergence report or a short scoped plan.
2. Keep edits grouped by area.
3. Prefer tests before behavior changes when feasible.
4. Do not modify unrelated docs or provider logic while working on scripts, and vice versa.
5. Do not commit or push unless explicitly requested.

After editing:

- Run the smallest relevant tests or static checks available.
- If tests are not run, state why.
- Update docs only when behavior or user workflow changed.

## Output Rules

- Lead with what is done, what is missing, and what is risky.
- Separate current evidence from prior-session claims.
- Include file paths and commands when available.
- State `证据不足，无法确认。` for unknowns.
- If the output is a project retrospective or durable summary, also use the `codex-reflection-archiver` convention and write an Obsidian document under `C:\home\for_ai\wiki\codex-reflection\projects\`.

## Guardrails

- Do not broad-scan `.codex`.
- Do not read or print secrets, tokens, API keys, account passwords, or `auth.json`.
- Do not run network or remote commands unless the user requested live verification and approvals allow it.
- Do not claim provider login, subscription mode, OAuth, or tool execution works without real evidence.
- Do not treat guardian/approval subthreads as main user task evidence.
