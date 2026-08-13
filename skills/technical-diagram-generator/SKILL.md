---
name: technical-diagram-generator
description: Create, improve, replace, or publish source-backed technical diagrams — Draw.io sources, SVG/PNG wiki assets, layout and parity checks. Use when asked to 画图/出图解/改图/重画, for 图解, 知识图解, 流程图, 架构图, 时序图, flowcharts, architecture diagrams, wiki 配图, whiteboard-style explainers, and diagram quality reviews; also when arrow directions or layout look wrong, when text overflows a card, or when a figure needs an editable source.
---

# Technical Diagram Generator

Produce audience-calibrated technical diagrams with source evidence, rendered output, and verified links. This skill is environment-neutral: use only tools available in the current runtime and do not assume a private vault, account, host, or publishing system.

For the learning document a figure belongs to — doc-type triage, evidence grading, `file:line` discipline — use `learning-doc-writer`.

## Format: Draw.io by default

**Default: build a `.drawio` source with `scripts/drawiokit.py`, then export.** Draw.io gives the reader an editable source, and the strict linter can check its geometry before anything is rendered.

Use the SVG route (`scripts/svgkit.py`) only when:

- the user asks for SVG, `.svg`, or a hand-authored figure; or
- the figure needs free coordinates Draw.io cards cannot express — memory/bit-field layouts, irregular topologies, cross-region swimlanes.

Switching routes is a decision to state in the delivery, not a silent one. Both routes share `assets/layout-constants.json`, so a card sized on one route is sized the same way on the other.

## Portable Setup

- Resolve `<skill-dir>` as the directory containing this `SKILL.md`.
- Use bundled scripts with `node <skill-dir>/scripts/<script>.cjs ...` or the documented PowerShell/Python entry point.
- In a clean skill directory run `npm ci`; do not rely on inherited `node_modules` or `NODE_PATH`.
- Treat `sharp`-based helpers (`render-png.mjs`, `make-contact-sheet.cjs`, and render-parity checks) as optional only when an equivalent renderer is available and the relevant check does not require them.
- For Draw.io export, resolve the executable explicitly through the script argument or `DRAWIO_EXECUTABLE`; missing Draw.io is a failure, not a silent format fallback.
- Keep generated assets inside the user's current project, document, wiki, or requested output directory. Use portable relative links from Markdown pages to generated assets.
- Use ASCII filenames for generated assets unless the user explicitly requires another naming convention.

## Core Workflow

1. **Read sources.** Verify code, documents, artifacts, tables, or screenshots before drawing. Separate confirmed facts, inference, and unverified behavior.
2. **Define the reader contract.** Record what the reader knows, the missing connection, and what they must explain after reading.
3. **Select information depth.** Keep system modules and the main functions/interfaces required to explain the call framework. Move internal containers, local variables, helper functions, register fields, and state details to an advanced page unless they are the learning point.
4. **Write a Diagram Brief.** For a formal, complex, style-sensitive, or multi-image task, copy `<skill-dir>/assets/diagram-brief-template.md`, fill every field, and run:

   ```bash
   node <skill-dir>/scripts/check-diagram-brief.cjs <brief.md>
   ```

5. **Gate batch work.** For two or more formal figures, a whole-article rewrite, or a user-specified style, deliver one representative diagram and one complete prose section first. Wait for approval unless the user explicitly waives the gate. Invoking this skill is not the same as following its gates.
6. **Build, render, and inspect.** Build the source with the route's generator (below), export, run the checks, and inspect at page width and 100%. Never overwrite a manually edited or existing authoritative source: publish a `.generated` or `.generated-vN` candidate instead.
7. **Publish and verify.** Embed the rendered image, link the editable source, update required documentation indexes if they exist, and verify UTF-8, links, Git state, and temporary cleanup when relevant.

## Building the source

One figure answers **one learning question**. Never ship a figure that only crops another — change the viewpoint (ownership vs layout vs timing vs data structure), or merge it.

### Default route — `scripts/drawiokit.py`

```python
from drawiokit import Sheet, Card
sheet = Sheet("init-flow",
              title="NCCL 初始化：三步建场",
              subtitle="学习问题：一次 comm 建立要经过谁？")   # the figure's one question
first = Card("bootstrapInit", [
    ("body", "交换 rank 地址"),
    ("source", "bootstrap.cc:412"),      # grey evidence anchor
    ("failure", "失败: 网络不可达"),      # red exit
], step="①", tone="input")
second = Card("initTransportsRank", [
    ("heading", "探测阶段"),              # bold sub-heading
    ("code", "ncclTransportP2pSetup()"), # monospace signature
], step="②", badge="最耗时", status="后续 comm 全靠它")
sheet.row([first, second])           # the author places the cards; the kit sizes them
sheet.connect(first, second, label="peer 地址表")
sheet.legend()                       # only the tones and line styles this figure uses
sheet.save("figure.drawio")          # raises on any violation
```

A body line is `("kind", text)` with kind in `body | heading | code | source | failure`, or a plain string for `body`. `step` and `badge` render as pills; `status` sits below a divider at the card's foot.

