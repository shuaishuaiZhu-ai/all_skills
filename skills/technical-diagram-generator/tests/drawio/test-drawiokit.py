#!/usr/bin/env python3
"""drawiokit must refuse what lint-drawio-layout.py --strict would reject.

The contract is one-directional and deliberate: anything drawiokit saves passes
the strict linter. A generator that emits figures its own linter rejects is
worse than no generator, because the failure surfaces after the author has
already committed to the layout.
"""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from drawiokit import Card, Sheet  # noqa: E402


def lint(path, strict=True):
    args = [sys.executable, str(SCRIPTS / "lint-drawio-layout.py"), str(path)]
    if strict:
        args.append("--strict")
    return subprocess.run(args, capture_output=True, text=True)


def sample_sheet():
    sheet = Sheet("sample", title="NCCL 初始化：三步建场")
    first = Card("① bootstrapInit", ["交换 rank 地址", "bootstrap.cc:412"],
                 status="失败: 网络不可达", tone="input")
    second = Card("② initTransportsRank", ["探测 P2P/NET 通路", "init.cc:1103"],
                  badge="最耗时", tone="process")
    third = Card("③ ncclCommInitRank 返回", ["comm 可用"],
                 status="失败: ncclSystemError", tone="output")
    sheet.row([first, second])
    sheet.row([third])
    sheet.connect(first, second, label="peer 地址表")
    sheet.connect(second, third)
    return sheet, (first, second, third)


class DrawiokitTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "figure.drawio"

    def tearDown(self):
        self.directory.cleanup()

    def test_saved_sheet_passes_the_strict_linter(self):
        sheet, _cards = sample_sheet()
        sheet.save(self.path)
        result = lint(self.path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_measure_matches_what_gets_drawn(self):
        card = Card("① bootstrapInit", ["交换 rank 地址"])
        from drawiokit import measure

        width, height = measure(card)
        sheet = Sheet("probe")
        sheet.row([card, Card("② 另一张卡", ["占位"])])
        sheet.save(self.path)
        self.assertEqual(width, card.width)
        # Row equalisation may raise a card's height; it may never shrink it.
        self.assertLessEqual(height, card.height)

    def test_overlong_label_is_refused(self):
        sheet = Sheet("overflow")
        # A body line longer than the widest measured line cannot happen through
        # the API, so force the drift the check exists to catch.
        card = Card("短标题", ["短"])
        sheet.row([card, Card("第二张", ["占位"])])
        sheet._place()
        card.body[0] = "这一行在测量之后才被换掉，宽度已经不再适配它所在的卡片了" * 2
        sheet._route()
        sheet.problems = []
        sheet._check_text()
        self.assertTrue(any("文字超宽" in problem for problem in sheet.problems), sheet.problems)

    def test_over_wide_sheet_is_refused(self):
        sheet = Sheet("wide")
        sheet.row([Card(f"卡片 {index}", ["一行说明文字"]) for index in range(6)])
        with self.assertRaises(RuntimeError) as raised:
            sheet.save(self.path)
        self.assertIn("画布过宽", str(raised.exception))

    def test_emoji_presentation_is_refused(self):
        sheet = Sheet("emoji")
        sheet.row([Card("❌ 失败路径", ["说明"]), Card("正常路径", ["说明"])])
        with self.assertRaises(RuntimeError) as raised:
            sheet.save(self.path)
        self.assertIn("emoji", str(raised.exception))

    def test_font_sizes_meet_the_linter_minimums(self):
        from drawiokit import FONT, FONT_MINIMUM

        for role, minimum in FONT_MINIMUM.items():
            self.assertGreaterEqual(FONT[role], minimum, role)


if __name__ == "__main__":
    unittest.main()
