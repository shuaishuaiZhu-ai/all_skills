---
name: diagram-authoring
description: Hand-author and verify technical diagrams (图解/知识图解/流程图/架构图/时序图) and the deep learning documents they belong to — wiki 配图, porting-grade walkthroughs, QA/问答 pages. Use when asked to 画图/出图解/改图/重画, when arrow directions or layout look wrong in an SVG, when text overflows a card, or when writing/revising 学习文档、深度长文、问答页、技术讲解. Owns the svgkit generator with generation-time layout assertions, the render-and-look verification loop, doc-type triage, evidence grading, and file:line citation discipline. For Draw.io sources, spec-driven standard components, or the formal release quality gate, use technical-diagram-generator instead.
---

# Diagram Authoring

Hand-authored SVG diagrams that are correct by construction, and the learning documents they illustrate.

**Merged 2026-08-12** from `learning-doc-writer` (doc standard + `svgkit.py`) and `svg-diagrams` (arrow-verification loop + renderer pitfalls). Both originals are retired; this is the single source.

Full written standard (reasoning, worked examples, incident records):
`/root/workspace/wiki/wiki/ai/tools/learning-doc-writing-standard.md`

## Which skill to use

| Task | Skill |
|---|---|
| Hand-authored SVG for a wiki/learning page; fix arrows or overflow; write the doc around it | **this one** |
| Draw.io source (`--format drawio`/`both`), spec-driven standard components, quality gate + review receipt, render/semantic parity | `technical-diagram-generator` |

They share the Brief template and the SVG/wiki linters — call those from `technical-diagram-generator/scripts/`.

## Step 1 — Triage the doc type FIRST

| Type | Goal | Depth floor |
|---|---|---|
| A. Porting-grade长文 | reader can rewrite an equivalent implementation | **byte/bit level**: offsets, widths, alignment, magic values, derivations |
| B. End-to-end walkthrough | reader can narrate one full path | main functions + key struct fields |
| C. QA page | resolve one specific question | as deep as the question; state boundaries |
| D. Index/nav | route in 30 s | one-line locators only — never copy body text |
| E. Standard/spec | next person avoids the trap | every rule gets a "why" + a real incident |

Ask: *what must the reader be able to DO afterwards?* Type A implies **format specs**, not just call chains — function names can be copied from source, byte layouts cannot.

## Step 2 — Evidence model before writing

`read real sources → record evidence + unknowns → fix conclusions → design layout → draw`

| Claim | Source | Status | Assertable? |
|---|---|---|---|
| calls, field assignments | source snapshot (record the commit) | source-confirmed | yes |
| section/symbol layout, struct sizes | real compile + `readelf`/`objdump`/`offsetof` | artifact-confirmed | yes |
| module duties, scheduling | current design doc | document-confirmed | yes, mark the boundary |
| closed-source internals, secret RTL | not obtained | unverified | **never guess** |
| filled-in explanation | inference | inferred | must be labeled |

Verify any local source copy against the remote per-file (md5) — otherwise every line citation is untrustworthy. **Measurement beats documentation**: a header that contradicts the shipped binary is a finding.

## Step 3 — Write

- Every symbol-named subsection opens with **one or two sentences on what the function/struct does**, then the code. Never a heading followed directly by a code block.
- Never a bare function name — attach its duty inline.
- `file:line` for every load-bearing claim.
- Mark **dead code** (criterion: no call site anywhere in the repo).
- Make **"unverified items"** its own section.
- Type A also needs: terminology/lineage table, trap list, reproducible evidence commands, source map.
- QA pages: title = the user's own words; fold follow-ups into the existing entry; call out the false premise before answering.

## Step 4 — Diagrams

### Gates (mandatory, not advisory)

1. **Diagram Brief** for any formal/multi-figure task:
   `node <tdg-dir>/scripts/check-diagram-brief.cjs <brief.md>` (template in `<tdg-dir>/assets/`)
2. **Pilot approval** for ≥2 formal figures, specified style, or whole-article rework: deliver **one representative figure + one complete prose section using it**, then wait. Invoking a skill is not the same as following its gates.
3. Batch → lint → per-figure visual inspection → publish.

Symbol depth: **L1** system skeleton (keep) / **L2** main entries (keep with a duty phrase) / **L3** internals (push to prose). Test: remove it — can the reader still say who calls whom, why, and with what result?

One figure answers **one learning question**. Never ship a figure that only crops another — change the *viewpoint* (ownership vs layout vs timing vs data structure), or merge it.

### Generate with `scripts/svgkit.py`, not by hand

It enforces at generation time and **raises on any violation** (`save()` is a real gate):

- text wider than the card's usable width → fail
- baseline spacing ≥ 1.35·fs, hard floor 1.2·max(prev, cur)
- ≥ 10 px bottom clearance inside cards
- divider gaps 26 above / 48 below (a text box spans `baseline−(1.35fs+8)` … `baseline+16`)
- tables use zebra rows — row rules always violate the 16 px text clearance
- 14 px `userSpaceOnUse` markers; a short segment's marker ≤ 65 % of its length
- **emoji-presentation codepoints → fail** (see below)

Call `measure()` for heights; it always counts the tag badge, so probe and draw cannot disagree. Whenever "compute size" and "draw element" are two pieces of code, they must share one function.

