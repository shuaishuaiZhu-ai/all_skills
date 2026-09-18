---
name: learning-doc-writer
description: Write and revise deep technical learning documents — 学习文档、深度长文、问答页、技术讲解、porting-grade walkthroughs, wiki 页面. Use when writing or reworking a document that explains real code or hardware, when deciding how deep a page must go, when a claim needs a source, or when publishing to a wiki/vault and updating its indexes. Owns doc-type triage, the evidence grading model, file:line citation discipline, and the script-based self-check. For the figures such a document contains, use technical-diagram-generator.
---

# Learning Doc Writer

A learning document is judged by what the reader can do afterwards, not by how
much it covers. This skill decides that bar first, then holds every claim in the
document to a stated evidence grade.

Full written standard (reasoning, worked examples, incident records):
`references/learning-doc-writing-standard.md`

**Figures are not this skill's job.** Any diagram in the document — 图解, 流程图,
架构图 — goes through `technical-diagram-generator`, which owns the generators,
the layout gates and the render-and-look loop.

## Step 1 — Triage the doc type FIRST

| Type | Goal | Depth floor |
|---|---|---|
| A. Porting-grade长文 | reader can rewrite an equivalent implementation | **byte/bit level**: offsets, widths, alignment, magic values, derivations |
| B. End-to-end walkthrough | reader can narrate one full path | main functions + key struct fields |
| C. QA page | resolve one specific question | as deep as the question; state boundaries |
| D. Index/nav | route in 30 s | one-line locators only — never copy body text |
| E. Standard/spec | next person avoids the trap | every rule gets a "why" + a real incident |

Ask: *what must the reader be able to DO afterwards?* Type A implies **format
specs**, not just call chains — function names can be copied from source, byte
layouts cannot.

## Step 2 — Evidence model before writing

`read real sources → record evidence + unknowns → fix conclusions → design layout → draw`

| Claim | Source | Status | Assertable? |
|---|---|---|---|
| calls, field assignments | source snapshot (record the commit) | source-confirmed | yes |
| section/symbol layout, struct sizes | real compile + `readelf`/`objdump`/`offsetof` | artifact-confirmed | yes |
| module duties, scheduling | current design doc | document-confirmed | yes, mark the boundary |
| closed-source internals, secret RTL | not obtained | unverified | **never guess** |
| filled-in explanation | inference | inferred | must be labeled |

Verify any local source copy against the remote per-file (md5) — otherwise every
line citation is untrustworthy. **Measurement beats documentation**: a header
that contradicts the shipped binary is a finding.

## Step 3 — Write

- Every symbol-named subsection opens with **one or two sentences on what the
  function/struct does**, then the code. Never a heading followed directly by a
  code block.
- Never a bare function name — attach its duty inline.
- `file:line` for every load-bearing claim.
- Mark **dead code** (criterion: no call site anywhere in the repo).
- Make **"unverified items"** its own section.
- Type A also needs: terminology/lineage table, trap list, reproducible evidence
  commands, source map.
- QA pages: title = the user's own words; fold follow-ups into the existing
  entry; call out the false premise before answering.

## Step 4 — Figures

Hand the figure work to `technical-diagram-generator` and honour its gates: a
Diagram Brief for any formal or multi-figure task, pilot approval for two or
more formal figures, then batch → lint → per-figure visual inspection.

Two rules belong to the document rather than the figure:

- One figure answers **one learning question**. Never ship a figure that only
  crops another — change the *viewpoint* (ownership vs layout vs timing vs data
  structure), or merge it.
- Symbol depth: **L1** system skeleton (keep) / **L2** main entries (keep with a
  duty phrase) / **L3** internals (push to prose). Test: remove it — can the
  reader still say who calls whom, why, and with what result?

Wiki pages embed PNG permanently, so when calling the generator say so: PNG is a
requested deliverable, not a temporary validation export.

## Step 5 — Self-check with scripts, not by re-reading

1. Extract every `file:line` → read **that line itself** back with an independent
   `sed -n "${n}p" <file>` and confirm it contains what the citation claims. "File
   exists and line is in range" is not enough. Never derive a line number by
   counting offsets inside a `sed -n 'a,bp'` dump: if the command ended in
   `head`/`tail`/`cut`, the first line you see may not be line `a`, and the
   truncation is invisible at the pipe's tail.
2. Extract every quoted code block → whitespace-normalise → diff against source.
3. Structure lint: run `python3 <skill-dir>/scripts/lint-md-structure.py page.md` —
   fence parity, top-level ordered-list numbering, and **nested-list indent >=
   the parent marker width** (`- ` needs 2, `1. ` needs 3, `10. ` needs 4).
   Under-indented children silently detach from their parent and render as a
   separate top-level list. Also check: blank line before every `---`.
4. For each "X is used for Y" claim, look up **all call sites of X** — this is
   how write-only fields get caught.
5. Scan for contradiction between a section's code block and its prose.
5b. After any **structural** edit (insert / move / renumber), `sed -n 'a,bp'` the
   affected range and read the **raw lines including indentation**. A grep view
   only answers the pattern you asked for: continuous top-level numbering does
   **not** prove the children are attached to the right parent.
5c. **Why-audit the normative statements.** Grep the strong modals (must / never /
   forbidden / reject / fail — and their CJK equivalents 必须/禁止/不得/一律/
   直接失败) and check each has a stated reason or consequence. A rule whose
   violation fails *silently* needs the why most: the reader who does not know
   the cost will "simplify" the rule away. Ground the why in facts the document
   already carries, not in generic best practice. ⚠️ The grep only produces
   candidates — the why is often on the next line or in a table's last column,
   so **read each hit** rather than trusting the filter (see failure mode 9).
6. Recount every "N items/N figures/~N lines" **in the doc and in the index pages**.

A negative conclusion ("impossible", "never called") needs evidence too. If
evidence contradicts the conclusion, the conclusion is wrong.

## Step 6 — Publish

```bash
node <tdg-dir>/scripts/verify-wiki-diagrams.cjs page.md index.md hot.md log.md
```

Update the nearest domain index plus the vault's `index.md`, `hot.md`, `log.md`.
Stage only your own files; scan the staged diff for secrets and never echo a
password. Verify with independent reads (`git status --short`,
`git log --oneline -1`, `git ls-remote`) — a tool's success message is a claim,
not proof.

## Tool discipline

Send one or two tool calls, then stop and wait for real results. Never continue a
tool result yourself — overlong replies get truncated and a hallucinated
"success" receipt then gets treated as fact. After Write/Edit, confirm with an
independent command; when the receipt and the disk disagree, believe the disk.
