---
name: technical-diagram-generator
description: Use when the user asks to generate, improve, compare, replace, or publish technical diagrams, 图解, 白板图解, Mermaid-to-image conversions, lark-whiteboard diagrams, Graphviz DOT diagrams, SVG/PNG wiki figures, diagram assets, or fix diagram issues such as arrows covering labels or text overlap.
---

# Technical Diagram Generator

Generate source-backed technical diagrams and land them in a durable form: editable source plus rendered image, with wiki links and post-write review.

## When To Use

Use this skill when the user asks for:

- “生成图解”, “详细图解”, “白板图解”, “优化图解”, or “把 Mermaid 换成图”.
- Converting wiki Mermaid blocks into rendered assets.
- Comparing diagram tools or producing Graphviz / SVG / lark-whiteboard outputs.
- Updating `C:\home\for_ai` Obsidian wiki pages with generated diagrams.
- Diagramming technical docs, MAS/FW concepts, route tables, register flows, topology, packet paths, or debug decision trees.

If the task writes a wiki page, also use `obsidian-technical-wiki-writer`. If it updates a real Lark/Feishu whiteboard, also use `lark-whiteboard`.

## Core Rules

1. Read the real source first. Diagrams must distinguish source-confirmed facts from inference.
2. Use Chinese labels by default; keep identifiers such as `NEP`, `BIST`, `port_id`, `gpu_id` in English.
3. Use ASCII filenames for generated assets. Chinese titles are fine in alt text and page text, but asset filenames should avoid encoding damage.
4. Preserve editability: save both source and rendered image.
   - Mermaid: `.mmd` + `.png`
   - Graphviz: `.dot` + `.svg` or `.png`
   - Hand-authored SVG: `.svg` + `.png` when PNG embedding is needed
   - lark-whiteboard output: original source plus exported `.svg` or `.png`
5. For wiki pages, embed the rendered image and link the source file nearby.
6. Arrows and connector lines must not cover text, group titles, or node labels. Treat every text block as an obstacle with padding.
7. Arrowheads must stay visually smaller than their connector segment. In SVG, avoid `markerUnits="strokeWidth"` for normal document arrows unless the effective marker size is checked. Keep rendered arrowheads at or below 24 px and below 65% of the landing segment length.
8. Text must be fully inside its node. For hand-authored SVG cards, keep at least 10 px internal padding below the lowest text baseline and above the title line; increase card height or reduce font size instead of letting text touch the border.
9. Layout every multi-line card label as one `text stack`: compute the whole group height first, then expand the card, reduce font size, split lines, or re-layout the stack. Never clamp one line's `y` coordinate independently.
10. Default line spacing: body baselines at least `1.35 * font-size` when laying out; linter hard floor `1.2 * maxFontSize`; title-to-body gap at least `1.15 * max(titleFont, bodyFont)`. After rendering, still visually review dense cards.
11. After every wiki write, review the changed page and touched `index` / `hot` / `log` files with UTF-8 reads. Do not trust PowerShell console rendering.

## Workflow

### 1. Define The Diagram Job

Identify:

- Source material: local doc, wiki page, screenshot, drawio, register table, code, or user URL mapped to a local extract.
- Target: standalone file, wiki page, or Lark whiteboard.
- Audience: learning explainer, debug checklist, architecture, route-table derivation, or tool comparison.
- Output expectation: quick answer image, wiki asset, SVG source, Graphviz DOT, or multiple variants.

If the user does not specify a location and the work belongs to the local Obsidian wiki, use the root-vault attachment tree:

```text
C:\home\for_ai\_attachments\<domain>\<topic>\...
```

This workspace uses `C:\home\for_ai` as the Obsidian vault root. Do not place wiki assets under `C:\home\for_ai\wiki\_attachments` unless the user explicitly changes the active vault root.
Use stable ASCII slugs, for example:

```text
c2c-loopback-soc-vs-bist.svg
c2c-loopback-soc-vs-bist.png
portmap-g5-first-hop.dot
```

### 2. Choose The Tool

Use this short decision table first. For more detail, read `references/tool-selection.md`.
For connector/text collision prevention, read `references/layout-safety.md` before drawing or repairing any image where arrows, labels, or group titles are involved.

| Need | Preferred output |
|---|---|
| Learning / whiteboard-style explainer | lark-whiteboard-style SVG/PNG or hand-authored SVG/PNG |
| Deterministic graph with many nodes/edges | Graphviz DOT + SVG/PNG |
| Simple inline flow or sequence in Markdown | Mermaid, unless user asked for rendered assets |
| Wiki page where rendering reliability matters | PNG embed + source link |
| Later quick edits by text | SVG, DOT, or Mermaid source preserved next to PNG |
| Tool comparison | Generate comparable variants with same content and note strengths/limits |

Current preference for this workspace: lark-whiteboard SVG/PNG and Graphviz DOT are usually best for C2C/portmap learning diagrams. Do not use Excalidraw or tldraw unless the user explicitly asks.

If the diagram has a top source fanning out into titled Mermaid subgraphs, do not trust Mermaid layout by default. This pattern can route arrowheads through subgraph titles, as seen in the `grace-usart-console-cli` USART address map. Run `scripts/lint-mermaid-layout.cjs` on the `.mmd`; if it flags risk, redesign with safer anchors or switch to hand-authored SVG / Graphviz.

### 3. Design The Diagram

Keep one diagram focused on one learning point. Prefer:

