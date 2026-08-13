# -*- coding: utf-8 -*-
"""hand-authored SVG builder，风格基线 = _attachments/grace/add1-fw-sharing/src/02-compile-registry.svg
强制满足 skill references/layout-safety.md：
  - 基线间距 >= 1.35*fs（硬底 1.2*max(prev,cur)）
  - 卡内文字底部净空 >= 10px（baseline + 0.25*fs 起算）
  - 文字宽度不得超出卡片可用宽度（超出则断言失败）
  - 箭头 marker 14px userSpaceOnUse，短段不超过段长 65%
"""
import json
import re
from pathlib import Path

# Shared with drawiokit.py, svg-card-layout.cjs and both linters. Keeping a
# private copy is how the generator and the linter drifted apart before.
TOKENS = json.loads(
    (Path(__file__).resolve().parent.parent / 'assets' / 'layout-constants.json').read_text(encoding='utf-8')
)

FS = dict(title=58, subtitle=28, section=34, cardTitle=31, fn=27, body=25,
          io=23, small=21, tag=21, th=22, td=22, code=23, src=20, kv=22)

STYLE = """
.bg{fill:#f5f8fb}
.title{font:700 58px "Noto Sans CJK SC","Microsoft YaHei",sans-serif;fill:#102a43}
.subtitle{font:400 28px "Noto Sans CJK SC","Microsoft YaHei",sans-serif;fill:#52697d}
.section{font:700 34px "Noto Sans CJK SC","Microsoft YaHei",sans-serif;fill:#102a43}
.cardTitle{font:700 31px "Noto Sans CJK SC","Microsoft YaHei",sans-serif;fill:#102a43}
.fn{font:700 27px Consolas,"Noto Sans Mono CJK SC",monospace;fill:#102a43}
.body{font:400 25px "Noto Sans CJK SC","Microsoft YaHei",sans-serif;fill:#334e68}
.io{font:600 23px "Noto Sans CJK SC","Microsoft YaHei",sans-serif;fill:#486581}
.small{font:400 21px "Noto Sans CJK SC","Microsoft YaHei",sans-serif;fill:#52697d}
.tag{font:700 21px "Noto Sans CJK SC","Microsoft YaHei",sans-serif;fill:#fff}
.th{font:700 22px "Noto Sans CJK SC","Microsoft YaHei",sans-serif;fill:#102a43}
.td{font:400 22px "Noto Sans CJK SC","Microsoft YaHei",sans-serif;fill:#334e68}
.code{font:600 23px Consolas,"Noto Sans Mono CJK SC",monospace;fill:#29445b}
.src{font:400 20px Consolas,"Noto Sans Mono CJK SC",monospace;fill:#7b8ea1}
.kv{font:400 22px "Noto Sans CJK SC","Microsoft YaHei",sans-serif;fill:#5b7080}
.panel{fill:#fff;stroke:#d5e0e9;stroke-width:2.5}
.build{fill:#eef1f6;stroke:#8fa3b8;stroke-width:3}
.once{fill:#fff5d9;stroke:#d9a21b;stroke-width:3}
.each{fill:#eaf3ff;stroke:#4d93df;stroke-width:3}
.hw{fill:#eaf8f1;stroke:#36a374;stroke-width:3}
.pivot{fill:#f1edff;stroke:#7d63c8;stroke-width:3}
.note{fill:#f8fafc;stroke:#9fb3c4;stroke-width:2.2}
.tbl{fill:#fff;stroke:#d9a21b;stroke-width:2.5}
.thead{fill:#ffe7a3}
.divider{stroke:#d9e2ec;stroke-width:2}
.aMain{fill:none;stroke:#2f6fb3;stroke-width:4;marker-end:url(#mBlue)}
.aOnce{fill:none;stroke:#d9a21b;stroke-width:4;stroke-dasharray:13 9;marker-end:url(#mAmber)}
.aLook{fill:none;stroke:#7d63c8;stroke-width:4;stroke-dasharray:13 9;marker-end:url(#mPurple)}
.aHw{fill:none;stroke:#36a374;stroke-width:4;marker-end:url(#mGreen)}
.aNote{fill:none;stroke:#9fb3c4;stroke-width:3;stroke-dasharray:4 7}
.lblMain{font:600 23px "Noto Sans CJK SC","Microsoft YaHei",sans-serif;fill:#2f6fb3}
.lblOnce{font:600 23px "Noto Sans CJK SC","Microsoft YaHei",sans-serif;fill:#a87a0d}
.lblLook{font:600 23px "Noto Sans CJK SC","Microsoft YaHei",sans-serif;fill:#7d63c8}
.lblHw{font:600 23px "Noto Sans CJK SC","Microsoft YaHei",sans-serif;fill:#2b8460}
"""

