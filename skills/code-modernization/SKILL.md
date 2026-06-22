---
name: code-modernization
description: Use when assessing, mapping, extracting business rules from, reimagining, transforming, or hardening a legacy codebase such as COBOL, legacy Java/C++, procedural PHP, classic ASP, monolith web apps, or other systems where behavior preservation and migration planning matter.
---

# Code Modernization

## Purpose

Use this skill to adapt the Claude `code-modernization` plugin workflow to Codex. The core sequence is:

`assess -> map -> extract-rules -> brief -> reimagine | transform -> harden`

The goal is to preserve behavior while making modernization decisions evidence-based and reviewable.

## Safety Rules

- Treat legacy source as read-only unless the user explicitly asks for direct edits.
- Prefer writing analysis artifacts under `analysis/<system>/`.
- Prefer writing new implementation under `modernized/<system>/`.
- Do not rewrite before extracting behavior, dependencies, and business rules.
- Use characterization or contract tests before changing behavior.
- Clearly separate verified legacy behavior from inferred intent.

## Workflow

1. **Assess**: inventory languages, size, build system, dependencies, risks, entry points, security posture, and documentation gaps.
2. **Map**: produce a topology of modules, calls, data stores, integrations, and at least one critical-path flow.
3. **Extract Rules**: capture calculations, validations, eligibility rules, state transitions, and policies with file/line citations.
4. **Brief**: synthesize target architecture options, migration phases, behavior contract, validation strategy, open questions, and approval gates.
5. **Reimagine or Transform**:
   - Reimagine when the user wants a greenfield rebuild from extracted intent.
   - Transform when the user wants a module-by-module strangler rewrite.
6. **Harden**: identify critical/high security issues and propose minimal remediation patches without silently editing legacy code.

## Specialist Perspectives

Use these perspectives directly or as prompts for available subagents:

- `legacy-analyst`: read legacy code, identify implicit dependencies, entry points, data flow, and operational assumptions.
- `business-rules-extractor`: mine rule cards with source citations and confidence ratings.
- `architecture-critic`: challenge target architecture and reject unnecessary abstractions or migration theatre.
- `security-auditor`: review auth, secrets, validation, dependency risk, injection, and migration-specific security drift.
- `test-engineer`: design characterization, contract, and equivalence tests that prove behavior preservation.

## Output Artifacts

For non-trivial modernization work, create or propose these artifacts:

- `analysis/<system>/ASSESSMENT.md`
- `analysis/<system>/TOPOLOGY.md` or `TOPOLOGY.mmd`
- `analysis/<system>/BUSINESS_RULES.md`
- `analysis/<system>/DATA_OBJECTS.md`
- `analysis/<system>/MODERNIZATION_BRIEF.md`
- `modernized/<system>/` for new code, only after the brief and tests are understood

Keep artifacts concise enough to review, with file/line citations where possible.