For a layered figure, use `sheet.lane("UMD", [...], subtitle="用户态运行时", tone=...)` instead of `row`. Each lane is a native Draw.io swimlane whose cards are its children, so dragging a lane takes its layer with it. Lanes and bare rows cannot be mixed in one sheet — half the cards would sit outside any layer. A connector that skips a lane is routed down a channel to the right of the content rather than through the lane it bypasses.

`save()` is a real gate. It refuses a sheet that would fail `lint-drawio-layout.py --strict`: font below the role minimum, a label wider than its cell, gaps or margins outside 40–80 px, a badge inside a card's corner arc, a connector routed through a card, a canvas too wide to read at page width, or an emoji-presentation codepoint. It does **not** auto-layout — rows and their order are yours, and a connection it cannot route cleanly raises instead of being drawn through a card.

The output leans on what Draw.io gives that an SVG cannot: cards are containers whose lines drag with them, connectors attach by card-relative anchors so the route survives the author's edits, each card carries its evidence (`data-evidence`, optional `link=` via `Card(link=...)`) where Edit Data can see it, and crossing connectors render as arcs. The sheet also carries `background`, which Draw.io turns into a light-dark pair on export, so the figure never renders dark text onto a dark page.

Then export and check:

```bash
node <skill-dir>/scripts/export-drawio.cjs --input figure.drawio --output-dir out --base-name figure
python3 <skill-dir>/scripts/lint-drawio-layout.py figure.drawio --strict
node <skill-dir>/scripts/lint-svg-text-overlap.cjs out/figure.drawio.svg
```

Draw.io produces the SVG channel; both PNGs are rasterised from it with sharp. Do not ask Draw.io's CLI for a scaled PNG (`-s`/`--width`): some builds exit 0 after printing `Empty export data` and write nothing.

### SVG route — `scripts/svgkit.py`

For the cases listed under "Format" above. It enforces at generation time and raises on any violation:

- text wider than the card's usable width
- baseline spacing ≥ 1.35·fs, hard floor 1.2·max(prev, cur)
- ≥ 10 px bottom clearance inside cards
- divider gaps 26 above / 48 below
- tables use zebra rows — row rules always violate the 16 px text clearance
- 14 px `userSpaceOnUse` markers; a short segment's marker ≤ 65 % of its length
- emoji-presentation codepoints

Call `measure()` for heights; it always counts the tag badge, so probe and draw cannot disagree. Whenever "compute size" and "draw element" are two pieces of code, they must share one function.

### Glyphs: the rule is presentation, not "symbols"

The font stack (`Noto Sans CJK SC`, `Microsoft YaHei`) has **no emoji font**, so any codepoint with `Emoji_Presentation=Yes` renders as tofu. Measured on this host:

| Safe (text presentation) | Broken (emoji presentation) |
|---|---|
| ⚠ U+26A0 · ★ U+2605 · ✓ U+2713 · ✗ U+2717 | ❌ U+274C · ✅ U+2705 |

Both generators block the broken class automatically. Incident: 17 ❌/✅ shipped inside one wiki figure and rendered as tofu boxes.

### Arrows are where correctness dies (SVG route)

**Never claim a diagram is correct from reading the SVG source.** Coordinates fool you — a path ending `…V268` reads "up" and renders "down". Render → look → fix, every time.

1. **Write the intent list first**: every arrow as `start-box → end-box (head lands on <side>)`, plus the layout. Put it in the SVG `<title>`/`<desc>` so it travels with the file.
2. **Never use `orient="auto-start-end"`** — resvg ignores it and draws the marker at 0°. On horizontal lines that looks fine by luck; on **vertical** lines the head stays horizontal and merges into the line. Always `orient="auto"`.
3. `marker-end` + `orient="auto"` points along the **last segment**. For an elbow path, the final leg decides the head direction.
4. `orient="auto"` does **not** reverse a `marker-start`. Define a separate reversed marker (`M10 0 L0 5 L10 10 z`, `refX≈1.5`).
5. Route feedback/back-edges on their own lane with a distinct marker colour.
6. **Write in layers, never by spatial region**: ① backgrounds → ② all connectors → ③ all node boxes → ④ text. Cross-region connectors always in layer ②, or an opaque panel drawn later hides a correctly-positioned line.

### Render

```bash
node <skill-dir>/scripts/render-png.mjs <in.svg|dir> [outDir]
```

Always **2x** and palette-optimised, both from measurement: 1x leaves 21–25 px body text soft, and palette quantisation took 19 figures from 29.8 MB to 11.1 MB (−63 %) with mean channel error 0.013/255. **sharp is primary, resvg is fallback only** — resvg resolved Latin to a serif face and, where a glyph was missing, rendered the following CJK run as boxes too; it also needs `fonts-noto-cjk` installed or all Chinese becomes □.

### Visual inspection is not optional