MARKERS = """
<marker id="mBlue" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L14 7L0 14Z" fill="#2f6fb3"/></marker>
<marker id="mAmber" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L14 7L0 14Z" fill="#d9a21b"/></marker>
<marker id="mPurple" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L14 7L0 14Z" fill="#7d63c8"/></marker>
<marker id="mGreen" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L14 7L0 14Z" fill="#36a374"/></marker>
"""

_CJK = re.compile(r'[①-⓿⺀-鿿　-〿＀-￯─-◿←-⇿☀-➿★☆]')

# Emoji_Presentation=Yes 的码点：字体栈（Noto Sans CJK / YaHei）不含 emoji 字体，
# 这类字符必然渲染成豆腐块。实测 U+274C(❌) 与 U+2705(✅) 已在 g7 里踩过。
# ⚠(26A0) ★(2605) ✓(2713) ✗(2717) 属 text presentation，实测正常，不在此列。
_EMOJI_BMP = set(
    list(range(0x231A, 0x231C)) + list(range(0x23E9, 0x23ED)) + [0x23F0, 0x23F3]
    + list(range(0x25FD, 0x25FF)) + list(range(0x2614, 0x2616))
    + list(range(0x2648, 0x2654)) + [0x267F, 0x2693, 0x26A1]
    + list(range(0x26AA, 0x26AC)) + list(range(0x26BD, 0x26BF))
    + list(range(0x26C4, 0x26C6)) + [0x26CE, 0x26D4, 0x26EA]
    + list(range(0x26F2, 0x26F4)) + [0x26F5, 0x26FA, 0x26FD]
    + [0x2705] + list(range(0x270A, 0x270C)) + [0x2728, 0x274C, 0x274E]
    + list(range(0x2753, 0x2756)) + [0x2757] + list(range(0x2795, 0x2798))
    + [0x27B0, 0x27BF] + list(range(0x2B1B, 0x2B1D)) + [0x2B50, 0x2B55]
    + [0xFE0F]  # VS16：强制 emoji 表现
)


def emoji_chars(s):
    """返回 s 里会渲染成豆腐块的 emoji 表现形式字符。"""
    bad = []
    for ch in s:
        cp = ord(ch)
        if cp in _EMOJI_BMP or 0x1F000 <= cp <= 0x1FAFF:
            bad.append(ch)
    return bad