### Glyphs: the rule is presentation, not "symbols"

The font stack (`Noto Sans CJK SC`, `Microsoft YaHei`) has **no emoji font**, so any codepoint with `Emoji_Presentation=Yes` renders as tofu. Measured on this host:

| Safe (text presentation) | Broken (emoji presentation) |
|---|---|
| ⚠ U+26A0 · ★ U+2605 · ✓ U+2713 · ✗ U+2717 | ❌ U+274C · ✅ U+2705 |

`svgkit` now blocks the broken class automatically. Incident: 17 ❌/✅ shipped inside `g7-arg-descriptors` and rendered as tofu boxes in a committed wiki figure.

### Arrows are where correctness dies

**Never claim a diagram is correct from reading the SVG source.** Coordinates fool you — a path ending `…V268` reads "up" and renders "down". Render → look → fix, every time.

1. **Write the intent list first**: every arrow as `start-box → end-box (head lands on <side>)`, plus the layout. Put it in the SVG `<title>`/`<desc>` so it travels with the file.
2. **🔴 Never use `orient="auto-start-end"`** — resvg ignores it and draws the marker at 0° (pointing right). On horizontal lines that looks fine by luck; on **vertical** lines the head stays horizontal and merges into the line. Always `orient="auto"`.
3. `marker-end` + `orient="auto"` points along the **last segment**. For an elbow path `M.. V.. H.. V..`, the final leg decides the head direction — make it point at the true destination.
4. `orient="auto"` does **not** reverse a `marker-start`. Define a separate reversed marker (`M10 0 L0 5 L10 10 z`, `refX≈1.5`) for it.
5. Route feedback/back-edges on their own lane with a distinct marker colour so they read as loops, not forward flow.
6. **Write in layers, never by spatial region**: `① backgrounds → ② all connectors → ③ all node boxes → ④ text`. Cross-region connectors always in layer ②, or an opaque panel drawn later hides a correctly-positioned line.

### Render

```bash
node <skill-dir>/scripts/render-png.mjs <in.svg|dir> [outDir]
```

Always **2x** and palette-optimised, both from measurement:

- 1x leaves 21–25 px body text soft, and mixing 1x/2x inside one article is visibly inconsistent (19 figures were split 16×1x / 3×2x until 2026-08-12).
- Palette quantisation took the same 19 figures from 29.8 MB → 11.1 MB (−63 %) with mean channel error 0.013/255, and max error only on 0.0084 % of antialiasing pixels.

**sharp is primary, resvg is fallback only.** Measured difference on one probe: resvg resolved Latin to a serif face (off-baseline) and, where a glyph was missing, rendered the *following CJK run* as boxes too; sharp kept the sans face and broke only the missing glyph. resvg also needs `fonts-noto-cjk` installed or all Chinese becomes □.

### Visual inspection is not optional

- Verify **each** arrow against the intent list, head by head. Crop and zoom every dense connector area — thumbnails hide breaks and confirmation bias fills them in. Ask "which line is broken, which box is orphaned", not "does it look right".
- For banded figures, re-render once with backgrounds at `fill-opacity="0.3"` to expose z-order occlusion.
- Check the legend describes arrows the figure actually **contains**.
- Text inside cards, no overlap; page-width comprehension and 100 % detail.
- Re-render after **every** SVG edit — editing the source without re-rendering leaves the old PNG in the page.

### Files and references

ASCII names. PNG in `_attachments/<domain>/<topic>/`, SVG source in its `src/`. In the page: the image line, a blank line, then `> 图解源文件：` linking the `.svg`. Alt text carries the full information (it is the no-image fallback).

## Step 5 — Self-check with scripts, not by re-reading

1. Extract every `file:line` → assert the file exists and the line is in range.
2. Extract every quoted code block → whitespace-normalise → diff against source.
3. Structure lint: fence parity, heading continuity, blank line before every `---`.
4. For each "X is used for Y" claim, look up **all call sites of X** — this is how write-only fields get caught.
5. Scan for contradiction between a section's code block and its prose.
6. Recount every "N items/N figures/~N lines" **in the doc and in the index pages**.

A negative conclusion ("impossible", "never called") needs evidence too. If evidence contradicts the conclusion, the conclusion is wrong.

## Step 6 — Publish

```bash
node <tdg-dir>/scripts/lint-svg-text-overlap.cjs path/to/diagram.svg
node <tdg-dir>/scripts/verify-wiki-diagrams.cjs page.md index.md hot.md log.md
```

Update the nearest domain index plus the vault's `index.md`, `hot.md`, `log.md`. Stage only your own files; scan the staged diff for secrets and never echo a password. Verify with independent reads (`git status --short`, `git log --oneline -1`, `git ls-remote`) — a tool's success message is a claim, not proof.

**Note on `technical-diagram-generator`'s release contract**: its default delivery is `.svg` only and it treats SVG/PNG exports as *temporary validation artifacts*. Wiki pages embed PNG permanently, so when calling it, declare PNG an explicit deliverable.

## Tool discipline

Send one or two tool calls, then stop and wait for real results. Never continue a tool result yourself — overlong replies get truncated and a hallucinated "success" receipt then gets treated as fact. After Write/Edit, confirm with an independent command; when the receipt and the disk disagree, believe the disk.
