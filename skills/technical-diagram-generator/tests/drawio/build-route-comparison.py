#!/usr/bin/env python3
"""Build the same figure on both routes so they can be judged side by side.

The content is real (the six UMD stages of the saxpy walk-through, text taken
from _attachments/grace/saxpy-e2e/src/01-panorama.svg) and identical on both
sides. Anything that differs in the output is a difference between the routes,
not between two figures — which is the only way the comparison means anything.

    python3 build-route-comparison.py <output-dir>

Writes <dir>/src/umd-six-stages.{drawio,svg}. Rendering to PNG and composing the
side-by-side sheet is render-route-comparison.mjs.
"""
import subprocess
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))

# (step, title, [(kind, text)], badge, status, tone, svg-class)
STAGES = [
    ("①", "clang -x aica 单趟编译", [
        ("body", ".cu → host x86 机器码"),
        ("body", "+ device kernel 二进制（KungFu32）"),
    ], None, None, "input", "build"),
    ("②", "fatbin 内嵌进 ELF", [
        ("body", "__CLANG_OFFLOAD_BUNDLE__ 把"),
        ("body", "device kernel 打包塞进同一个可执行文件"),
    ], None, "独立形态是 .co（code object）", "input", "build"),
    ("③", "注册 + 首次建场", [
        ("body", "RegisterFatBinary 建表；"),
        ("source", "aica_runtime.cpp 首次用 GPU 经 KMD 建 context"),
    ], "仅一次", None, "feedback", "once"),
    ("④", "aicaMalloc / Memcpy", [
        ("body", "分显存（AIP_MEM_CREATE）；"),
        ("body", "H2D 拷贝也是一条命令，入同一条 stream 队列"),
    ], None, None, "process", "each"),
    ("⑤", "add1<<<1,1>>> 组包", [
        ("heading", "查表得 init_pc"),
        ("code", "aica_kernel_dispatch_packet_t"),
        ("source", "包类型 = 0x10（仅此一个）"),
    ], None, None, "process", "each"),
    ("⑥", "写 ring + 敲 doorbell", [
        ("body", "sendPacket 把包写进 stream ringbuffer"),
        ("body", "UpdateDoorBell 原子写 doorbell（MMIO）"),
        ("source", "ringbuffer 在 host 内存，不是 VRAM"),
    ], "UMD 亲自做", None, "output", "hw"),
]

TITLE = "UMD 六阶段"
QUESTION = "学习问题：一个 kernel 从 .cu 到敲响 doorbell，UMD 做了哪六件事？"
EDGE_LABELS = {0: "device 二进制", 4: "命令包"}


def build_drawio(path):
    from drawiokit import Card, Sheet

    sheet = Sheet("umd-six-stages", title=f"{TITLE}（drawio 路线 · drawiokit 生成）",
                  subtitle=QUESTION)
    cards = [
        Card(title, body, status=status, badge=badge, tone=tone, step=step)
        for step, title, body, badge, status, tone, _svg_class in STAGES
    ]
    for index in range(0, 6, 2):
        sheet.row(cards[index:index + 2])
    for index in range(5):
        sheet.connect(cards[index], cards[index + 1], label=EDGE_LABELS.get(index))
    sheet.legend()
    sheet.save(path)
    return sheet


def build_svg(path):
    from svgkit import Doc, measure

    # svgkit has no typed-line vocabulary of its own beyond CSS classes, so the
    # kinds map onto the closest class the stylesheet already defines.
    kind_class = {"body": "body", "heading": "fn", "code": "code",
                  "source": "src", "failure": "small"}
    card_w, gap, top, row_gap = 740, 80, 250, 60
    columns = [70, 70 + card_w + gap]

    def lines_of(stage):
        _step, title, body, badge, status, _tone, _cls = stage
        lines = [("cardTitle", title)]
        lines += [(kind_class[kind], text) for kind, text in body]
        if status:
            lines += [("--", None), ("small", status)]
        return lines

    heights = [measure(card_w, lines_of(stage), tag=bool(stage[0])) for stage in STAGES]
    row_h = [max(heights[i], heights[i + 1]) for i in range(0, 6, 2)]
    row_y, y = [], top
    for height in row_h:
        row_y.append(y)
        y += height + row_gap

    doc = Doc(columns[1] + card_w + 70, int(y - row_gap + 70))
    doc.text(70, 96, f"{TITLE}（SVG 路线 · svgkit 生成）", "title")
    doc.text(70, 148, QUESTION, "subtitle")

    boxes = [(columns[i % 2], row_y[i // 2], card_w, row_h[i // 2]) for i in range(6)]
    # layer ②: every connector, before any card is drawn.
    for index in range(5):
        x1, y1, w1, h1 = boxes[index]
        x2, y2, w2, h2 = boxes[index + 1]
        if index % 2 == 0:
            doc.path(f"M{x1 + w1} {y1 + h1 / 2:.0f} H{x2 - 14}", "aMain")
        else:
            lane = y1 + h1 + row_gap / 2
            doc.path(f"M{x1 + w1 / 2:.0f} {y1 + h1} V{lane:.0f} "
                     f"H{x2 + w2 / 2:.0f} V{y2 - 14}", "aMain")
    # layers ③+④: the cards draw their own text.
    for stage, (x, yy, w, h) in zip(STAGES, boxes):
        step, _title, _body, _badge, _status, _tone, svg_class = stage
        fill = {"build": "#2f6fb3", "once": "#d9a21b", "each": "#7d63c8", "hw": "#36a374"}[svg_class]
        doc.card(x, yy, w, svg_class, step, fill, lines_of(stage), minh=h)
    doc.save(path)
    return doc


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    (out / "src").mkdir(parents=True, exist_ok=True)
    drawio = out / "src" / "umd-six-stages.drawio"
    svg = out / "src" / "umd-six-stages.svg"
    sheet = build_drawio(drawio)
    doc = build_svg(svg)
    print(f"drawio {sheet.width}x{sheet.height} -> {drawio}")
    print(f"svg    {doc.w}x{doc.h} -> {svg}")

    for command in (
        [sys.executable, str(SCRIPTS / "lint-drawio-layout.py"), str(drawio), "--strict"],
        ["node", str(SCRIPTS / "lint-svg-text-overlap.cjs"), str(svg)],
    ):
        result = subprocess.run(command)
        if result.returncode != 0:
            raise SystemExit(f"lint failed: {' '.join(command)}")
    print("both linters pass")


if __name__ == "__main__":
    main()