def esc(s):
    return (s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


def textw(s, fs):
    """估算渲染宽度：CJK/全角按 wideGlyphEm，其余按 narrowGlyphEm"""
    w = 0.0
    for ch in s:
        w += (TOKENS['wideGlyphEm'] if _CJK.match(ch) else TOKENS['narrowGlyphEm']) * fs
    return w


class Doc:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.out = []
        self.problems = []

    def add(self, s):
        self.out.append(s)

    # ---------- 基础图元 ----------
    def rect(self, x, y, w, h, cls, rx=24):
        self.add(f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}"/>')

    def text(self, x, y, s, cls, anchor=None):
        a = f' text-anchor="{anchor}"' if anchor else ''
        fs = FS.get(cls, 23)
        bad = emoji_chars(s)
        if bad:
            codes = ' '.join(f'U+{ord(c):04X}({c})' for c in dict.fromkeys(bad))
            self.problems.append(f'[emoji 必成豆腐块] {codes} 出现在 "{s[:34]}…"；'
                                 f'改用 ✓ ✗ ⚠ ★ 等 text presentation 符号')
        # font-size 作为表现属性写出，仅供 linter 量真实几何；CSS 规则优先级更高，观感不变
        self.add(f'<text class="{cls}" font-size="{fs}" x="{x}" y="{y}"{a}>{esc(s)}</text>')

    def tag(self, x, y, label, fill):
        w = textw(label, FS['tag']) + 46
        self.add(f'<rect x="{x}" y="{y}" width="{w:.0f}" height="42" rx="21" fill="{fill}"/>')
        self.text(x + 23, y + 29, label, 'tag')
        return w

    def path(self, d, cls, label=None, lx=0, ly=0, lcls='lblMain', anchor=None):
        self.add(f'<path class="{cls}" d="{d}"/>')
        if label:
            self.text(lx, ly, label, lcls, anchor)

    def divider(self, x1, y, x2):
        self.add(f'<line class="divider" x1="{x1}" y1="{y}" x2="{x2}" y2="{y}"/>')

    # ---------- 卡片（自动算高 + 校验） ----------
    def card(self, x, y, w, cls, tagtext, tagfill, lines, rx=24, pad=30, minh=0):
        """lines: [(cls, text)]，cls ∈ cardTitle/fn/body/io/small/code；'--' 表示分隔线"""
        avail = w - 2 * pad
        cur = y + pad
        # tag
        body = []
        if tagtext:
            body.append(('__tag__', tagtext))
            cur += 42 + 18
        base = None
        stack = []
        prev_fs = None
        for cls_, txt in lines:
            if cls_ == '--':
                # layout-safety：文本框下沿 = baseline+16，故分隔线须 > +16；取 26
                cur += 26
                stack.append(('--', cur, None, None))
                # 下一行文本框上沿 = baseline-(1.35fs+8)，故须再留 > 1.35*fs+8；取 48
                cur += 48
                prev_fs = None
                continue
            fs = FS[cls_]
            if prev_fs is None:
                cur += 0.9 * fs
            else:
                cur += max(TOKENS['bodyLineGap'] * prev_fs,
                           TOKENS['bodyLineMinGap'] * max(prev_fs, fs))
            stack.append((cls_, cur, txt, fs))
            if textw(txt, fs) > avail:
                self.problems.append(f'[宽度超出] "{txt[:34]}…" 需 {textw(txt,fs):.0f}px > 可用 {avail:.0f}px')
            prev_fs = fs
        last_fs = prev_fs or FS['body']
        h = max(minh, (cur + 0.25 * last_fs + TOKENS['cardBottomClearancePx'] + pad - y))
        self.rect(x, y, w, round(h), cls, rx)
        if tagtext:
            self.tag(x + pad, y + pad, tagtext, tagfill)
        for cls_, yy, txt, fs in stack:
            if cls_ == '--':
                self.divider(x + pad, round(yy), x + w - pad)
            else:
                self.text(x + pad, round(yy), txt, cls_)
        return h

    # ---------- 表格（真列对齐；行高按内容，越界断言） ----------
    def table(self, x, y, colw, header, rows, hcls='th', rcls='td', rowh=44, headh=56, rx=14,
              cls='tbl', theadcls='thead'):
        """colw: 各列宽度列表；header: 表头文本列表；rows: [[c1,c2,...]]"""
        W_ = sum(colw)
        H_ = headh + rowh * len(rows)
        self.rect(x, y, W_, H_, cls, rx)
        self.add(f'<rect class="{theadcls}" x="{x}" y="{y}" width="{W_}" height="{headh}" rx="{rx}"/>')
        cx = [x + sum(colw[:i]) for i in range(len(colw))]
        for i, htxt in enumerate(header):
            self.text(cx[i] + 18, y + headh - 19, htxt, hcls)
            if textw(htxt, FS[hcls]) > colw[i] - 30:
                self.problems.append(f'[表头超列] "{htxt}" > 列宽 {colw[i]}')
        for r, row in enumerate(rows):
            yy = y + headh + rowh * r
            # 用斑马纹代替行分隔线：避免线段落进文字的 16px 净空区
            if r % 2 == 1:
                self.add(f'<rect x="{x + 3}" y="{yy}" width="{W_ - 6}" height="{rowh}" fill="#f4f7fa"/>')
            for i, cell in enumerate(row):
                if i >= len(colw):
                    continue
                self.text(cx[i] + 18, yy + rowh - 15, cell, rcls)
                if textw(cell, FS[rcls]) > colw[i] - 30:
                    self.problems.append(f'[单元超列] "{cell[:28]}" 需 {textw(cell,FS[rcls]):.0f} > {colw[i]-30}')
        return H_

    def render(self):
        head = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" '
                f'viewBox="0 0 {self.w} {self.h}">\n<defs>\n<style>{STYLE}</style>\n{MARKERS}</defs>\n'
                f'<rect class="bg" width="{self.w}" height="{self.h}"/>\n')
        return head + '\n'.join(self.out) + '\n</svg>\n'

    def save(self, path, strict=True):
        """写盘并自检。strict=True（默认）时有任何问题就抛，让它成为真正的门。"""
        open(path, 'w', encoding='utf-8').write(self.render())
        if self.problems:
            print('!! 自检问题 %d 处:' % len(self.problems))
            for p in self.problems:
                print('   ', p)
            if strict:
                raise RuntimeError(f'{path}: 自检未通过，{len(self.problems)} 处问题（见上）')
        else:
            print('自检通过（宽度/基线/底部净空/emoji）')


def measure(w, lines, tag=True, pad=30):
    """统一测高：始终按"有 tag 徽章"计，避免探针与绘制不一致（tag 占 42+18=60px）。"""
    return Doc(1, 1).card(0, 0, w, 'note', 'X' if tag else '', '#000', lines, pad=pad)
