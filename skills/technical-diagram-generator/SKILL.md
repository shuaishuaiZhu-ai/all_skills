---
name: technical-diagram-generator
description: Use when asked to 画图/出图解/改图/重画, for 图解, 知识图解, 流程图, 架构图, 时序图, flowcharts, architecture diagrams, wiki 配图, whiteboard-style explainers and diagram quality reviews; also when arrow directions or layout look wrong, when text overflows a card, when a figure needs an editable Draw.io/SVG source, or when a page's diagram links must be verified.
---

# Technical Diagram Generator

Produce audience-calibrated technical diagrams with source evidence, rendered output, and verified links. The skill is environment-neutral: use only tools available in the current runtime and do not assume a private vault, account, host, or publishing system.

For the learning document a figure belongs to — doc-type triage, evidence grading, `file:line` discipline — use `learning-doc-writer`.

## Format: Draw.io by default

Build a `.drawio` with `scripts/drawiokit.py` and export it. Draw.io gives the reader an editable source, and the strict linter checks its geometry before anything is rendered.

Use the SVG route (`scripts/svgkit.py`, see `references/svg-route.md`) only when the user asks for SVG or a hand-authored figure, or when the figure needs free coordinates Draw.io cards cannot express — memory/bit-field layouts, irregular topologies, cross-region swimlanes. Say so in the delivery. Both routes share `assets/layout-constants.json`, so a card sized on one route is sized the same way on the other.

## Portable Setup

- `<skill-dir>` is the directory containing this `SKILL.md`. Run scripts as `node <skill-dir>/scripts/<script>.cjs` or `python3 <skill-dir>/scripts/<script>.py`.
- In a clean skill directory run `npm ci`; do not rely on inherited `node_modules`.
- Draw.io export needs a local Draw.io runtime, found through `--drawio-executable` or `DRAWIO_EXECUTABLE`. A missing runtime is a failure, never a silent switch to another format. On Linux the exporter also needs `xvfb-run`; on Windows and macOS the same `node` script runs Draw.io directly.
- Keep generated assets inside the user's project, document or wiki. Follow the target's attachment convention when there is one; otherwise create a nearby `figures/`, `assets/` or `_attachments/` directory scoped to the page. Use ASCII filenames and portable relative links.

## Core Workflow

1. **Read sources.** Verify code, documents, artifacts or screenshots before drawing. Separate confirmed facts, inference and unverified behaviour; never invent hidden RTL, address layout, timing or side effects.
2. **Define the reader contract.** What the reader knows, the missing connection, what they must explain afterwards.
3. **Select information depth.** L1 system modules and L2 main entries stay; L3 internals (fields, helpers, local state, formulas) move to prose unless they are the learning point.
4. **Write a Diagram Brief** for a formal, complex, style-sensitive or multi-figure task: copy `assets/diagram-brief-template.md`, fill every field, run `node <skill-dir>/scripts/check-diagram-brief.cjs <brief.md>`.
5. **Gate batch work.** For two or more formal figures, a whole-article rewrite, or a user-specified style, deliver one representative figure and one complete prose section first and wait for approval unless the user waives the gate. A waiver is the user saying, in their own words, that no sample or style check is wanted; record it verbatim in the brief's `pilot_gate` field. Invoking this skill is not the same as following its gates.
6. **Build, export, inspect.** Generator → lint → export → look at the PNG at page width and at 100 %. Never overwrite a hand-edited or authoritative source; write a `.generated` / `.generated-vN` candidate.
7. **Publish and verify.** Embed the PNG, link the source next to it, update the page's indexes, run `verify-wiki-diagrams.cjs`.

## Building a figure with `drawiokit.py`

One figure answers **one learning question**. Never ship a figure that only crops another — change the viewpoint (ownership vs layout vs timing vs data structure) or merge.

