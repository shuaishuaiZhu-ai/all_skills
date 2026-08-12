# Diagram Tool Selection

Use this reference when the diagram job has multiple possible tools.

## 发布路由契约

- Draw.io 是手工可编辑源：直接创建或编辑 `.drawio`，再用 bundled exporter 导出 SVG/PNG。
- Draw.io 运行时不可用时明确失败，不得静默切换到 SVG 或其他源格式。
- 现有权威源或手工编辑源不得覆盖；候选结果写入 `.generated` 或 `.generated-vN`，供人工比较和合并。
- SVG/PNG 验证导出物除非用户或发布目标明确要求，否则不属于额外交付物。
- 旧 SVG 修复继续走原 SVG 分支，保留其源文件与既有输出。

## Preferred Choices

| Tool/source | Best for | Weakness |
|---|---|---|
| Whiteboard-style SVG/PNG | Learning diagrams, whiteboard explainers, wiki images that must be easy to view | More manual layout work; preserve source to allow edits |
| Graphviz DOT | Routing graphs, dependency graphs, topology, dense directed edges, deterministic layout | Less whiteboard-like; labels can become cramped |
| Mermaid | Fast inline Markdown diagrams, sequences, simple flows | Renderer differences; large multilingual diagrams can be ugly or fragile |
| Hand-authored SVG | Precise diagrams, stable wiki image, later text edits | Must verify rendered result carefully |
| PlantUML | Sequence/state diagrams when PlantUML toolchain is available | Tooling may not be installed; less ideal for polished wiki assets |
| D2 | Clean architecture diagrams when D2 is installed | Do not assume availability |

Draw.io 在用户明确需要可编辑 Draw.io 源时使用；Mermaid 适合简单内嵌流程或时序，Graphviz 适合稠密确定性图，Lark Whiteboard 仅用于真实白板目标。Draw.io 图应使用 `lint-drawio-layout.py`、`export-drawio.ps1`/`export-drawio.cjs` 和 `compare-render-parity.cjs` 检查。

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
