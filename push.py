#!/usr/bin/env python3
"""贡献脚本:等价于 `python sync.py push`。

交互式(分类 新增/更新 + 复选框)挑本机新增或改动的 skill,收进仓库并 commit && push。
透传所有参数,例如:
  python push.py                 # 弹 TUI 勾选
  python push.py --no-tui        # 编号选择
  python push.py --only a,b      # 非交互(给代理/脚本)
"""
import subprocess
import sys
from pathlib import Path

raise SystemExit(
    subprocess.run(
        [sys.executable, str(Path(__file__).with_name("sync.py")), "push", *sys.argv[1:]]
    ).returncode
)
