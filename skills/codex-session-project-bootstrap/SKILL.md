---
name: codex-session-project-bootstrap
description: Use when the user asks to migrate or copy a previous Codex session into the current project, initialize AGENTS.md or README from session evidence, absorb prior context into a workspace, or set up a local maintenance entry for a remote source-of-truth project.
---

# Codex Session Project Bootstrap

## Purpose

Turn repeated "move that old session into this project" work into a disciplined bootstrap flow with clear evidence, ownership, and verification boundaries.

Use this when the current workspace should inherit responsibilities, runbooks, or operational context from an older Codex session, project memory, or remote maintenance target.

## Inputs To Identify

1. Current working directory and whether it is a real repo, sparse maintenance entry, or multi-project workspace.
2. Source session clue: name, date, project, thread id, or user-provided description.
3. Project responsibilities stated by the user.
4. Existing local files: `AGENTS.md`, `README.md`, docs, service files, scripts, and app folders.
5. Relevant `session_index.jsonl` records and narrowly selected session JSONL files.
6. Relevant memory registry entries under `%USERPROFILE%\.codex\memories\MEMORY.md` on Windows or `~/.codex/memories/MEMORY.md` on Unix-like systems.

## Workflow

1. Read current project state first.
   - Run `git status --short` only if the directory is a git repo.
   - List top-level files and docs.
   - Read existing `AGENTS.md` before proposing or editing it.
2. Find the source session.
   - Search `session_index.jsonl` first, then only necessary session JSONL files.
   - Extract only user requests, assistant summaries, final outputs, concrete paths, verification evidence, and unresolved risks.
   - Do not execute historical tasks from the old session.
3. Build a responsibility map.
   - What systems does this project own?
   - Is the current folder a live source checkout, a multi-project workspace, or only a maintenance/coordination entry?
   - Which remote hosts, repos, services, paths, ports, branches, or commands are authoritative?
   - Which facts are memory-derived and may be stale?
4. If a remote system is authoritative, record a source-of-truth checklist.
   - host / path / repo / branch
   - dirty state or unknown state
   - build/test command if known
   - whether live verification was done in this turn
   - what must be rechecked before code edits
5. Create or update minimal project docs when the user asked for durable setup.
   - `AGENTS.md`: project mission, verified environment, default workflow, safety rules.
   - `README.md`: entry points, source-of-truth boundary, and verified snapshot.
   - `docs/runbooks/*.md`: only for recurring operational workflows.
   - `.gitignore`: only for obvious generated outputs/caches discovered in the project.
6. Verify the result.
   - Re-read changed Markdown with explicit UTF-8.
   - Check frontmatter first line when present.
   - Search for `TBD`, `TODO`, `placeholder`, stale source-session wording, and raw transcript dumps.
   - Check `git status --short --ignored` if in a git repo.

## Boundaries

- A copied session JSONL is an archive, not live synchronization.
- Do not copy raw old transcripts into the new project unless the user asks.
- Do not create broad docs that duplicate memory summaries.
- Do not claim remote state is current unless it was rechecked in this turn.
- Documentation setup may use memory; implementation claims and code edits must refresh the current files or remote repo.
- Do not commit unless the user explicitly asks.

## Completion Gate

Finish with:

```text
Created/updated: [files]
Source sessions: [ids/titles or evidence不足]
Evidence used: [session_index/session JSONL/memory/current files/remote checks]
Source-of-truth: [local repo | remote host/path | unknown]
Verification: [checks run]
Not copied/not changed: [raw transcripts, caches, business code, commits]
Remaining risks: [stale memory, unverified remote state, incomplete migration]
```