```python
import sys; sys.path.insert(0, "<skill-dir>/scripts")
from drawiokit import Sheet, Card
sheet = Sheet("init-flow",
              title="NCCL 初始化：三步建场",
              subtitle="学习问题：一次 comm 建立要经过谁？")   # the one question
first = Card("bootstrapInit", [
    ("body", "交换 rank 地址"),
    ("source", "bootstrap.cc:412"),      # grey evidence anchor
    ("failure", "失败: 网络不可达"),      # red exit
], step="①", tone="input")
second = Card("initTransportsRank", [
    ("heading", "探测阶段"),              # bold sub-heading
    ("code", "ncclTransportP2pSetup()"), # monospace signature
], step="②", badge="最耗时", status="后续 comm 全靠它")
sheet.row([first, second])           # you place the cards; the kit sizes them
sheet.connect(first, second, label="peer 地址表")
sheet.legend()                       # only the tones and line styles this figure uses
sheet.save("figure.drawio")          # raises on any violation
```

A body line is `("kind", text)` with kind in `body | heading | code | source | failure`, or a plain string. `step` and `badge` render as pills; `status` sits below a divider at the card's foot. Tones: `input`, `process`, `output`, `feedback`, `unverified`.

`save()` is a real gate: it refuses anything `lint-drawio-layout.py --strict` would reject — font below the role minimum, a label wider than its cell, a badge in a corner arc, a connector through a card, a canvas wider than `maxAspectRatio`, an emoji-presentation codepoint — and on spacing it is deliberately tighter than the linter: `row(gap=)` and `Sheet(margin=)` accept only 40–80 px (the readable band), while `--strict` fails only below 32 px or above 120 px. It does **not** auto-layout.

**Know its routing limits before you design the figure** (measured on the kit, 2026-09-21). Cards live in rows. A connector between two cards of the same row needs a clear gutter between them — a card in between fails. A connector between rows goes out of the bottom edge, along the lane between the two rows, and in through the top edge, so it works only between **adjacent** rows; skipping a row fails because the vertical leg would cross the row in between. Within those rules fan-out (one card to several in the next row), fan-in, and a dashed back-edge between adjacent rows all route fine. A state machine with edges that skip rows is not drawable: put the transition table in prose and draw one typical path. The legend's tone labels are fixed (`feedback` reads "反馈 / 回程"); when a tone means something else in your figure, pass `sheet.legend(entries=[("tone", "feedback", "V8 削减的访问"), ...])`.

The output leans on what Draw.io gives that SVG cannot: cards are containers whose lines drag with them, connectors attach by card-relative anchors so the route survives edits, each card carries its evidence in Edit Data (`data-evidence`, `Card(link=...)`), crossing connectors render as arcs, and the sheet's `background` becomes a light-dark pair on export.

Then lint and export in one call (silent lint, one summary line from the export):

```bash
python3 <skill-dir>/scripts/lint-drawio-layout.py figure.drawio --strict && \
node <skill-dir>/scripts/export-drawio.cjs --input figure.drawio --output-dir figures --base-name figure --final-only
# [ok] figures/figure.drawio.png 2950x1446 renderer=drawio-png
```

`--final-only` is the delivery mode. It asks Draw.io for the PNG directly (`-f png -s 2 --size page --theme light`), then **proves** it before accepting it: the pixel size must equal page × 2 and the right and bottom edge bands must be background. Draw.io's direct PNG silently renders the content at the wrong scale once the output gets wide (measured: correct up to about 3000 px of output, content shifted and cut at 4390 px and above), so any PNG that fails the check is deleted and the figure is exported through the SVG channel instead (SVG to a scratch directory, rasterised with sharp, deleted). Either way the PNG is re-encoded in place as a palette image and the figure directory ends up with exactly `figure.drawio` + `figure.drawio.png`; the summary line says which path was taken (`renderer=drawio-png` or `renderer=svg` with `direct-png-rejected="…"`); `--json` prints the full record. Add `--lint-svg` to also run `lint-svg-text-overlap.cjs` on a scratch SVG. Without `--final-only` you get the legacy three-file layout (`.drawio.svg`, 3000 px `.png` preview, `.drawio.png`) in Draw.io's crop-to-diagram framing, which is what `compare-render-parity.cjs` consumes. Never run Draw.io's CLI for PNG by hand: without the exporter's flags it returns empty files, and without the check it returns wrong ones with a plausible size.