- Left-to-right data paths.
- Top-to-bottom decision trees.
- Group boxes for layers such as `SoC`, `Adapter`, `LLRMAC`, `PHY`, `Remote DUT`.
- Color only to encode meaning: source, route, loopback, error, inferred path.
- Short node labels. Put long explanations in the surrounding wiki text or a small legend.
- Route connectors through whitespace gutters. Do not route through text baselines or title bands.
- Arrowheads must land on a node border or an empty anchor area, never on the first line of a label.
- For short vertical transitions between stacked nodes, leave enough gap for both line and arrowhead. Do not use a 25-30 px segment with a large marker; it turns into a solid triangle and hides the line.
- For multi-line card labels, compute the last line baseline before drawing. If the baseline plus descender allowance reaches the rectangle bottom, make the card taller or move text upward.
- Treat a card title and body as one text stack. Preserve the original first baseline when repairing existing SVGs if top padding is still safe, then move later lines as a group and expand the card bottom as needed.
- Do not fix overflow by pushing only the final line upward; that creates baseline collisions that can pass older inside-rect checks.

For technical diagrams, include one of these anchors:

- Data/control direction arrows.
- Numbered sequence steps.
- Boundary labels such as “source-confirmed” / “inferred”.
- Debug decision outcome such as “suspect adapter” / “suspect PHY BIST”.

Before generating, mark these no-connector zones:

- every node label and multiline text block,
- every subgraph/group title such as `CP User`, `IMC`, `CP Master`,
- every legend and source note,
- table/header bands.

Keep at least 16 px clearance from these zones; use 24 px for large labels or arrowheads.

### 4. Generate Assets

Create assets under the target attachment folder. Preserve source files.

For manual SVG generation:

- Use stable canvas dimensions and responsive text layout.
- Use `scripts/svg-card-layout.cjs` for card text stacks when hand-authoring or repairing SVGs. It returns line baselines and required card height before anything is rendered.
- Avoid tiny text, overlapping labels, and decorative gradients.
- Define compact arrow markers, for example `markerWidth="8" markerHeight="8"` with `markerUnits="userSpaceOnUse"` or an equivalent hand-sized marker. Avoid `markerUnits="strokeWidth"` with marker sizes above 8 on normal 2-3 px strokes.
- Prefer simple rectangles, arrows, swimlanes, and legends.
- Draw connectors on a separate layer behind nodes, but do not rely on layering to hide a bad route. The route itself must avoid text.
- Use explicit waypoints around text boxes and group title bands.
- Render or inspect the PNG/SVG before linking it.

For Graphviz:

- Keep `.dot` source readable.
- Use `rankdir=LR` for path/routing diagrams and `rankdir=TB` for decision trees.
- Use clusters for hardware layers or device boundaries.
- Increase cluster `margin`, `nodesep`, and `ranksep` when arrows or edges are close to labels.

For lark-whiteboard:

- Use the `lark-whiteboard` skill for CLI details.
- Use dry-run before overwriting existing whiteboards.
- Export a preview image when the user needs to view the result outside Lark.

For Mermaid:

- Run `scripts/lint-mermaid-layout.cjs <file.mmd>` before rendering when the graph has subgraphs.
- Avoid direct external-to-subgraph-member edges in `TB` / `TD` diagrams. They often cross the subgraph title.
- If the linter flags this pattern, fix by changing to `LR`, adding explicit safe entry anchors away from titles, or replacing with SVG/Graphviz where connector coordinates can be controlled.

### 5. Update Wiki

When replacing a Mermaid block in a wiki page:

```markdown
![Readable alt text](../../../_attachments/path/to/diagram.png)

> 图解源文件：[`diagram.svg`](../../../_attachments/path/to/diagram.svg)。
```

If the source is `.dot` or `.mmd`, link that source file instead.

For meaningful wiki changes, update the relevant domain index plus:

```text
C:\home\for_ai\wiki\index.md
C:\home\for_ai\wiki\hot.md
C:\home\for_ai\wiki\log.md
```

### 6. Verify

Run the bundled verifier on every changed Markdown file. It also checks whether local image links escape the nearest `.obsidian` vault root, because Obsidian can fail to display files outside a sub-vault even when the filesystem path exists:

```powershell
node <skill-dir>\scripts\verify-wiki-diagrams.cjs `
  path\to\wiki-page.md `
  C:\home\for_ai\wiki\fw\interconnect\index.md `
  C:\home\for_ai\wiki\hot.md `
  C:\home\for_ai\wiki\log.md
```

Also inspect representative rendered images when visual correctness matters:

- no blank image,
- no text overlap,
- no arrow or arrowhead covering text, initials, group titles, or label baselines,
- no missing arrows,
- no wrong direction,
- image matches the surrounding explanation.

Run layout-specific checks when relevant:

```powershell
node <skill-dir>\scripts\lint-mermaid-layout.cjs path\to\diagram.mmd
node <skill-dir>\scripts\lint-svg-text-overlap.cjs path\to\diagram.svg
```

For SVG repair or batch replacement, run `scripts/lint-svg-text-overlap.cjs` after rendering. It checks card line spacing with approximate glyph boxes (`top = y - 0.9 * fontSize`, `bottom = y + 0.28 * fontSize`) and fails on more than 4 px overlap or too-small baseline gaps.

For batch tasks, render a contact sheet and visually inspect small cards, bottom notes, title/body transitions, and labels near connectors.

## Report Back

In the final response, state:

- what sources were used,
- which diagram assets were created or updated,
- which wiki files were changed,
- verification results: UTF-8/mojibake scan, image path check, and any visual inspection boundary.
