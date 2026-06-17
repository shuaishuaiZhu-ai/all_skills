#!/usr/bin/env python3
"""agent-skills 交互式 TUI(基于 Textual)。

分类 tab(←/→ 切换)+ 多选复选框(↑/↓ 移动、空格勾选)。被 sync.py / push.py 调用。
若本机未装 textual,调用方应改用 stdlib 编号降级(本模块顶层 import textual,缺失会直接 ImportError,
由调用方 try/except 捕获)。
"""
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.widgets import Footer, Label, SelectionList, TabbedContent, TabPane
from textual.widgets.selection_list import Selection


class _ChooseApp(App):
    """catalog: [(分类名, [(value, label), ...]), ...];preselected: 预勾选的 value 集合。
    确认返回勾选 value 集合,取消返回 None(存到 self.result)。"""

    CSS = """
    Label#title { padding: 0 1; color: $accent; text-style: bold; }
    SelectionList { height: 1fr; border: round $panel; }
    """
    BINDINGS = [
        Binding("left", "prev_tab", "上一类"),
        Binding("right", "next_tab", "下一类"),
        Binding("a", "toggle_all", "全选/全不选"),
        Binding("s", "confirm", "确认"),
        Binding("ctrl+s", "confirm", "确认"),
        Binding("q", "cancel", "取消"),
        Binding("escape", "cancel", "取消"),
    ]

    def __init__(self, catalog, preselected, title):
        super().__init__()
        self._catalog = catalog
        self._pre = set(preselected)
        self._title = title
        self._tab_ids = [f"cat{i}" for i in range(len(catalog))]
        self.result = None

    def compose(self) -> ComposeResult:
        yield Label(self._title, id="title")
        with TabbedContent():
            for i, (cat, items) in enumerate(self._catalog):
                with TabPane(f"{cat} ({len(items)})", id=self._tab_ids[i]):
                    yield SelectionList[str](
                        *[Selection(label, value, value in self._pre) for value, label in items]
                    )
        yield Footer()

    def _tabbed(self) -> TabbedContent:
        return self.query_one(TabbedContent)

    def _shift_tab(self, delta):
        if len(self._tab_ids) <= 1:
            return
        cur = self._tabbed().active
        i = self._tab_ids.index(cur) if cur in self._tab_ids else 0
        self._tabbed().active = self._tab_ids[(i + delta) % len(self._tab_ids)]

    def action_next_tab(self):
        self._shift_tab(1)

    def action_prev_tab(self):
        self._shift_tab(-1)

    def _active_list(self) -> SelectionList:
        pane = self.query_one(f"#{self._tabbed().active}", TabPane)
        return pane.query_one(SelectionList)

    def action_toggle_all(self):
        sl = self._active_list()
        if len(sl.selected) >= sl.option_count:
            sl.deselect_all()
        else:
            sl.select_all()

    def action_confirm(self):
        chosen = set()
        for sl in self.query(SelectionList):
            chosen.update(sl.selected)
        self.result = chosen
        self.exit()

    def action_cancel(self):
        self.result = None
        self.exit()


def choose(catalog, preselected, title="选择 skills  (←/→ 切分类  ↑/↓ 移动  空格勾选  s 确认  q 取消)"):
    """运行 TUI,返回勾选的 value 集合;用户取消则返回 None。"""
    app = _ChooseApp(catalog, preselected, title)
    app.run()
    return app.result
