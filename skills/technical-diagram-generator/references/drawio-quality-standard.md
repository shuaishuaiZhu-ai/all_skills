# Draw.io Quality Standard

This is the strict quality contract for the default figure route. Keep the `.drawio` source editable; the exported `.drawio.png` is the only other deliverable.

Build the source with `scripts/drawiokit.py`, which enforces every threshold on this page at generation time — a sheet it saves passes `lint-drawio-layout.py --strict`. Hand-editing a `.drawio` afterwards is allowed; re-run the linter when you do.

If an authoritative or manually edited `.drawio` exists, never overwrite it. Produce a `.generated.drawio` or `.generated-vN.drawio` candidate and merge manually. A passing automated gate is not a release: record the page-width and 100% visual review in the delivery message.

## Machine-readable roles

Every relevant Draw.io cell uses one role tag in its style or metadata:

- `role=title`
- `role=badge` — also the step-number and label pills
- `role=body`
- `role=heading` / `role=code` / `role=source` / `role=failure` — the typed body lines: a bold sub-heading, a monospace signature, the grey evidence anchor, the red exit
- `role=figure-question` — the learning question under the figure title
- `role=divider`
- `role=status`
- `role=note`
- `role=connector`
- `role=legend-swatch` / `role=legend-label` — deliberately **not** `legend` or `note`: the gap checks only apply to `ANCHOR_ROLES`, and a legend swatch beside its label is not a layout defect
- `role=table`

Tags are stable ASCII values and must not be inferred from display text.

The page itself carries `background` on `mxGraphModel`. Draw.io reads it on export and emits a `light-dark()` pair, so the figure has a ground in both themes; a transparent canvas puts dark text on a dark page. Do not model the background as a cell — it would overlap every card and fail `E_OVERLAP`.

## Typography and spacing

- Body font is at least 18 pt.
- Badge, status, note, and the typed body lines (`heading`, `code`, `source`, `failure`) are at least 16 pt.
- Dense-table text is at least 14 pt.
- A connector label needs no background plate. A plate hugs the glyphs, leaving none of the 10 px a label needs inside its own box; the perpendicular offset already keeps the label off the line.
- Normal related-element gaps and outer margins are 40–80 px, and `drawiokit.py` accepts only that band. The linter is looser on purpose so hand-edited files are not rejected for a few pixels: `--strict` fails below 32 px or above 120 px.
- Outer margins are 40–80 px from visible content to the canvas edge.
- Rounded cards use arc size 12–16. Compact tables may use straight cells as the explicit exception.
- `fontFamily` must name a CJK-capable face (`Noto Sans CJK SC`, `Microsoft YaHei`). A bare `Arial` leaves every Chinese glyph to the renderer's substitution. Draw.io splits a style string on `;`, so a font stack may only be comma-separated.
- The advance-width numbers above live in `assets/layout-constants.json` and are read by the linter and both generators. Change them there, not in one consumer.
- Inset badges and framed notes inside rounded cards or panels keep at least 32 px of local padding from every parent edge. Never place them in a rounded-corner arc or on top of the parent outline.
- A label must fit inside its own cell. Draw.io stores the label as a cell property, so an oversized label renders past the outline without changing any geometry and no bounds check can see it. `E_TEXT_OVERFLOW` estimates the advance width from the font size (full-width/CJK about 1.0 em, other glyphs 0.55 em, monospace 0.60 em) and reports two axes:
  - `axis=horizontal` when the cell has no `whiteSpace=wrap` and a single line exceeds the usable width;
  - `axis=vertical` when `whiteSpace=wrap` is set and the wrapped rows exceed the usable height at 1.2 em per row.

  Cells with a usable height under 12 px are treated as geometry defects owned by the bounds and status-order checks, not as text-fit defects. This finding is deliberately **not** auto-reflowable: fix it by widening the cell, reducing the font size, shortening the text, or enabling wrap.

## Card and connector structure

- A card follows title → body → divider → status/note when those elements are present.
- Status is below the divider, never above it or mixed into the title band.
- Connectors use orthogonal routes and dedicated gutters around cards.
- Connectors attach by **card-relative anchors** (`exitX/exitY`, `entryX/entryY`), not absolute waypoints. Waypoints freeze a route that the author's first edit invalidates: measured on the same figure, moving one card left an anchored connector outside every card, while the frozen one cut through a card and dropped its label on that card's text. Generators should still compute the expected path and check it at generation time — the check is what waypoints were buying.
- Cards are containers (`container=1;collapsible=0`) so their lines drag with them, and carry their provenance in an `<object>` wrapper (`data-evidence`, optional `link`, `tooltip`) where Draw.io's Edit Data dialog can see it.
- `jumpStyle=arc` so two crossing connectors read as crossing rather than joining.
- No connector line or arrowhead may pass through readable text, including titles, values, legends, or notes.
- A connector with its own label uses an explicit perpendicular `mxGeometry y` offset of at least 16 px. A label background does not make a zero-offset label valid.

## Canvas and render checks

- Fit the canvas to the content while retaining the outer margins; do not crop visible strokes or arrowheads.
- Fail excessive whitespace when the canvas is materially larger than the content without a deliberate panorama or breathing-room rationale.
- Keep the page's width:height ratio at or under `maxAspectRatio` (4). A wider strip is scaled to illegibility the moment a page embeds it at column width; split the cards across more rows.
- Render the final embedded PNG at scale 2. `export-drawio.cjs --final-only` asks Draw.io for it directly (`-f png -s 2 --size page --theme light`) and accepts it only after verifying that the size equals page × 2 and that the right and bottom 8 px bands are background; otherwise it deletes the PNG and exports through the SVG channel (scratch SVG → sharp → delete) with the same `--size page` framing. Both paths re-encode the PNG in place as a palette image, so the figure directory holds only `.drawio` + `.drawio.png`; `--lint-svg` additionally lints a scratch SVG. Without the flag the script exports a crop-to-diagram SVG, rasterises a 3000 px `.png` preview and the 2x `.drawio.png` from it, and keeps the `.drawio.svg`. All PNGs carry the sheet's opaque `background`.

  Why the check exists (Draw.io 31.1.8 / Ubuntu 22.04 / xvfb, measured 2026-09-21): Draw.io rasterises PNG by screenshotting a hidden window (`capturePage`) rather than rendering to a canvas. With `--use-angle=swiftshader` it no longer returns empty files, but past a size ceiling it renders the content at a larger scale than the canvas and cuts it at the edge while exiting 0 with plausible dimensions — `--size page -s 2` was pixel-correct for pages up to about 1500 px wide (3000 px output) and wrong for a 2925 px page (5852 px output) and a 3672 px page; `--width N` above about 4000 even returned wrong heights. Enlarging the Xvfb screen does not change this. Content overflowing the page always erases the right or bottom margin, which is what the edge-band check detects. `-f svg` has no such ceiling, which is why the vector channel remains the fallback.
- Only when a figure has both an SVG and a PNG channel (legacy export without `--final-only`, or a hand-authored SVG companion): compare them for content, direction, labels, and connector parity with `compare-render-parity.cjs`.
- Visually inspect at page width and 100%; automated checks do not replace visual inspection.
