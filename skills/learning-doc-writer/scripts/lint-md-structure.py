#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""检查 Markdown 的列表结构 —— 专抓「结构性编辑后子项挂错父项」这类错误。

为什么需要它：编辑后用 grep 确认只能回答"我问的那个模式"，
缩进的子项会被过滤掉；顶层编号连续 ≠ 结构正确（子项挂错父项时编号照样连续）。

检查三项：
  1. 嵌套缩进是否 >= 父列表标记宽度（'- ' 需 2，'1. ' 需 3，'10. ' 需 4）
     —— 不足会让子项脱离父项、渲染成独立的顶层列表。
  2. 顶层有序列表编号是否连续。
  3. 代码围栏是否配平。

用法：python3 lint-md-structure.py <file.md> [more.md ...]
退出码：0 = 干净，1 = 有问题。
"""
import re
import sys


def scan(path):
    lines = open(path, encoding='utf-8').read().split('\n')
    probs = []
    fences = 0
    infence = False
    in_front = False
    parent = None          # (行号, 需要的最小缩进, 标记, 摘要)
    seq = []

    for n, line in enumerate(lines, 1):
        # YAML frontmatter：首行 --- 到下一个 ---
        if n == 1 and line.strip() == '---':
            in_front = True
            continue
        if in_front:
            if line.strip() == '---':
                in_front = False
            continue

        if line.startswith('```'):
            infence = not infence
            fences += 1
            continue
        if infence:
            continue

        top = re.match(r'^((?:\d+\.|[-*]) )(.*)', line)
        if top:
            parent = (n, len(top.group(1)), top.group(1).strip(), top.group(2)[:30])
            m = re.match(r'^(\d+)\. ', line)
            if m:
                seq.append((n, int(m.group(1))))
            continue

        sub = re.match(r'^( +)((?:\d+\.|[-*]) )(.*)', line)
        if sub and parent:
            ind, need = len(sub.group(1)), parent[1]
            if ind < need:
                probs.append(
                    'L%d: 缩进 %d < 父项需要的 %d —— 子项会脱离父项 '
                    '(父 L%d "%s %s"，子 "%s")'
                    % (n, ind, need, parent[0], parent[2], parent[3], sub.group(3)[:34]))
            continue

        if line and not line.startswith((' ', '>', '|')):
            if len(seq) > 1:
                nums = [v for _, v in seq]
                if nums != list(range(nums[0], nums[0] + len(nums))):
                    probs.append('L%d-%d: 顶层有序列表编号不连续 %s'
                                 % (seq[0][0], seq[-1][0], nums))
            seq = []
            parent = None

    if len(seq) > 1:
        nums = [v for _, v in seq]
        if nums != list(range(nums[0], nums[0] + len(nums))):
            probs.append('L%d-: 顶层有序列表编号不连续 %s' % (seq[0][0], nums))
    if fences % 2:
        probs.append('代码围栏不配平（%d 个 ```）' % fences)
    return probs


def main(argv):
    bad = 0
    for path in argv:
        probs = scan(path)
        if probs:
            bad += len(probs)
            print('[md structure] %s' % path)
            for p in probs:
                print('  - %s' % p)
        else:
            print('[ok] %s' % path)
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
