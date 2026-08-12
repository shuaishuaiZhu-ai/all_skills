# 标准组件生成器与发布契约

本参考定义正式发布的格式路由、组件输入和跨平台运行入口。它只描述已实现的公开 Node.js CLI；不把临时验证产物当作第二个正式源格式。

## 格式与交付

- 未传 `--format` 或传入 `--format svg` 时，默认 SVG 交付且只交付 `.svg`。（`Default SVG delivery: .svg only.`）
- 用户明确要求 `--format drawio` 时，显式 Draw.io 交付且只交付 `.drawio`。（`Explicit Draw.io delivery: .drawio only.`）用户明确要求 `--format both` 时，双通道交付 `.svg` + `.drawio`。（`Both-channel delivery: .svg + .drawio.`）
- 显式 Draw.io 请求缺少运行时必须报错，不能回退为 SVG；SVG 失败也不能回退为 Draw.io。
- SVG 验证可临时生成 PNG；Draw.io 验证可临时导出 SVG/PNG。SVG/PNG 验证导出物均为临时文件，除非用户或发布目标明确要求。（`SVG/PNG validation exports are temporary unless explicitly requested.`）它们必须在质量报告中与 `requestedDeliverables` 分开记录，成功后清理。
- 既有 SVG 修复走遗留 SVG 分支，不改变其权威源语义。

## 组件输入与布局

`diagram-spec.json` 使用确定性组件模型，而不是自由坐标 XML。基本字段包括：`schemaVersion: 1`、`id`、`title`、`learningQuestion`、`evidence`、`layout`、`components` 与 `connectors`。证据状态只能是 `confirmed`、`inferred` 或 `unverified`；布局只能是 `flow-row`、`timeline-row` 或 `panel-grid`。

可用组件为 `canvas`、`section`、`panel`、`card`、`badge`、`text-stack`、`divider`、`status`、`note`、`table`、`connector` 与 `legend`。使用稳定 ID、父子关系和连接端点；不要为第一版标准组件生成器加入自由坐标布局。SVG 与 Draw.io 渲染器从同一布局模型输出，并保留组件角色和分组元数据。

## 公开 CLI

在技能目录运行：

```powershell
npm ci
node scripts/build-technical-diagram.cjs --spec diagram-spec.json --out .\diagram-output
node scripts/build-technical-diagram.cjs --spec diagram-spec.json --out .\diagram-output --format drawio
node scripts/build-technical-diagram.cjs --spec diagram-spec.json --out .\diagram-output --format both --drawio-executable "C:\Program Files\draw.io\draw.io.exe"
```

参数为 `--spec <json>`、`--out <directory>`、可选 `--format svg|drawio|both`、`--base-name <name>` 和 `--drawio-executable <path>`。开发比较和发布验收若需要双通道，必须显式传入 `--format both`。

运行时按 CLI 参数、`DRAWIO_EXECUTABLE`、`PATH` 中的 `drawio`/`draw.io`、Windows 默认安装位置依次解析 Draw.io。不要在页面或脚本中写死个人路径。

## Ubuntu 22.04 与用户级运行

支持 Windows 原生和 Ubuntu 22.04 x86_64，要求 Node.js 20+、Python 3.10+。每个干净技能副本先在技能目录执行 `npm ci`；不要依赖其他机器的 `node_modules`、`NODE_PATH` 或 PowerShell。

Ubuntu 的显式 Draw.io/both 需要本地 Draw.io CLI 与 `xvfb-run`。在默认用户上下文中可运行：

精简 Docker 镜像先由 root 安装运行依赖：

```bash
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y xvfb fonts-noto-cjk libgbm1 libasound2
! ldd /opt/drawio/drawio | grep 'not found'
```

生成本身不需要 root。若容器以 root 运行，生成器会自动向 Draw.io 增加 `--no-sandbox`，但不会关闭布局与一致性门禁。

```bash
cd /path/to/technical-diagram-generator
npm ci
export DRAWIO_EXECUTABLE=/usr/bin/drawio
xvfb-run -a node scripts/build-technical-diagram.cjs --spec diagram-spec.json --out ./diagram-output --format drawio
```

安装 Draw.io 运行时应使用受控的 Ubuntu 22.04 安装步骤、固定版本和 SHA-256 校验；运行生成不需要 root。缺少 Draw.io 返回 `E_DRAWIO_UNAVAILABLE`，缺少 `xvfb-run` 返回 `E_DRAWIO_HEADLESS_UNAVAILABLE`，不得调用云端转换或静默降级。

## 人工源保护与质量状态

所有生成先写入本次运行的 staging 目录。自动门禁通过后才提升候选：若目标源已存在或经人工编辑，绝不覆盖，改写为 `.generated` 或递增的 `.generated-vN`。失败候选留在隔离目录并携带报告。

质量报告区分正式交付物与临时验证文件。自动检查通过后，`visual-pending` 质量报告保持不可变；不得由人工复核脚本原地改写。完成页面宽度与 100% 两种视图的视觉复核后，运行 `record-diagram-review.cjs`，在报告旁追加内容寻址的 `*.review-<quality-report-sha256>.json` receipt。复核脚本必须拒绝失败的 `checks`、非空 `errors`，以及 `requestedFormat`、`requestedDeliverables`、正式产物 `kind` 不一致的报告。只有绑定当前质量报告哈希和全部正式产物哈希的 `ready` receipt 才允许发布；任一哈希变化都必须重新生成 receipt。

Review receipt 采用排他创建，不覆盖同名文件；路径由质量报告 SHA-256 决定。质量报告、receipt 和正式产物在写入后都会重新读取校验，且正式产物的 realpath 必须位于质量报告目录 realpath 内，经过 symlink/junction 逃逸的路径必须拒绝。威胁模型是普通协作式离线构建与复核进程，防止误覆盖、并发冲突和复核期间的文件变化；不承诺抵御恶意非协作进程在函数返回瞬间持续改写文件。
