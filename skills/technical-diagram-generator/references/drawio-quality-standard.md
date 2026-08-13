# Draw.io Quality Standard

This is the strict quality contract for the default figure route. Keep the `.drawio` source editable and compare its exported SVG/PNG channels for render parity.

Build the source with `scripts/drawiokit.py`, which enforces every threshold on this page at generation time — a sheet it saves passes `lint-drawio-layout.py --strict`. Hand-editing a `.drawio` afterwards is allowed; re-run the linter when you do.

If an authoritative or manually edited `.drawio` exists, never overwrite it. Produce a `.generated.drawio` or `.generated-vN.drawio` candidate and merge manually. A passing automated gate leaves an immutable `visual-pending` quality report. Record page-width and 100% review in the content-addressed review receipt; only a `ready` receipt bound to the unchanged report and authored artifacts is releasable.

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
- Normal related-element gaps are 40–80 px. Strict checks fail below 32 px or above 120 px.
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
- Render a 3000 px preview and the final embedded PNG at scale 2 — but produce both from the exported SVG with sharp, not from Draw.io's CLI. `export-drawio.cjs` already does this; the PNGs are flattened onto white so a dark-mode page cannot put dark text on a dark plate.

  Why, measured on Draw.io 31.1.8 / Ubuntu 22.04 / xvfb: Draw.io rasterises PNG by screenshotting a hidden window (`capturePage`), not by rendering to a canvas — its own source carries a `TODO Use canvas to export images ... (no capturePage)` and a comment calling the fixed capture delay "not a stable solution". Two failures follow from that:
  - the window is created with `offscreen: { deviceScaleFactor: 2 }`, and under `--disable-gpu` that surface never yields a frame for a scaled export, so `-f png -s 2` writes nothing. `--use-angle=swiftshader` keeps rendering on the CPU while giving ANGLE a working GL path and fixes this class.
  - a size ceiling remains at roughly 1500 px of output: `--width 1500` and `-s 2` succeed, `--width 1800` and `-s 4` return `Empty export data` (exit 1), and enlarging the xvfb screen does not move the line.

  `-f svg` is unaffected by both, which is why the vector channel is the one Draw.io produces.
- Compare SVG and PNG for content, direction, labels, and connector parity.
- Visually inspect at page width and 100%; automated checks do not replace visual inspection.
