#!/usr/bin/env python3
"""drawiokit must refuse what lint-drawio-layout.py --strict would reject.

The contract is one-directional and deliberate: anything drawiokit saves passes
the strict linter. A generator that emits figures its own linter rejects is
worse than no generator, because the failure surfaces after the author has
already committed to the layout.
"""
import re
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
        card.body[0] = ("body", "这一行在测量之后才被换掉，宽度已经不再适配它所在的卡片了" * 2)
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

    def test_full_feature_sheet_passes_the_strict_linter(self):
        """Everything at once: chips, typed body, subtitle, legend, background."""
        sheet = Sheet("full", title="全能力", subtitle="学习问题：一次提交经过谁？")
        first = Card("bootstrapInit",
                     [("body", "交换 rank 地址"), ("source", "bootstrap.cc:412"),
                      ("failure", "失败: 网络不可达")],
                     step="①", tone="input")
        second = Card("initTransportsRank",
                      [("heading", "探测阶段"), ("code", "ncclTransportP2pSetup()")],
                      step="②", badge="最耗时", status="后续 comm 全靠它")
        third = Card("返回 comm", [("body", "comm 可用")], step="③", tone="output")
        sheet.row([first, second])
        sheet.row([third])
        sheet.connect(first, second, label="peer 地址表")
        sheet.connect(second, third, style="dashed")
        sheet.legend()
        sheet.save(self.path)
        result = lint(self.path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('background="', self.path.read_text(encoding="utf-8"))

    def test_connectors_use_anchors_rather_than_frozen_waypoints(self):
        """Absolute waypoints survive a card move; the route they describe does not.

        Anchors are card-relative, so Draw.io re-routes when the author drags a
        card. That is the whole reason this route produces .drawio at all.
        """
        sheet, cards = sample_sheet()
        sheet.save(self.path)
        xml = self.path.read_text(encoding="utf-8")
        self.assertNotIn("<Array as=\"points\">", xml)
        self.assertIn("exitX=", xml)
        self.assertIn("entryX=", xml)
        # The predicted path is still computed, so the crossing check has geometry.
        self.assertTrue(all(connector["points"] for connector in sheet.connectors))

    def test_card_carries_its_provenance_and_is_a_container(self):
        card = Card("bootstrapInit",
                    [("body", "交换 rank 地址"), ("source", "bootstrap.cc:412")],
                    link="https://example.invalid/bootstrap.cc#L412")
        sheet = Sheet("meta")
        sheet.row([card, Card("第二张", ["占位"])])
        sheet.save(self.path)
        xml = self.path.read_text(encoding="utf-8")
        self.assertIn('data-evidence="bootstrap.cc:412"', xml)
        self.assertIn('link="https://example.invalid/bootstrap.cc#L412"', xml)
        # container=1 makes the card a real group in the editor.
        self.assertIn("container=1", xml)

    def test_unknown_body_kind_is_refused(self):
        with self.assertRaises(ValueError):
            Card("标题", [("shout", "文本")])

    def test_badge_keeps_the_inset_padding(self):
        from drawiokit import CARD_PADDING, chipw

        card = Card("短标题", ["说明"], badge="很长的徽章文字占位")
        sheet = Sheet("badge")
        sheet.row([card, Card("第二张", ["占位"])])
        sheet.save(self.path)
        # lint's INSET_PARENT_PADDING: 32 px from every edge of the rounded card.
        self.assertLessEqual(CARD_PADDING + chipw(card.badge), card.width - CARD_PADDING)

    def test_titles_in_a_row_share_one_baseline(self):
        """Uneven cards must not stagger their titles — that is what a row is."""
        short = Card("矮卡", ["一行"])
        tall = Card("高卡", ["一行", "两行", "三行"], status="失败: 超时")
        sheet = Sheet("align")
        sheet.row([short, tall])
        sheet.save(self.path)
        xml = self.path.read_text(encoding="utf-8")
        tops = [
            float(re.search(rf'id="{card.identifier}-title".*?y="([\d.]+)"', xml, re.S).group(1))
            + card.y
            for card in (short, tall)
        ]
        self.assertEqual(tops[0], tops[1])

    def test_a_row_shares_one_column_grid(self):
        """Cards in the same column position line up down the page."""
        sheet = Sheet("grid")
        sheet.row([Card("窄", ["短"]), Card("宽一些的标题", ["一行说明"])])
        sheet.row([Card("另一张很宽的卡片标题", ["一行"]), Card("乙", ["一行"])])
        sheet.save(self.path)
        first = [row.cards[0] if hasattr(row, "cards") else row[0][0] for row in sheet.rows]
        second = [row.cards[1] if hasattr(row, "cards") else row[0][1] for row in sheet.rows]
        for column in (first, second):
            self.assertEqual({card.x for card in column}, {column[0].x})
            self.assertEqual({card.width for card in column}, {column[0].width})

    def test_status_sits_below_the_divider(self):
        card = Card("带状态", ["一行"], status="失败: 超时")
        sheet = Sheet("status")
        sheet.row([card, Card("高卡", ["一行", "两行", "三行", "四行"])])
        sheet.save(self.path)
        xml = self.path.read_text(encoding="utf-8")
        divider = re.search(rf'id="{card.identifier}-divider".*?y="([\d.]+)"', xml, re.S)
        status = re.search(rf'id="{card.identifier}-status".*?y="([\d.]+)"', xml, re.S)
        self.assertGreaterEqual(float(status.group(1)), float(divider.group(1)) + 8)

    def test_legend_only_lists_what_the_figure_contains(self):
        sheet = Sheet("legend")
        sheet.row([Card("甲", ["一行"], tone="input"), Card("乙", ["一行"], tone="output")])
        sheet.legend()
        sheet.save(self.path)
        keys = {item["key"] for item in sheet.legend_items}
        self.assertEqual(keys, {"input", "output"})
        self.assertNotIn("feedback", keys)

    def test_single_tone_needs_no_legend(self):
        sheet = Sheet("mono-tone")
        sheet.row([Card("甲", ["一行"]), Card("乙", ["一行"])])
        sheet.legend()
        sheet.save(self.path)
        self.assertEqual(sheet.legend_items, [])

    def test_subtitle_grows_the_canvas(self):
        def height(**kwargs):
            sheet = Sheet("h", title="标题", **kwargs)
            sheet.row([Card("甲", ["一行"]), Card("乙", ["一行"])])
            sheet.save(self.path)
            return sheet.height

        self.assertGreater(height(subtitle="学习问题：为什么？"), height())


if __name__ == "__main__":
    unittest.main()
