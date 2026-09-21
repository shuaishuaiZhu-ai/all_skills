# SVG Route

Read this when a figure is built with `scripts/svgkit.py`, when an existing hand-authored `.svg` is repaired, or when an SVG must be rasterised. The Draw.io route (`drawiokit.py`) is the default; use SVG only when the user asks for it or the figure needs free coordinates Draw.io cards cannot express — memory/bit-field layouts, irregular topologies, cross-region swimlanes. State the switch in the delivery.

## `svgkit.py` — what it enforces at generation time

It raises on any violation, so a saved SVG already satisfies:

- text no wider than the card's usable width;
- baseline spacing ≥ 1.35·fs, hard floor 1.2·max(prev, cur);
- ≥ 10 px bottom clearance inside cards;
- divider gaps 26 above / 48 below;
- tables use zebra rows — row rules always violate the 16 px text clearance;
- 14 px `userSpaceOnUse` markers; a short segment's marker ≤ 65 % of its length;
- no emoji-presentation codepoints (see below).

Call `measure()` for heights; it always counts the tag badge, so probe and draw cannot disagree. Whenever "compute size" and "draw element" are two pieces of code, they must share one function. The numbers come from `assets/layout-constants.json`, shared with the Draw.io route and both linters.

## Glyphs: the rule is presentation, not "symbols"

The font stack (`Noto Sans CJK SC`, `Microsoft YaHei`) has **no emoji font**, so any codepoint with `Emoji_Presentation=Yes` renders as tofu. Measured on this host:

| Safe (text presentation) | Broken (emoji presentation) |
|---|---|
| ⚠ U+26A0 · ★ U+2605 · ✓ U+2713 · ✗ U+2717 | ❌ U+274C · ✅ U+2705 |

Both generators block the broken class automatically. Incident: 17 ❌/✅ shipped inside one wiki figure and rendered as tofu boxes.

## Arrows are where correctness dies

**Never claim a diagram is correct from reading the SVG source.** Coordinates fool you — a path ending `…V268` reads "up" and renders "down". Render → look → fix, every time.

1. **Write the intent list first**: every arrow as `start-box → end-box (head lands on <side>)`, plus the layout. Put it in the SVG `<title>`/`<desc>` so it travels with the file.
2. **Never use `orient="auto-start-end"`** — resvg ignores it and draws the marker at 0°. On horizontal lines that looks fine by luck; on **vertical** lines the head stays horizontal and merges into the line. Always `orient="auto"`.
3. `marker-end` + `orient="auto"` points along the **last segment**. For an elbow path, the final leg decides the head direction.
4. `orient="auto"` does **not** reverse a `marker-start`. Define a separate reversed marker (`M10 0 L0 5 L10 10 z`, `refX≈1.5`).
5. Route feedback/back-edges on their own lane with a distinct marker colour.
6. **Write in layers, never by spatial region**: ① backgrounds → ② all connectors → ③ all node boxes → ④ text. Cross-region connectors always in layer ②, or an opaque panel drawn later hides a correctly-positioned line.

## Render

```bash
node <skill-dir>/scripts/render-png.mjs <in.svg|dir> [outDir]
node <skill-dir>/scripts/lint-svg-text-overlap.cjs <in.svg>
```

Always **2x** and palette-optimised, both from measurement: 1x leaves 21–25 px body text soft, and palette quantisation took 19 figures from 29.8 MB to 11.1 MB (−63 %) with mean channel error 0.013/255. **sharp is primary, resvg is fallback only** — resvg resolved Latin to a serif face and, where a glyph was missing, rendered the following CJK run as boxes too; it also needs `fonts-noto-cjk` installed or all Chinese becomes □.

## Repairing an existing SVG

Keep the original SVG route and preserve its source and outputs. For text stacks whose baselines collided (the classic last-line-only clamp), `scripts/repair-svg-text-stacks.cjs <out-dir> <diagram.svg>...` re-lays every card's text stack with the shared `svg-card-layout.cjs` rules and writes the repaired copy to `<out-dir>`; diff, re-render, lint, then replace the original by hand. Never overwrite a hand-edited SVG in place.

## Visual inspection specifics for SVG

- Verify **each** arrow against the intent list, head by head. Crop and zoom every dense connector area — thumbnails hide breaks and confirmation bias fills them in.
- For banded figures, re-render once with backgrounds at `fill-opacity="0.3"` to expose z-order occlusion.
- Check the legend describes arrows the figure actually **contains**.
- Re-render after **every** source edit — editing the source without re-rendering leaves the old PNG in the page.
