# Diagram Tool Selection

Use this reference when the diagram job has multiple possible tools.

## Preferred Choices

| Tool/source | Best for | Weakness |
|---|---|---|
| Whiteboard-style SVG/PNG | Learning diagrams, whiteboard explainers, wiki images that must be easy to view | More manual layout work; preserve source to allow edits |
| Graphviz DOT | Routing graphs, dependency graphs, topology, dense directed edges, deterministic layout | Less whiteboard-like; labels can become cramped |
| Mermaid | Fast inline Markdown diagrams, sequences, simple flows | Renderer differences; large multilingual diagrams can be ugly or fragile |
| Hand-authored SVG | Precise diagrams, stable wiki image, later text edits | Must verify rendered result carefully |
| PlantUML | Sequence/state diagrams when PlantUML toolchain is available | Tooling may not be installed; less ideal for polished wiki assets |
| D2 | Clean architecture diagrams when D2 is installed | Do not assume availability |

## Portable Defaults

- For wiki or documentation pages, prefer rendered PNG/SVG plus an editable source file.
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
