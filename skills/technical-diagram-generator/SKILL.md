---
name: technical-diagram-generator
description: Create, improve, replace, or publish source-backed technical diagrams, including hand-authored Draw.io sources, SVG/PNG wiki assets, and layout or parity checks. Use for diagrams, flowcharts, architecture diagrams, technical wiki illustrations, whiteboard-style explainers, 鍥捐В, 鐭ヨ瘑鍥捐В, 娴佺▼鍥? 鏋舵瀯鍥? and diagram quality reviews.
---

# Technical Diagram Generator

Produce audience-calibrated technical diagrams with source evidence, rendered output, and verified links. Draw.io is a manual editable-source route: create or edit the `.drawio` source directly, then run the bundled export and checks. This skill does not auto-layout or generate Draw.io XML from a component specification. Keep the legacy SVG repair route for existing SVG work. This skill is environment-neutral: use only tools available in the current runtime and do not assume a private vault, account, host, or publishing system.

## Portable Setup

- Resolve `<skill-dir>` as the directory containing this `SKILL.md`.
- Use bundled scripts with `node <skill-dir>/scripts/<script>.cjs ...` or the documented PowerShell/Python entry point.
- Treat `sharp`-based helpers (`render-svg-png-batch.cjs`, `make-contact-sheet.cjs`, and render-parity checks) as optional only when an equivalent renderer is available and the relevant check does not require them.
- For Draw.io export, resolve the executable explicitly through the script argument or `DRAWIO_EXECUTABLE`; missing Draw.io is a failure, not a silent format fallback.
- Keep generated assets inside the user's current project, document, wiki, or requested output directory. Use portable relative links from Markdown pages to generated assets.
- Use ASCII filenames for generated assets unless the user explicitly requires another naming convention.

## Core Workflow

1. **Read sources.** Verify code, documents, artifacts, tables, or screenshots before drawing. Separate confirmed facts, inference, and unverified behavior.
2. **Define the reader contract.** Record what the reader knows, the missing connection, and what they must explain after reading.
3. **Select information depth.** Keep system modules and the main functions/interfaces required to explain the call framework. Move internal containers, local variables, helper functions, register fields, and state details to an advanced page unless they are the learning point.
4. **Write a Diagram Brief.** For a formal, complex, style-sensitive, or multi-image task, copy `<skill-dir>/assets/diagram-brief-template.md`, fill every field, and run:

   ```powershell
   node <skill-dir>/scripts/check-diagram-brief.cjs <brief.md>
   ```

5. **Gate batch work.** For two or more formal figures, a whole-article rewrite, or a user-specified style, deliver one representative diagram and one complete prose section first. Wait for approval unless the user explicitly waives the gate.
6. **Author, render, and inspect.** For Draw.io, edit the `.drawio` source directly, export SVG/PNG through the bundled adapter, run the relevant checks, and inspect page-width and 100% views. Never overwrite a manually edited or existing authoritative source: publish a `.generated` or `.generated-vN` candidate instead.
7. **Publish and verify.** Embed the rendered image, link the editable source, update required documentation indexes if they exist, and verify UTF-8, links, Git state, and temporary cleanup when relevant.

## Content Gates

- "Beginner-readable" means add context, inputs/outputs, and reasons; do not remove the technical backbone.
- Use three symbol levels:
  - **L1 system:** modules/layers; keep.
  - **L2 main entry:** main functions, ioctls, interfaces, packets; keep when needed and explain the role next to the name.
  - **L3 internals:** fields, helpers, local state, formulas; omit from the main learning diagram unless central to its question.
- Structure stage cards as: **problem -> input -> main action/function -> output -> why needed**.
- A panorama may cover the full path, but distinguish initialization, per-task execution, and completion feedback when they differ.
- Do not create a new figure that only crops or repeats another figure. Merge it or give it a distinct learning question.
- Do not guess hidden RTL, address layout, timing, or side effects. Preserve the unknown explicitly.

For knowledge-sharing pages, whole-article diagram sets, or uncertain information density, read `references/content-quality.md` before drafting.

## Tool And Layout Routing

Read references only when needed:

| Condition | Read/use |
|---|---|
| Explicit Draw.io source or export request | `references/drawio-quality-standard.md` |
| Multiple rendering tools are plausible | `references/tool-selection.md` |
| SVG/Mermaid/Graphviz has arrows, dense cards, titles, or collision risk | `references/layout-safety.md` |
| Knowledge-sharing, onboarding, batch figures, or style calibration | `references/content-quality.md` |

Default choices:

- Formal Draw.io figure: hand-authored `.drawio` source plus the required exported SVG/PNG and checks.
- Explicit Draw.io request: use `lint-drawio-layout.py`, `export-drawio.ps1` or `export-drawio.cjs`, and `compare-render-parity.cjs`.
- When both SVG and Draw.io sources exist, use `compare-semantic-parity.cjs` where applicable.
- Dense deterministic graph: Graphviz DOT + SVG/PNG.
- Simple inline flow/sequence: Mermaid, unless rendered assets are required.
- Existing SVG repair: use the original SVG route and preserve its source and outputs.
- Formal card-style Draw.io: use the hand-authored `.drawio` route and run the strict Draw.io linter before export.
- Obsidian, Feishu/Lark, GitHub Wiki, or another publishing target: follow that target's local conventions when discoverable; otherwise keep source and rendered assets together with portable relative links.

Do not hard-code machine-specific attachment roots. If the target documentation tree already has an attachment convention, use it; otherwise create a nearby `assets/`, `images/`, or `_attachments/` directory scoped to the page or topic.

## Release Contract

- Draw.io delivery: retain the editable `.drawio` source and export `.drawio.svg` plus `.drawio.png` when the publishing target requires them.
- Draw.io export requires a local Draw.io runtime; a missing runtime is a failure and must not silently produce another source format.
- Treat the hand-authored Draw.io source and exported SVG/PNG as separate artifacts. Do not replace a hand-authored SVG with an exported Draw.io SVG.
- Do not overwrite existing authoritative or manually edited sources. Write `.generated` or `.generated-vN` candidates for comparison and manual merge.

For Markdown/wiki pages, embed PNG and link source nearby:

```markdown
![Readable alt text](../../../_attachments/path/diagram.drawio.png)

> Diagram source: [`diagram.drawio`](../../../_attachments/path/diagram.drawio)
```


## Verification

Run the relevant checks, including strict layout and visual inspection at page width and 100%:

```powershell
python <skill-dir>/scripts/lint-drawio-layout.py path/to/diagram.drawio --strict
powershell -File <skill-dir>/scripts/export-drawio.ps1 -InputPath path/to/diagram.drawio -OutputDirectory path/to/output -DrawioExecutable path/to/drawio.exe
node <skill-dir>/scripts/compare-render-parity.cjs path/to/diagram.drawio.svg path/to/diagram.drawio.png
node <skill-dir>/scripts/lint-svg-text-overlap.cjs path/to/diagram.svg
node <skill-dir>/scripts/lint-mermaid-layout.cjs path/to/diagram.mmd
node <skill-dir>/scripts/verify-wiki-diagrams.cjs page.md
```

When an SVG companion is available, also run `compare-semantic-parity.cjs` where the source roles are comparable. Automated checks do not replace visual inspection: verify arrow direction, text containment, connector clearance, page-width comprehension, and full-resolution detail.

When publishing a meaningful wiki or documentation change, update any discovered navigation/index/log files in that project. Report sources, files changed, visual inspection, UTF-8/link checks, and Git state when Git is in scope.
