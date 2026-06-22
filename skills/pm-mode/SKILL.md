---
name: pm-mode
description: Use this skill for Codex PM/project-manager mode whenever a user asks to plan, coordinate, implement, debug, review, research, create a deliverable, use multiple tools or skills, work in parallel, manage agents, or says PM/项目管理/拆任务/并行/agent/Superpowers. It turns vague work into verifiable goals, selects relevant skills, applies Superpowers workflows such as brainstorming, systematic-debugging, TDD, planning, subagent execution, and verification-before-completion, tracks blockers, and verifies before final response. Skip only for trivial one-step requests or when the user explicitly says direct/no PM.
---

# PM Mode — Codex 项目经理执行规范

## Core Idea

PM mode is not extra paperwork. It is the habit of turning a task into a small, verifiable execution system:

1. Clarify the goal and assumptions.
2. Choose the right skills, tools, and execution shape.
3. Break work into steps with verification points.
4. Execute surgically.
5. Surface blockers early.
6. Verify before claiming completion.

Superpowers is the default method layer for PM mode. PM decides what workflow applies; Superpowers provides the discipline for brainstorming, debugging, TDD, planning, delegation, and final verification.

Use this skill as the default for non-trivial work. Do not use it for tiny one-step requests such as "show the current directory" or when the user explicitly asks to skip PM/planning.

## Priority Rules

Follow this order when rules conflict:

1. User's explicit request and project instructions such as `AGENTS.md`.
2. Safety, sandbox, approval, and platform constraints.
3. Superpowers workflow rules.
4. General PM-mode defaults.

If a Superpowers skill requires a gate such as user approval, respect it unless a higher-priority instruction for the current environment explicitly requires continuing without pausing.

## Start Checklist

Before executing, answer these questions briefly:

1. What is the user's concrete objective?
2. What assumptions am I making?
3. Which Superpowers or domain skills apply?
4. How will I know the task is complete?
5. How will I know the result is correct?
6. What would count as failure or a blocker?

If the answer materially depends on missing information that cannot be discovered safely, ask. Otherwise, state reasonable assumptions and continue.

## Superpowers Dispatch Matrix

Load and follow the relevant Superpowers skill before doing the work. If both a `superpowers:*` and `source-command-*` version exist, prefer the one available in the current environment and closest to the task wording.

| Situation | Use |
| --- | --- |
| Starting non-trivial work with possible skills | `superpowers:using-superpowers` |
| Creative work, feature design, behavior changes, new components | `superpowers:brainstorming` or `source-command-brainstorming` |
| Multi-step implementation plan from a spec | `superpowers:writing-plans` or `source-command-write-plan` |
| Executing an existing implementation plan | `superpowers:executing-plans` or `source-command-execute-plan` |
| Independent tasks that can run in parallel | `superpowers:subagent-driven-development` / `dispatching-parallel-agents` or source-command equivalents |
| Bug, failing test, unexpected behavior, production issue | `superpowers:systematic-debugging` or `source-command-systematic-debugging` |
| Feature, bugfix, refactor, behavior change | `superpowers:test-driven-development` when practical |
| Before claiming done/fixed/passing | `superpowers:verification-before-completion` or `source-command-verify` |
| Major work before merge or handoff | `superpowers:requesting-code-review` when available |
| Receiving review feedback | `superpowers:receiving-code-review` |

Do not merely name a Superpowers skill. Read or invoke the actual skill instructions, then make the plan comply with them.

## Domain Skill Selection

After process skills, select domain skills before implementation. When a task matches a listed skill description, read that skill's `SKILL.md` and follow its workflow.

Common mappings:

| Task type | Likely skill family |
| --- | --- |
| Code review | code-review stance; findings first |
| Writing or modifying a skill | skill-creator |
| Long-running or recurring work | automation tools |
| Frontend app or UI build | frontend app/design/testing skills |
| Browser verification | browser or webapp-testing skills |
| Wiki or Obsidian knowledge output | obsidian/wiki writing skills |
| Supabase work | Supabase skills and current docs |
| OpenAI API/product work | openai-docs and official current docs |

Process skills determine how to work; domain skills determine what domain rules to follow. Use both when both apply.

## Execution Plan

For multi-step work, give the user a short human-readable plan before edits or long-running actions:

```text
准备这样执行：
1. [先确认/读取什么] -> 验证: [证据]
2. [实施什么] -> 验证: [测试/检查]
3. [收尾什么] -> 验证: [最终交付标准]
```

Then continue execution without waiting unless the user requested approval, the applicable Superpowers workflow requires approval, or the next action is risky/destructive.

Use `update_plan` when the task has multiple meaningful steps. Keep exactly one item in progress and update statuses as work completes.

## Brainstorming Gate

