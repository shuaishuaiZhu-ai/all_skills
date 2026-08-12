# Diagram Tool Selection

Use this reference when the diagram job has multiple possible tools.

## 发布路由契约

- 默认 SVG 交付：未指定格式或 `--format svg` 时只交付 `.svg`。（`Default SVG delivery: .svg only.`）
- 显式 Draw.io 交付：只有用户明确要求 `--format drawio` 时才交付 `.drawio`，且只交付 `.drawio`；工具不可用时明确失败，不得切换到 SVG。（`Explicit Draw.io delivery: .drawio only.`）
- 双通道交付：只有用户明确要求 `--format both` 时才交付 `.svg` + `.drawio`。（`Both-channel delivery: .svg + .drawio.`）
- 现有权威源或手工编辑源不得覆盖；生成结果写入 `.generated` 或 `.generated-vN` 候选，供人工比较和合并。
- SVG/PNG 验证导出物是临时文件，除非用户或发布目标明确要求，否则不属于交付物。（`SVG/PNG validation exports are temporary unless explicitly requested.`）
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

SVG 是正式发布的默认源通道。Draw.io 在用户明确需要可编辑 Draw.io 源时使用；Mermaid 适合简单内嵌流程或时序，Graphviz 适合稠密确定性图，Lark Whiteboard 仅用于真实白板目标。标准组件生成器的命令和质量状态见 `standard-component-generator.md`。

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
