---
name: technical-diagram-generator
description: Formal diagram release pipeline — Draw.io sources (--format drawio/both), spec-driven standard components, the automated quality gate with content-addressed review receipts, and render/semantic parity between channels. Use when the user explicitly asks for a Draw.io file or an editable .drawio source, for standard-component or spec-driven generation, for Mermaid/Graphviz assets, or for a formal quality/parity audit of existing diagrams. Also provides the shared Diagram Brief template and the SVG/wiki linters (check-diagram-brief, lint-svg-text-overlap, lint-drawio-layout, verify-wiki-diagrams). For hand-authored SVG 图解 and the learning documents around them, use diagram-authoring instead.
---

# Technical Diagram Generator

Produce audience-calibrated technical diagrams with source evidence, rendered output, and verified links. The released generator defaults to SVG: omit `--format` or use `--format svg`. Use Draw.io only when the user explicitly requests Draw.io (`--format drawio`), and use `--format both` only when the user explicitly requests both channels. Keep the legacy SVG repair route for existing SVG work. This skill is environment-neutral: use only tools available in the current runtime and do not assume a private vault, account, host, or publishing system.

## Portable Setup

- Resolve `<skill-dir>` as the directory containing this `SKILL.md`.
- Use bundled scripts with `node <skill-dir>/scripts/<script>.cjs ...`.
- Supported release environments are native Windows and Ubuntu 22.04 x86_64 (Node.js 20+, Python 3.10+). In a clean skill directory, run `npm ci`; do not rely on inherited `node_modules` or `NODE_PATH`.
- For an explicit Draw.io request, resolve the executable in this order: `--drawio-executable`, `DRAWIO_EXECUTABLE`, `drawio`/`draw.io` on `PATH`, then the Windows default installation. Ubuntu requires `xvfb-run -a`; missing local Draw.io or `xvfb-run` is a failure, not a fallback to SVG.
- Always export through `scripts/export-drawio.cjs`: it adds `--no-sandbox` when the process runs as root, which Electron requires. Invoking the `drawio` binary directly as root aborts with `Running as root without --no-sandbox is not supported` and dumps core, so a manual command must pass `--no-sandbox` itself.
- Treat `sharp`-based helpers (`render-svg-png-batch.cjs`, `make-contact-sheet.cjs`) as optional. If `sharp` is unavailable, render SVG/PNG with an available equivalent such as browser export, ImageMagick, Inkscape, Graphviz, Mermaid CLI, or the host application's renderer.
- Keep generated assets inside the user's current project, document, wiki, or requested output directory. Use portable relative links from Markdown pages to generated assets.
- Use ASCII filenames for generated assets unless the user explicitly requires another naming convention.

## Core Workflow

1. **Read sources.** Verify code, documents, artifacts, tables, or screenshots before drawing. Separate confirmed facts, inference, and unverified behavior.
2. **Define the reader contract.** Record what the reader knows, the missing connection, and what they must explain after reading.
3. **Select information depth.** Keep system modules and the main functions/interfaces required to explain the call framework. Move internal containers, local variables, helper functions, register fields, and state details to an advanced page unless they are the learning point.
4. **Write a Diagram Brief.** For a formal, complex, style-sensitive, or multi-image task, copy `<skill-dir>/assets/diagram-brief-template.md`, fill every field, select the requested format and component layout, and run:

   ```powershell
   node <skill-dir>/scripts/check-diagram-brief.cjs <brief.md>
   ```

5. **Gate batch work.** For two or more formal figures, a whole-article rewrite, or a user-specified style, deliver one representative diagram and one complete prose section first. Wait for approval unless the user explicitly waives the gate.
6. **Build, inspect, and protect sources.** Use the standard component workflow for formal diagrams. The default SVG release emits only the requested SVG source; Draw.io and dual-channel delivery are explicit. Validation previews are temporary and are not extra requested deliverables. Never overwrite a manually edited or existing authoritative source: publish a `.generated` or `.generated-vN` candidate instead. Run the required layout checks and visual review at page width and 100%.
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
| Formal standard-component generation | `references/standard-component-generator.md` |
| Explicit Draw.io or `both` request | `references/drawio-quality-standard.md` |
| Multiple rendering tools are plausible | `references/tool-selection.md` |
| SVG/Mermaid/Graphviz has arrows, dense cards, titles, or collision risk | `references/layout-safety.md` |
| Knowledge-sharing, onboarding, batch figures, or style calibration | `references/content-quality.md` |

