# Draw.io Quality Standard

This is the strict quality contract for an explicit Draw.io or `both` request; Draw.io is not the release default. Keep the `.drawio` source editable and compare its exported SVG/PNG channels for render parity.

If an authoritative or manually edited `.drawio` exists, never overwrite it. Produce a `.generated.drawio` or `.generated-vN.drawio` candidate and merge manually. A passing automated gate leaves an immutable `visual-pending` quality report. Record page-width and 100% review in the content-addressed review receipt; only a `ready` receipt bound to the unchanged report and authored artifacts is releasable.

## Machine-readable roles

Every relevant Draw.io cell uses one role tag in its style or metadata:

- `role=title`
- `role=badge`
- `role=body`
- `role=divider`
- `role=status`
- `role=note`
- `role=connector`
- `role=legend`
- `role=table`

Tags are stable ASCII values and must not be inferred from display text.

## Typography and spacing

- Body font is at least 18 pt.
- Badge, status, and note text is at least 16 pt.
- Dense-table text is at least 14 pt.
- Normal related-element gaps are 40–80 px. Strict checks fail below 32 px or above 120 px.
- Outer margins are 40–80 px from visible content to the canvas edge.
- Rounded cards use arc size 12–16. Compact tables may use straight cells as the explicit exception.
- Inset badges and framed notes inside rounded cards or panels keep at least 32 px of local padding from every parent edge. Never place them in a rounded-corner arc or on top of the parent outline.
- A label must fit inside its own cell. Draw.io stores the label as a cell property, so an oversized label renders past the outline without changing any geometry and no bounds check can see it. `E_TEXT_OVERFLOW` estimates the advance width from the font size (full-width/CJK about 1.0 em, other glyphs 0.55 em, monospace 0.60 em) and reports two axes:
  - `axis=horizontal` when the cell has no `whiteSpace=wrap` and a single line exceeds the usable width;
  - `axis=vertical` when `whiteSpace=wrap` is set and the wrapped rows exceed the usable height at 1.2 em per row.

  Cells with a usable height under 12 px are treated as geometry defects owned by the bounds and status-order checks, not as text-fit defects. This finding is deliberately **not** auto-reflowable: fix it by widening the cell, reducing the font size, shortening the text, or enabling wrap.

## Card and connector structure

- A card follows title → body → divider → status/note when those elements are present.
- Status is below the divider, never above it or mixed into the title band.
- Connectors use orthogonal routes and dedicated gutters around cards.
- No connector line or arrowhead may pass through readable text, including titles, values, legends, or notes.
- A connector with its own label uses an explicit perpendicular `mxGeometry y` offset of at least 16 px. A label background does not make a zero-offset label valid.

## Canvas and render checks

- Fit the canvas to the content while retaining the outer margins; do not crop visible strokes or arrowheads.
- Fail excessive whitespace when the canvas is materially larger than the content without a deliberate panorama or breathing-room rationale.
- Render a 3000 px preview and the final embedded PNG at `scale 2`.
- Compare SVG and PNG for content, direction, labels, and connector parity.
- Visually inspect at page width and 100%; automated checks do not replace visual inspection.
