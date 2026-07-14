# Knowledge Diagram Content Quality

Read this reference for knowledge-sharing pages, onboarding material, whole-article rewrites, batch figures, or any task where audience level and symbol density can be misunderstood.

## Contents

1. Reader Contract
2. Symbol Selection
3. Evidence Model
4. Figure Brief
5. Information Structure
6. Figure And Prose Division
7. Approval Gate
8. Review Passes
9. Practical Baseline From `add1`

## 1. Reader Contract

Write three explicit statements before choosing content:

1. **Audience knows:** frameworks and terminology that need no basic definition.
2. **Reader gap:** connections or implementation boundaries they have not developed personally.
3. **Learning outcome:** what they must be able to explain after reading.

Do not translate “new graduate” or “beginner” into “non-technical outsider.” A technical beginner may already know programming, firmware, operating systems, or hardware architecture.

## 2. Symbol Selection

Classify every identifier:

| Level | Examples | Default treatment |
|---|---|---|
| L1 system skeleton | UMD, KMD, CP, scheduler, core | Keep |
| L2 main entries | launch API, `Thunk_*`, main ioctl, dispatch entry | Keep when it explains who calls whom; add one role sentence |
| L3 internals | helper functions, local variables, map names, bit fields | Move to advanced text/page unless central |

Use this test: if removing the symbol prevents the reader from explaining “who calls whom, why, and what comes out,” keep it. If it only changes the internals of one main function, omit it from the main diagram.

Avoid both failure modes:

- **Symbol flood:** many identifiers but no explanation.
- **Empty simplification:** only layer names and arrows, with no real call framework.

## 3. Evidence Model

Before layout, record important claims:

| Claim | Source | Status | Diagram treatment |
|---|---|---|---|
| call/assignment | current source snapshot | source-confirmed | definitive |
| binary/section/ISA layout | actual build and tools | artifact-confirmed | definitive |
| architectural behavior | current MAS/design doc | document-confirmed | note document boundary |
| hidden RTL | unavailable | unverified | do not invent |
| explanatory connection | reasoning | inferred | label as inference |

If an address, timing, field, or execution order can be checked by building or reading source, do that before drawing.

## 4. Figure Brief

For every non-trivial figure, define:

- one learning question;
- must-keep modules/functions/data;
- details to omit;
- reading order;
- arrow semantics: call, data, notification, ownership, or completion;
- source boundary;
- output assets and target page;
- acceptance at page width and 100% zoom.

Use `../assets/diagram-brief-template.md` and validate it with `../scripts/check-diagram-brief.cjs`.

## 5. Information Structure

For a stage diagram, use:

```text
problem → input → main action/function → output → why needed
```

For a panorama:

- order layers and phases by the real lifecycle;
- distinguish one-time setup, per-task flow, and completion feedback;
- show cross-layer direct paths even when they skip a lane;
- retain main entry functions without expanding their bodies;
- use numbered steps and a legend when path types differ.

For code/registry/layout explanations, show a concrete example object or table instead of only naming abstract containers.

## 6. Figure And Prose Division

- Figure: spatial relationships, order, branches, boundaries, inputs, and outputs.
- Prose: reasons, limitations, exceptions, source evidence, and derivation.
- Do not create a figure that merely crops the panorama or repeats paragraphs verbatim.
- Put key code comments next to the relevant line when that is clearer than later prose.

## 7. Approval Gate

Require a pilot for batch/style-sensitive work:

1. one representative figure;
2. one complete prose section using it;
3. page-width preview;
4. 100% preview;
5. must-keep and must-omit list.

After approval, record the baseline:

- canvas/aspect ratio;
- title/body/code font sizes;
- semantic colors;
- card structure;
- arrow style;
- information density;
- reference exemplar path.

Do not infer that diagram approval also approves the article voice. Approve both.

## 8. Review Passes

Perform three independent passes:

1. **Technical:** every important relation has evidence; unknowns are labeled.
2. **Teaching:** the reader can state input, action, output, and reason; terminology is introduced at the right level.
3. **Visual:** page-width path is clear; full zoom is readable; arrows, text stacks, and card bounds are safe.

Automated lint proves geometry constraints, not teaching quality. Visual review proves appearance, not technical truth. Both are required.

## 9. Practical Baseline From `add1`

The accepted pattern kept system layers plus main entries and described their roles, while hiding internal containers and field-level mechanics. The approved panorama established direction and path types; later `Init_PC` diagrams were drawn only after current source, real code objects, section/symbol data, and disassembly were checked.

Reusable lesson: **reduce cognitive load through structure and explanation, not by deleting the technical backbone.**