For creative work, feature design, UI/UX changes, new components, or behavior changes:

1. Explore the existing project context first.
2. Clarify purpose, constraints, and success criteria.
3. Present a compact design or approach with tradeoffs.
4. Get user approval when the active Superpowers brainstorming workflow requires it.
5. Only then write code or invoke implementation skills.

For very small changes where the user has already specified the exact behavior, the design can be short, but still make assumptions and verification explicit.

## Debugging Gate

For bugs, failing tests, unexpected behavior, service failures, or production incidents:

1. Read the error and current evidence.
2. Reproduce or gather enough data to localize the failing layer.
3. Compare with working examples or prior known-good behavior.
4. State one root-cause hypothesis.
5. Test the hypothesis with the smallest safe check.
6. Fix the root cause, not the symptom.

Do not propose or apply fixes before root-cause investigation unless the user explicitly asks for a temporary mitigation and understands the tradeoff.

## TDD Gate

For feature work, bug fixes, refactors, and behavior changes:

1. Write or identify the narrow failing test/check first.
2. Run it and confirm the failure is meaningful.
3. Implement the smallest change to pass.
4. Run the same test/check again.
5. Refactor only if it serves the requested change and tests stay green.

If automated tests are not available or practical, use the closest verifiable substitute: smoke script, API request, browser check, log assertion, or manual reproduction checklist. State that boundary.

## Task Decomposition

Break work into the smallest independent units that still produce useful evidence.

Prefer direct execution when:

- The task is one or two steps.
- The blast radius is small.
- A single verification command or file check is enough.

Use parallelism or subagents only when:

- Work items are independent.
- They do not race on the same files or state.
- Their outputs can be reviewed and integrated by the PM.
- The environment exposes an appropriate multi-agent or parallel tool capability.

When parallelizing shell reads, use the available parallel tool wrapper. When spawning agents, give each agent explicit success criteria, output expectations, and blocker reporting rules.

## Blocker Handling

Treat blockers as first-class state, not as silent waiting.

Use this format when reporting a blocker:

```text
Blocker: [wait_user | wait_external | wait_dependency | unfeasible]
原因: [specific reason]
已尝试: [what was tried]
等待: [who or what]
建议: [next viable options]
```

Blocker types:

| Type | Meaning | PM action |
| --- | --- | --- |
| `wait_user` | Needs user decision, secret, account, or unavailable context | Ask one concise question |
| `wait_external` | External service, network, API, or approval is blocking | Try safe alternatives; report if still blocked |
| `wait_dependency` | Another step must finish first | Keep dependent work pending |
| `unfeasible` | Current approach cannot work | Explain why and switch approach or stop |

Do not repeat the same failed strategy more than twice. After two failures, change the approach or ask for the missing decision.

## Quality Gates

A task is not done because an edit was made or a command ran. It is done when the success criteria have evidence.

Gate before execution:

- Scope is clear enough.
- Relevant Superpowers and domain skills were loaded.
- The plan does not violate user or project instructions.
- The plan does not violate known skill constraints.

Gate during execution:

- Each step produces observable evidence: file exists, diff is expected, command returns expected status, API returns expected fields, screenshot renders, or logs show the target behavior.
- Progress updates mention stage, blocker, and verification data, not raw terminal noise.

Gate before final response:

- Invoke or follow verification-before-completion.
- Review the diff or changed files when files were edited.
- Run the narrowest meaningful test/check freshly.
- Read the full output and exit code.
- State verification boundaries clearly: local smoke, unit test, browser check, remote check, or not run.
- Do not claim a fix is complete if only reasoning changed.

For code changes, keep edits surgical: touch only lines needed for the user's request and clean up only unused code introduced by this work.

## Codex Adaptation From Hermes PM

This skill was adapted from a Hermes `pm-mode` workflow. Keep the governance ideas, not Hermes-specific tool names:

| Hermes concept | Codex/global equivalent |
| --- | --- |
| `skill_view(name)` | Read the relevant local `SKILL.md` or invoke the available skill tool |
| `~/.hermes/task_queue.json` | Use `update_plan`, current thread state, or explicit task files if the project already has them |
| Feishu progress updates | Short user-visible progress updates in the commentary channel |
| dedicated review/test/learning agents | Independent review/test/learning passes when available; otherwise do the passes inline |
| `skill_manage` | Update durable docs or skills only when requested or clearly part of the task |
| Hermes gateway/profile state | Explicitly inspect the current runtime, config, host, cwd, and state files before assuming |

## Completion Template

Use a concise final response:

```text
完成了：[what changed]
验证：[tests/checks and result]
边界：[anything not verified or residual risk]
```

If there are no caveats, omit the boundary line. Keep final answers short unless the user asked for a detailed report.
