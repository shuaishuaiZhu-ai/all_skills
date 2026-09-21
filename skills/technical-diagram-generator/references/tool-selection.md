# Diagram Tool Selection

Use this reference when the diagram job has multiple possible tools.

## Route contract

- Draw.io built with `scripts/drawiokit.py` is the default route for any formal figure; the `.drawio` is the editable source and the reader's deliverable together with the exported `.drawio.png`.
- The SVG route (`scripts/svgkit.py`) is for figures Draw.io cards cannot express (bit-field layouts, irregular topologies, cross-region swimlanes) or when the user asks for SVG. State the switch in the delivery.
- A missing Draw.io runtime is a failure; never fall back to another source format silently.
- Never overwrite an authoritative or hand-edited source; write `.generated` / `.generated-vN` candidates for manual merge.
- An existing SVG figure is repaired on the SVG route, keeping its source and outputs.

## Preferred Choices

| Tool/source | Best for | Weakness |
|---|---|---|
| Draw.io via `drawiokit.py` (default) | Formal learning diagrams, stage flows, ownership/timing views with cards and orthogonal connectors | Row-based layout; connectors only between adjacent rows or same-row neighbours, so edges that skip a row are not routable — put such transition tables in prose |
| Whiteboard-style SVG/PNG via `svgkit.py` | Free-coordinate figures: memory/bit-field layouts, irregular topologies, swimlanes | More manual layout work; preserve source to allow edits |
| Graphviz DOT | Routing graphs, dependency graphs, topology, dense directed edges, deterministic layout | Less whiteboard-like; labels can become cramped |
| Mermaid | Fast inline Markdown diagrams, sequences, simple flows | Renderer differences; large multilingual diagrams can be ugly or fragile |
| Hand-authored SVG | Precise diagrams, stable wiki image, later text edits | Must verify rendered result carefully |
| PlantUML | Sequence/state diagrams when PlantUML toolchain is available | Tooling may not be installed; less ideal for polished wiki assets |
| D2 | Clean architecture diagrams when D2 is installed | Do not assume availability |

Mermaid suits simple inline flows or sequences, Graphviz suits dense deterministic graphs, Lark Whiteboard only a real whiteboard target. A Draw.io figure is checked with `lint-drawio-layout.py --strict` (or `drawiokit.save()`, which runs the same checks) and exported with `export-drawio.cjs --final-only`; `compare-render-parity.cjs` applies only when both an SVG and a PNG channel of the same figure exist.

## Portable Defaults

- For wiki or documentation pages, deliver the rendered PNG plus the editable source file, nothing else in the figure directory.
- For network route, hardware path, dependency, or topology explanations, prefer whiteboard-style SVG/PNG or Graphviz DOT.
- If Mermaid routes arrows through subgraph titles or labels, switch to hand-authored SVG or Graphviz instead of repeatedly tweaking Mermaid.
- Avoid non-ASCII characters in generated asset filenames unless the target project requires them. Use ASCII slugs by default.
- Do not use Excalidraw / tldraw unless the user explicitly asks.

## Diagram Pattern Hints

| Topic | Pattern |
|---|---|
| Hardware data path | left-to-right swimlane: source -> adapter -> MAC/PCS -> PHY -> remote |
| Loopback | show normal path faintly, loopback path strongly, and mark the cut point |
| Route table number derivation | split into topology, next-hop decision, bitmask/encoding result |
| Debug choice | top-to-bottom decision tree with leaf diagnosis |
| Packet/frame format | horizontal byte/field blocks plus notes below |
| Register flow | numbered sequence, register write/read, expected status |
| Titled subgraph fan-out | avoid Mermaid TB external-to-member edges; use LR, safe anchors, Graphviz clusters, or SVG with explicit connector waypoints |