- Verify **each** arrow against the intent list, head by head. Crop and zoom every dense connector area — thumbnails hide breaks and confirmation bias fills them in. Ask "which line is broken, which box is orphaned", not "does it look right".
- For banded figures, re-render once with backgrounds at `fill-opacity="0.3"` to expose z-order occlusion.
- Check the legend describes arrows the figure actually **contains**.
- Text inside cards, no overlap; page-width comprehension and 100 % detail.
- Re-render after **every** source edit — editing the source without re-rendering leaves the old PNG in the page.

## Content Gates

- "Beginner-readable" means add context, inputs/outputs, and reasons; do not remove the technical backbone.
- Use three symbol levels:
  - **L1 system:** modules/layers; keep.
  - **L2 main entry:** main functions, ioctls, interfaces, packets; keep when needed and explain the role next to the name.
  - **L3 internals:** fields, helpers, local state, formulas; omit from the main learning diagram unless central to its question.
- Structure stage cards as: **problem -> input -> main action/function -> output -> why needed**.
- A panorama may cover the full path, but distinguish initialization, per-task execution, and completion feedback when they differ.
- Do not guess hidden RTL, address layout, timing, or side effects. Preserve the unknown explicitly.

For knowledge-sharing pages, whole-article diagram sets, or uncertain information density, read `references/content-quality.md` before drafting.

## Tool And Layout Routing

Read references only when needed:

| Condition | Read/use |
|---|---|
| Any Draw.io figure (the default route) | `references/drawio-quality-standard.md` |
| Multiple rendering tools are plausible | `references/tool-selection.md` |
| SVG/Mermaid/Graphviz has arrows, dense cards, titles, or collision risk | `references/layout-safety.md` |
| Knowledge-sharing, onboarding, batch figures, or style calibration | `references/content-quality.md` |

Default choices:

- Formal figure of any kind: `drawiokit.py` → `.drawio` source → export → strict lint → visual inspection.
- SVG asked for, or free coordinates required: `svgkit.py` → `.svg` → `render-png.mjs` → `lint-svg-text-overlap.cjs`.
- When both an SVG and a Draw.io source exist for one figure, use `compare-semantic-parity.cjs` where the roles are comparable.
- Existing SVG repair: keep the original SVG route and preserve its source and outputs.
- Dense deterministic graph: Graphviz DOT + SVG/PNG.
- Simple inline flow/sequence: Mermaid, unless rendered assets are required.
- Obsidian, Feishu/Lark, GitHub Wiki, or another publishing target: follow that target's local conventions when discoverable; otherwise keep source and rendered assets together with portable relative links.

Do not hard-code machine-specific attachment roots. If the target documentation tree already has an attachment convention, use it; otherwise create a nearby `assets/`, `images/`, or `_attachments/` directory scoped to the page or topic.

## Release Contract

- Default delivery: the editable `.drawio` source plus the PNG the page embeds. `.drawio.svg` is the export chain's intermediate, not a second authoritative source.
- SVG delivery, when the route was chosen for one of the reasons under "Format": the `.svg` source plus its PNG.
- A page that embeds a figure needs that PNG permanently. Deliver it; it is not a temporary validation export.
- Draw.io export requires a local Draw.io runtime; a missing runtime is a failure and must not silently produce another source format.
- Treat a hand-authored SVG and a Draw.io source as separate artifacts. Do not replace a hand-authored SVG with an exported Draw.io SVG.
- Do not overwrite existing authoritative or manually edited sources. Write `.generated` or `.generated-vN` candidates for comparison and manual merge.

For Markdown/wiki pages, embed PNG and link source nearby:

```markdown
![Readable alt text](../../../_attachments/path/diagram.drawio.png)

> Diagram source: [`diagram.drawio`](../../../_attachments/path/diagram.drawio)
```


## Verification

Run the relevant checks, including strict layout and visual inspection at page width and 100%:

```bash
python3 <skill-dir>/scripts/lint-drawio-layout.py path/to/diagram.drawio --strict
node <skill-dir>/scripts/export-drawio.cjs --input path/to/diagram.drawio --output-dir out --base-name diagram
node <skill-dir>/scripts/lint-svg-text-overlap.cjs out/diagram.drawio.svg   # and any hand-authored .svg
node <skill-dir>/scripts/lint-mermaid-layout.cjs path/to/diagram.mmd
node <skill-dir>/scripts/verify-wiki-diagrams.cjs page.md
```

On Windows use `scripts/export-drawio.ps1` in place of the export step.

Run the skill's own tests after changing any script:

```bash
node tests/components/test-lint-svg-text-overlap.cjs
python3 tests/drawio/test_lint_drawio_layout.py
python3 tests/drawio/test-drawiokit.py
```

When an SVG companion is available, also run `compare-semantic-parity.cjs` where the source roles are comparable. Automated checks do not replace visual inspection: verify arrow direction, text containment, connector clearance, page-width comprehension, and full-resolution detail.

When publishing a meaningful wiki or documentation change, update any discovered navigation/index/log files in that project. Report sources, files changed, visual inspection, UTF-8/link checks, and Git state when Git is in scope.