## Visual inspection is not optional — but it is the expensive step

Automated checks prove geometry, not meaning. Before delivering, open the PNG and check at page width and at 100 %: every arrow lands where the intent says, no connector or head touches text, text sits inside its card, the legend describes only what the figure contains, and the figure still answers its one question when scaled to column width. Re-export after **every** source edit; an edited source with a stale PNG is the most common shipped defect.

Reading an image costs on the order of a thousand tokens; every local check costs none. Spend accordingly:

- Run everything local first (`save()`, `--strict`, the exporter's overflow verification, `verify-wiki-diagrams.cjs`) and read the PNG **once**, after they all pass. Do not re-read a PNG whose source has not changed.
- Chain lint and export in one command; both stay silent or print one line, so the whole round trip is one tool call and one line of output. Ask for `--json` only when that line reports a rejection you need to debug.
- For a batch, build one contact sheet with `node <skill-dir>/scripts/make-contact-sheet.cjs <png-dir> sheet.png` and read that single image for completeness and layout; open an individual PNG only where the sheet shows a problem or text-level detail matters.
- Never let the model discover what a script could have: when a check is missing (a new failure class shows up in a PNG), add it to the exporter or the kit instead of remembering to look for it next time.

## Content Gates

- "Beginner-readable" means add context, inputs/outputs and reasons; do not remove the technical backbone.
- Stage cards read **problem → input → main action/function → output → why needed**.
- A panorama may cover the full path, but distinguish initialization, per-task execution and completion feedback when they differ.
- For knowledge-sharing pages, batch figures or uncertain density, read `references/content-quality.md` before drafting.

## References

| When | Read |
|---|---|
| Any Draw.io figure: roles, typography, spacing, export mechanics | `references/drawio-quality-standard.md` |
| SVG route: `svgkit.py`, arrows, glyphs, rendering, repairing an existing SVG | `references/svg-route.md` |
| Arrows, dense cards, subgraph titles, Mermaid/Graphviz collision risk | `references/layout-safety.md` |
| Choosing between Draw.io, SVG, Graphviz, Mermaid | `references/tool-selection.md` |
| Knowledge-sharing pages, onboarding, batch style calibration | `references/content-quality.md` |

## Release Contract

- Draw.io delivery: the `.drawio` source plus its `.drawio.png`, nothing else in the figure directory.
- SVG delivery: the `.svg` source plus its PNG.
- The PNG a page embeds is permanent, not a validation export. A hand-authored SVG and a Draw.io source are separate artifacts; never replace one with an export of the other.

```markdown
![Readable alt text](../../_attachments/path/diagram.drawio.png)

> Diagram source: [`diagram.drawio`](../../_attachments/path/diagram.drawio)
```

## Verification

```bash
python3 <skill-dir>/scripts/lint-drawio-layout.py path/to/diagram.drawio --strict
node <skill-dir>/scripts/export-drawio.cjs --input path/to/diagram.drawio --output-dir figures --base-name diagram --final-only
node <skill-dir>/scripts/lint-svg-text-overlap.cjs path/to/hand-authored.svg      # SVG route only
node <skill-dir>/scripts/lint-mermaid-layout.cjs path/to/diagram.mmd               # Mermaid only
node <skill-dir>/scripts/verify-wiki-diagrams.cjs page.md
```

After changing any script, run the skill's tests from `<skill-dir>`:

```bash
node tests/components/test-lint-svg-text-overlap.cjs
python3 tests/drawio/test_lint_drawio_layout.py
python3 tests/drawio/test-drawiokit.py
node tests/drawio/test-export-drawio.cjs                 # Draw.io and sharp stubbed
DRAWIO_EXECUTABLE=/path/to/drawio node tests/drawio/test-compare-render-parity.cjs   # real export; skips without Draw.io
```

When publishing, update the target project's navigation/index/log pages and report sources, files changed, what the visual inspection showed, link checks, and Git state when Git is in scope.
