---
name: technical-diagram-generator
description: Create, improve, replace, or publish source-backed technical diagrams, knowledge explainers, architecture/data/control flows, state/sequence diagrams, Mermaid/Graphviz/SVG/PNG wiki assets, and repair diagram problems such as low information quality, wrong audience depth, text overlap, or arrows covering labels. Use for diagrams, flowcharts, architecture diagrams, technical wiki illustrations, whiteboard-style explainers, 图解, 知识图解, 流程图, 架构图, and diagram quality reviews.
---

# Technical Diagram Generator

Produce audience-calibrated technical diagrams with editable source, rendered output, evidence boundaries, and verified links. This skill is environment-neutral: use only tools available in the current runtime, resolve bundled files relative to this skill directory, and do not assume any private vault, account, host, or publishing system exists.

## Portable Setup

- Resolve `<skill-dir>` as the directory containing this `SKILL.md`.
- Use bundled scripts with `node <skill-dir>/scripts/<script>.cjs ...`.
- Treat `sharp`-based helpers (`render-svg-png-batch.cjs`, `make-contact-sheet.cjs`) as optional. If `sharp` is unavailable, render SVG/PNG with an available equivalent such as browser export, ImageMagick, Inkscape, Graphviz, Mermaid CLI, or the host application's renderer.
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
6. **Design, render, and inspect.** Give each non-panorama figure one learning question. Render editable source to PNG/SVG, run automated checks, then inspect page-width and 100% views.
7. **Publish and verify.** Embed the rendered image, link editable source, update required documentation indexes if they exist, and verify UTF-8, links, Git state, and temporary cleanup when relevant.

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
| Multiple rendering tools are plausible | `references/tool-selection.md` |
| SVG/Mermaid/Graphviz has arrows, dense cards, titles, or collision risk | `references/layout-safety.md` |
| Knowledge-sharing, onboarding, batch figures, or style calibration | `references/content-quality.md` |

Default choices:

- Learning explainer or precise wiki figure: hand-authored whiteboard-style SVG + PNG.
- Dense deterministic graph: Graphviz DOT + SVG/PNG.
- Simple inline flow/sequence: Mermaid, unless rendered assets are required.
- Real whiteboard/document platform: use the platform-specific connector or skill only if it is installed and relevant.
- Obsidian, Feishu/Lark, GitHub Wiki, or another publishing target: follow that target's local conventions when discoverable; otherwise keep source and rendered assets together with portable relative links.

Do not hard-code machine-specific attachment roots. If the target documentation tree already has an attachment convention, use it; otherwise create a nearby `assets/`, `images/`, or `_attachments/` directory scoped to the page or topic.

## Delivery Contract

Preserve editable source and rendered output:

- `.svg + .png`
- `.dot + .svg/.png`
- `.mmd + .png`

For Markdown/wiki pages, embed PNG and link source nearby:

```markdown
![Readable alt text](../../../_attachments/path/diagram.png)

> Diagram source: [`diagram.svg`](../../../_attachments/path/diagram.svg)
```

## Verification

Run the relevant checks:

```powershell
node <skill-dir>/scripts/lint-svg-text-overlap.cjs path/to/diagram.svg
node <skill-dir>/scripts/lint-mermaid-layout.cjs path/to/diagram.mmd
node <skill-dir>/scripts/verify-wiki-diagrams.cjs page.md
```

For batches, render a contact sheet when the required image tooling is available. Always inspect representative PNGs for:

- correct direction and complete arrows;
- no connector through text/title/legend;
- text inside cards with readable spacing;
- consistent symbol depth, font size, colors, and card structure;
- page-width comprehension and full-resolution detail.

When publishing a meaningful wiki or documentation change, update any discovered navigation/index/log files in that project. Report sources, files changed, visual inspection, UTF-8/link checks, and Git state when Git is in scope.
