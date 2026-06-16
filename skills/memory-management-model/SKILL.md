---
name: memory-management-model
description: Three-layer memory architecture for AI agents that balances completeness and efficiency. Use when designing, improving, auditing, or operating agent memory systems; handling context bloat, memory recall, compaction, long-term memory promotion, daily logs, project continuity, skill memory, or cross-session context fracture. Also use proactively when you notice MEMORY.md growing large, when session context is fragmented, or when the user says "remember this" or "don't forget".
---

Operate memory as a layered system — not a single dump file.

## Core model

Maintain three layers:

1. **Working memory**
   - Current turn + active session context
   - Temporary task state, in-flight hypotheses, partial outputs
   - Short horizon, cheap to overwrite — do not treat as durable

2. **Project / episodic memory** → `memory/YYYY-MM-DD.md`
   - Daily logs, task traces, notable events, experiments, failed attempts
   - Append-first, low curation cost; good for audit trail and recent continuity

3. **Semantic / skill memory** → `MEMORY.md` + `skills/`
   - Stable preferences, rules, recurring facts, durable decisions, proven lessons
   - Curated, deduplicated, low-noise — only promote what will matter again

## File mapping

| Layer | File |
|-------|------|
| Working memory | current conversation |
| Episodic / daily log | `memory/YYYY-MM-DD.md` |
| Durable long-term | `MEMORY.md` |
| Project anchors | `USER.md`, `AGENTS.md`, `TOOLS.md` |
| Skill memory | `skills/` + `references/` |
| Temp resumable state | `memory/temp/<task>.md` (with expiry) |

## Long-term value gate

Before writing to `MEMORY.md`, answer these 6 questions:
1. Will this matter after the current task ends?
2. Will it affect future decisions or behavior?
3. Is it validated rather than speculative?
4. Is it likely to recur or save future debugging time?
5. Is it specific enough to be actionable later?
6. Is it safe to store?

**< 3 yes → episodic memory only or don't store.**

## Write policy

- Raw events / progress / findings → **episodic** (`memory/YYYY-MM-DD.md`)
- Stable rules / validated lessons → **semantic** (`MEMORY.md`)
- Repeatable workflows → **skill memory** (`skills/`)
- Transient task state → **working memory only**

## Read policy (recall order)

1. Semantic memory — durable facts and rules
2. Recent episodic memory — active context
3. Skill memory — reusable patterns
4. Infer from current conversation

## Promotion pipeline

`Working → Episodic → Semantic/Skill`

Promote when:
- Pattern repeats across tasks
- User explicitly says "remember this"
- Would save future debugging time
- Changes how the agent should behave
- Reusable as a workflow/checklist

## Lifecycle policy

| Age | Action |
|-----|--------|
| 0–7 days | keep full episodic logs |
| 7–30 days | compress to summaries |
| 30+ days | archive or keep indexed summary only |

Cadence: daily dedup → weekly promote → monthly archive.

## Compaction policy

When context grows large, **preserve**:
- current goal, completed work, remaining blockers
- validated decisions
- next exact action
- exact file paths / commands only if still relevant

**Drop**:
- repetitive logs
- superseded hypotheses
- raw command output once conclusions are extracted
- duplicate restatements of the same rule

## Health targets

- `MEMORY.md`: **< 20 KB**
- `memory/` active working set: **< 100 KB**
- Retrieval: **< 1 second**
- Duplication: **< 5%**

## Default operating loop

### Session start
1. Load `MEMORY.md` → read as semantic layer
2. Load today's `memory/YYYY-MM-DD.md` → read as episodic layer
3. Do NOT auto-promote daily notes into `MEMORY.md`

### During work
- Write milestones, blockers, root causes, next actions → today's `memory/YYYY-MM-DD.md`
- Leave a resumable checkpoint for long tasks: `objective / done / in-progress / blocked / next action`

### After work
- Promote to `MEMORY.md` only if it changes future behavior or is likely to recur
- Promote to `skills/` if it's a reusable workflow or checklist
- Otherwise leave it in the daily note

## Risks and controls

| Risk | Control |
|------|---------|
| Bloat | Store less, summarize more, dedup aggressively |
| Context fracture | Keep resumable summaries with next action |
| False memory | Never promote unverified claims |
| Stale memory | Prune outdated rules during maintenance |