Default choices:

- Formal, style-sensitive, or manually editable figure: standard components with SVG release by default.
- Explicit Draw.io request: Draw.io source plus its required validation exports.
- Explicit `--format both` request: SVG and Draw.io sources, with both quality gates and semantic comparison.
- Dense deterministic graph: Graphviz DOT + SVG/PNG.
- Simple inline flow/sequence: Mermaid, unless rendered assets are required.
- Real whiteboard/document platform: use the platform-specific connector or skill only if it is installed and relevant.
- Explicit SVG generation or legacy SVG repair: use the original SVG route and preserve its source and outputs.
- Obsidian, Feishu/Lark, GitHub Wiki, or another publishing target: follow that target's local conventions when discoverable; otherwise keep source and rendered assets together with portable relative links.

Do not hard-code machine-specific attachment roots. If the target documentation tree already has an attachment convention, use it; otherwise create a nearby `assets/`, `images/`, or `_attachments/` directory scoped to the page or topic.

## Release Contract

- Default SVG delivery: .svg only. Use `--format svg` or omit `--format`.
- Explicit Draw.io delivery: .drawio only. Use `--format drawio`; a missing Draw.io runtime fails this request and must not silently produce `.svg`.
- Both-channel delivery: .svg + .drawio. Use `--format both`.
- SVG/PNG validation exports are temporary unless explicitly requested. User or publishing-target retention is an explicit request, not an implied deliverable for any format.
- Treat SVG and Draw.io as independent authoritative sources. Do not replace a hand-authored SVG with an exported Draw.io SVG.
- Do not overwrite existing authoritative or manually edited sources, and do not overwrite earlier generated candidates. Write `.generated` or `.generated-vN` candidates for comparison and manual merge.

For Markdown/wiki pages, embed PNG and link source nearby:

```markdown
![Readable alt text](../../../_attachments/path/diagram.drawio.png)

> Diagram source: [`diagram.drawio`](../../../_attachments/path/diagram.drawio)
```

## Verification

Run the relevant checks, including strict layout and visual inspection at page width and 100%:

```powershell
node <skill-dir>/scripts/lint-svg-text-overlap.cjs path/to/diagram.svg
node <skill-dir>/scripts/lint-mermaid-layout.cjs path/to/diagram.mmd
node <skill-dir>/scripts/verify-wiki-diagrams.cjs page.md
```

For Draw.io or `both`, also require Draw.io SVG/PNG render parity and semantic parity. Keep the `visual-pending` quality report immutable. Record page-width and 100% visual review with `scripts/record-diagram-review.cjs`; it creates a content-addressed `*.review-<quality-report-sha256>.json` receipt beside the report. The recorder rejects failed checks, non-empty report errors, or any mismatch among requested format, requested deliverables, and authored artifact kinds. Only a `ready` receipt bound to unchanged authored-artifact hashes permits release; the quality report itself remains `visual-pending`.

For batches, render a contact sheet when the required image tooling is available. Always inspect representative PNGs for:

- correct direction and complete arrows;
- no connector through text/title/legend;
- text inside cards with readable spacing;
- consistent symbol depth, font size, colors, and card structure;
- page-width comprehension and full-resolution detail.

When publishing a meaningful wiki or documentation change, update any discovered navigation/index/log files in that project. Report sources, files changed, visual inspection, UTF-8/link checks, and Git state when Git is in scope.

For the component schema, CLI, delivery plan, and Ubuntu user-level setup, read `references/standard-component-generator.md`.
