---
name: codex-reflection-archiver
description: Use whenever the user asks for Codex self-reflection, 总结反思, 自我反思, 复盘, 项目总结, project retrospective, automation evolution, prompt evolution, skill evolution, or durable reflection/evolution summaries. Do not use for read-only inspection or patch-only recommendations.
---

# Codex Reflection Archiver

Create durable Obsidian reflection documents for Codex self-review, project retrospectives, and workflow evolution notes.

## Core Rule

When the task is a self-reflection, summary reflection, project retrospective, Daily Codex Self-Review, automation/prompt/skill evolution note, or any user-requested “总结/复盘/反思” intended to persist, write a Markdown document under:

```text
C:\home\for_ai\wiki\codex-reflection
```

Daily automation may also write its project-local copy under `notes/codex-daily/YYYY-MM-DD.md`, but the Obsidian copy is the durable knowledge-base copy.

Read-only exception: if the user asks only to inspect, audit, analyze, compare, recommend, or provide patch-level suggestions, and does not ask for durable output or workflow changes, do not create or update Obsidian files. Use this skill as a checklist and return evidence/proposed changes only.

## Target Paths

| Reflection Type | Path |
|---|---|
| Daily Codex Self-Review | `C:\home\for_ai\wiki\codex-reflection\daily\YYYY-MM-DD.md` |
| Project/task retrospective | `C:\home\for_ai\wiki\codex-reflection\projects\YYYY-MM-DD-<topic-slug>.md` |
| Automation/prompt/skill evolution | `C:\home\for_ai\wiki\codex-reflection\evolution\YYYY-MM-DD-<topic-slug>.md` |
| Area index | `C:\home\for_ai\wiki\codex-reflection\index.md` |

Use a short lowercase ASCII slug for `<topic-slug>` when possible. If the user names a Chinese project, keep the Chinese title in frontmatter and use a safe slug in the filename.

## Document Contract

Every reflection document must include:

1. Frontmatter with `type`, `title`, `created`, `updated`, `tags`, `status`, and `scope`.
2. Evidence sources: session records, files, logs, user-provided context, or explicit “证据不足，无法确认。”
3. What was done or observed.
4. What went wrong or remains risky.
5. Root cause when evidence supports it.
6. Verification performed and verification not performed.
7. Actionable next steps.
8. Secret handling note if relevant.

Do not quote secrets, tokens, account passwords, `auth.json`, or private path fragments. If suspected sensitive content appears, write only: `发现疑似敏感信息，已省略具体值。`

## Standard Frontmatter

```md
---
type: codex-reflection
title: "..."
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags:
  - codex
  - reflection
status: active
scope: daily | project | evolution
source:
  - "..."
---
```

## Daily Reflection Structure

For daily reviews, preserve the Daily Codex Self-Review structure when available. The Obsidian page may mirror the project-local note, but must be readable as a standalone vault page.

For Daily Codex Self-Review evidence collection, first use codex-daily-self-review. This archiver only persists the reflection and maintains vault indexes; it should not duplicate session coverage or AGENTS.md decision rules.

Minimum daily sections:

1. 今日结论
2. 最近 24 小时工作摘要
3. Codex 行为复盘
4. Prompt 质量复盘
5. 验证复盘
6. Skills 使用复盘
7. 是否需要沉淀新 Skill
8. 是否需要更新 AGENTS.md
9. 今天应该做什么
10. 今天不应该做什么
11. 今天第一条推荐 Prompt
12. 未验证项和风险
13. Automation 自我进化建议

## Project Reflection Structure

For project/task retrospectives, use:

```md
# <Project / Topic> 复盘

## 1. 结论
## 2. 背景与目标
## 3. 证据来源
## 4. 完成内容
## 5. 问题与风险
## 6. 根因分析
## 7. 验证情况
## 8. 后续行动
## 9. 可沉淀规则 / Skill / Prompt
```

## Evolution Note Structure

For automation, prompt, skill, or workflow evolution:

```md
# <Topic> 进化记录

## 1. 改动结论
## 2. 触发原因
## 3. 根因
## 4. 改动内容
## 5. 验证
## 6. 剩余风险
## 7. 下次规则
```

## Vault Index Maintenance

When creating a reflection document:

1. Ensure `C:\home\for_ai\wiki\codex-reflection\index.md` exists.
2. Add or update a concise entry in the relevant section if the document should be easy to find.
3. For important changes, update `C:\home\for_ai\wiki\hot.md` and `C:\home\for_ai\wiki\log.md` with a short entry.
4. Use UTF-8 BOM on Windows-facing Markdown files to avoid mojibake in PowerShell or desktop previews.

## Guardrails

- Respect read-only/no-file-change requests even when this skill is triggered; use the skill as a checklist, not implicit write authorization.
- Do not modify business code while archiving a reflection.
- Do not run build/test/remote build only to write a reflection unless the user explicitly asks.
- Do not turn every chat answer into an Obsidian page; this skill is for reflective summaries, retrospectives, and evolution records.
- Do not broad-scan `.codex`; use the user-provided evidence, automation memory, session indexes, and explicitly relevant logs.
- If evidence is missing, write `证据不足，无法确认。`
