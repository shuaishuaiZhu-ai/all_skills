---
name: svg-diagrams
description: Use when creating or editing SVG diagrams — flowcharts, arrow/relationship diagrams, architecture pictures. Enforces a render-and-visually-verify loop so arrow directions and layout are correct, and produces publish-ready PNGs. Trigger on tasks like "draw a diagram", "fix this diagram's arrows", "make an SVG flowchart", or verifying that a diagram matches its intended meaning.
---

# SVG Diagrams — author + verify

Hand-authored SVG looks great but is **error-prone for arrows**: you cannot tell from
the source whether an arrow points the right way. The only reliable check is to **render
the SVG to a PNG and look at it.** This skill makes that loop mandatory.

## The non-negotiable rule

**Never claim a diagram is correct from reading the SVG source.** Reading coordinates
fools you (a `…V268` final segment looks like "up" but renders "down"). Render → look →
fix. Every time.

## Workflow

1. **Write the intent list first.** Before drawing (or before fixing), list every arrow
   as `start-box → end-box (head lands on end-box's <side>)`, plus the overall layout
   (columns/rows/loops). Put it in the SVG `<title>`/`<desc>` so it travels with the file.

2. **Author the SVG** (conventions below).

3. **Render to PNG:**
   ```bash
   node ~/.claude/skills/svg-diagrams/scripts/render.mjs in.svg out.png 2
   # whole folder:
   ~/.claude/skills/svg-diagrams/scripts/render-all.sh <dir> 2
   ```

4. **Read the PNG (vision) and verify, arrow by arrow**, against the intent list:
   - Does each arrowhead sit on the intended destination box?
   - Does it point the intended way (forward vs. feedback/back-edge)?
   - Bidirectional arrows: heads on **both** ends?
   - Also check: text overflow / clipping, boxes overlap, legibility, CJK renders (not □).

5. **Mismatch → edit SVG → re-render → re-verify.** Loop until every arrow passes. Only
   then is the diagram done; the verified PNG is the publish artifact.

## Arrow mechanics (where direction bugs come from)

- **🔴 NEVER use `orient="auto-start-end"` — resvg ignores it and renders the marker at 0°
  (pointing right).** On horizontal lines that looks fine by coincidence; on **vertical**
  lines the arrowhead stays horizontal and **merges into the line** (a head that should
  point ↓/↑ ends up pointing →). This bit this very tutorial: 6 diagrams had vertical heads
  silently rendering horizontal. **Always use `orient="auto"`** — it rotates correctly in
  both resvg and browsers.
- `marker-end` + `orient="auto"`: the head points along the **last segment** of the path.
  For an elbow/feedback path like `M.. V.. H.. V..`, the head direction is set by the
  **final** `V`/`H` leg — make that last leg point at the true destination box.
- **Bidirectional / start markers**: `orient="auto"` does NOT reverse a `marker-start`
  (it would point forward, into the line). Define a **separate reversed marker** whose
  triangle points the other way (`<path d="M10 0 L0 5 L10 10 z">`, `refX≈1.5`,
  `orient="auto"`) and use it for `marker-start`. Do not rely on `auto-start-end`.
- Feedback / back-edges: route them on a separate y-lane and give them a distinct marker
  color (see `arr`) so they read as "loops back", not "forward".
- **This class of bug is invisible in the source and easy to rationalize away when
  glancing at the render. Verify each vertical arrow's head against the intent list, head
  by head — do not eyeball the whole picture and assume.**

## House style (default template — keep diagrams consistent)

- Canvas: `viewBox="0 0 1180 H"`, rounded base plate `rect rx=28 fill=#f6f8fa`.
- Markers (in `<defs>`):
  - `ar`  forward — fill `#8da2ad` (gray)
  - `arr` feedback/back — fill `#e0a3a3` (coral), with the line `stroke-dasharray:7 7`
  - `arg` accent — fill `#b08b2e` (gold)
  - forward shape `M0 0 L10 5 L0 10 z`, `refX≈8.5 refY=5 markerWidth/Height≈7 orient="auto"`.
  - reversed (for `marker-start`): `M10 0 L0 5 L10 10 z`, `refX≈1.5`, `orient="auto"`.
- Lines: `stroke-width:2.4; fill:none; stroke-linecap:round`.
- Box fills/strokes: green `#e8f7ec/#74c98a`, blue `#e8f1fd/#6fa8e6`, teal `#e6fffa/#68d8c2`,
  amber `#fff8e6/#edc870`, violet `#f0ecfb/#a98fe0`, dark `#102027`.
- Fonts: `ui-sans-serif, system-ui, sans-serif`. **CJK**: the renderer needs CJK fonts
  installed (`fonts-noto-cjk`), or Chinese renders as boxes. Always confirm in the PNG.

## Renderer setup

- Engine: `@resvg/resvg-js` (no browser, offline once installed). Installed locally in this
  skill dir. Fallback: `sharp`. Reinstall: `cd ~/.claude/skills/svg-diagrams && npm i @resvg/resvg-js`.
- CJK fonts: `apt-get install -y fonts-noto-cjk` (resvg auto-loads system fonts). Without
  them, Latin renders but Chinese shows as □ — the PNG is not publishable.
- If no renderer can be installed locally, render on a machine that has one; the verify
  step is the point — don't skip it.
