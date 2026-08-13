# -*- coding: utf-8 -*-
"""Draw.io builder for the default figure route.

The author places the cards; this module sizes them, picks the fonts, routes the
connectors and refuses to save a sheet that would fail `lint-drawio-layout.py
--strict`. It deliberately does NOT auto-layout: rows and their order come from
the caller, so the figure's meaning stays the author's decision.

Every threshold below is the linter's own, so a sheet that saves here passes
there. When the two disagree, the linter is right and this file is the bug.
"""
import json
import math
import sys
import unicodedata
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from svgkit import emoji_chars  # noqa: E402  same font-stack blocklist as the SVG route

TOKENS = json.loads((_HERE.parent / 'assets' / 'layout-constants.json').read_text(encoding='utf-8'))

# lint-drawio-layout.py: FONT_MINIMUMS. Sizes sit at or above the floor.
FONT = {'title': 26, 'body': 18, 'badge': 16, 'status': 16, 'note': 16, 'table-cell': 14}
FONT_MINIMUM = {'title': 24, 'body': 18, 'badge': 16, 'status': 16, 'note': 16, 'table-cell': 14}
BOLD_ROLES = {'title'}

# Draw.io splits a style string on ';', so a font stack may only use commas.
FAMILY = 'Noto Sans CJK SC,Microsoft YaHei,Arial'
MONO_FAMILY = 'Consolas,Noto Sans Mono CJK SC,monospace'

LABEL_PADDING = 4          # lint: LABEL_PADDING, applied on both sides
CARD_PADDING = 32          # lint: INSET_PARENT_PADDING, so a badge always clears the arc
DIVIDER_GAP = 12           # lint: status must start >= divider bottom + 8
GAP_MIN, GAP_MAX = 40, 80  # lint fails outside 32..120; stay inside the readable band
MARGIN_MIN, MARGIN_MAX = 40, 80
LABEL_OFFSET = 20          # lint: EDGE_LABEL_CLEARANCE is 16
OVERLAP_TOLERANCE = 2.0

TONE = {
    'input': 'fillColor=#ecfdf5,strokeColor=#059669',
    'process': 'fillColor=#ffffff,strokeColor=#2563eb',
    'output': 'fillColor=#f5f3ff,strokeColor=#7c3aed',
    'feedback': 'fillColor=#fff7ed,strokeColor=#ea580c',
    'unverified': 'fillColor=#f8fafc,strokeColor=#94a3b8,dashed=1',
}


def textw(text, role, mono=False):
    """Advance width, mirroring lint-drawio-layout.estimate_text_width."""
    font_size = FONT[role]
    narrow = TOKENS['monoGlyphEm'] if mono else TOKENS['narrowGlyphEm']
    ems = sum(TOKENS['wideGlyphEm'] if unicodedata.east_asian_width(ch) in {'W', 'F'} else narrow
              for ch in text)
    width = ems * font_size
    return width * 1.05 if role in BOLD_ROLES else width


def cellw(text, role, mono=False):
    """Cell width a label needs, including the padding the linter subtracts."""
    return textw(text, role, mono) + 2 * LABEL_PADDING


def lineh(role):
    return round(FONT[role] * TOKENS['bodyLineGap'])


def esc(value):
    return (str(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            .replace('"', '&quot;'))


class Card:
    """One card. `body` lines are rendered verbatim — pre-split them yourself."""

    def __init__(self, title, body=(), status=None, badge=None, tone='process', mono_body=False):
        self.title = title
        self.body = list(body)
        self.status = status
        self.badge = badge
        self.tone = tone
        self.mono_body = mono_body
        self.x = self.y = 0.0
        self.width = self.height = 0.0
        self.identifier = ''

    def texts(self):
        out = []
        if self.badge:
            out.append(('badge', self.badge, False))
        out.append(('title', self.title, False))
        out.extend(('body', line, self.mono_body) for line in self.body)
        if self.status:
            out.append(('status', self.status, False))
        return out

    def measure(self):
        widest = max(cellw(text, role, mono) for role, text, mono in self.texts())
        # Ceil, not round: a card rounded down leaves its widest label one
        # sub-pixel too wide for the box it was measured against.
        self.width = 2 * CARD_PADDING + math.ceil(widest)
        height = CARD_PADDING
        for role, _text, _mono in self.texts():
            if role == 'status':
                height += DIVIDER_GAP + 1 + DIVIDER_GAP
            height += lineh(role)
        self.height = round(height + CARD_PADDING)


class Sheet:
    def __init__(self, identifier, title=None, margin=60):
        if not MARGIN_MIN <= margin <= MARGIN_MAX:
            raise ValueError(f'margin {margin} outside {MARGIN_MIN}..{MARGIN_MAX}')
        self.identifier = identifier
        self.title = title
        self.margin = margin
        self.rows = []
        self.connectors = []
        self.problems = []

    def row(self, cards, gap=56):
        if not GAP_MIN <= gap <= GAP_MAX:
            raise ValueError(f'card gap {gap} outside {GAP_MIN}..{GAP_MAX}')
        self.rows.append((list(cards), gap))
        return cards

    def connect(self, source, target, label=None, style='solid'):
        self.connectors.append({'source': source, 'target': target, 'label': label, 'style': style})

    # --- layout ---------------------------------------------------------

    def _place(self):
        y = self.margin
        if self.title:
            y += lineh('title') + GAP_MIN
        for index, (cards, gap) in enumerate(self.rows):
            x = self.margin
            for card in cards:
                card.measure()
            # Equalised height keeps neighbouring cards' edges straight; a row of
            # ragged bottoms reads as unrelated boxes.
            height = max(card.height for card in cards)
            for position, card in enumerate(cards):
                card.x, card.y, card.height = x, y, height
                card.identifier = f'card-{index}-{position}'
                x += card.width + gap
            y += height + 64
        self.width = round(max(
            [self.margin * 2] +
            [card.x + card.width + self.margin for cards, _gap in self.rows for card in cards] +
            ([self.margin * 2 + cellw(self.title, 'title')] if self.title else [])
        ))
        self.height = round(y - 64 + self.margin)

    # --- checks ---------------------------------------------------------

    def _fail(self, message):
        self.problems.append(message)

    def _check_text(self):
        for cards, _gap in self.rows:
            for card in cards:
                inner = card.width - 2 * CARD_PADDING
                for role, text, mono in card.texts():
                    for bad in emoji_chars(text):
                        self._fail(f'[emoji 豆腐块] {card.identifier} 的 "{text[:24]}" 含 U+{ord(bad):04X}')
                    if FONT[role] < FONT_MINIMUM[role]:
                        self._fail(f'[字号过小] role={role} {FONT[role]} < {FONT_MINIMUM[role]}')
                    needed = cellw(text, role, mono)
                    if needed > inner + 0.01:
                        self._fail(f'[文字超宽] {card.identifier} "{text[:30]}" 需 {needed:.0f}px > 可用 {inner:.0f}px')
        if self.title:
            for bad in emoji_chars(self.title):
                self._fail(f'[emoji 豆腐块] 图标题含 U+{ord(bad):04X}')

    def _check_geometry(self):
        boxes = [(card.identifier, card.x, card.y, card.width, card.height)
                 for cards, _gap in self.rows for card in cards]
        for index, first in enumerate(boxes):
            for second in boxes[index + 1:]:
                dx = min(first[1] + first[3], second[1] + second[3]) - max(first[1], second[1])
                dy = min(first[2] + first[4], second[2] + second[4]) - max(first[2], second[2])
                if dx > OVERLAP_TOLERANCE and dy > OVERLAP_TOLERANCE:
                    self._fail(f'[卡片重叠] {first[0]} 与 {second[0]}')
        for cards, gap in self.rows:
            for left, right in zip(cards, cards[1:]):
                actual = right.x - (left.x + left.width)
                if not GAP_MIN <= actual <= GAP_MAX:
                    self._fail(f'[间距越界] {left.identifier}→{right.identifier} {actual:g}px 不在 {GAP_MIN}..{GAP_MAX}')
        content_right = max((card.x + card.width for cards, _g in self.rows for card in cards), default=0)
        content_bottom = max((card.y + card.height for cards, _g in self.rows for card in cards), default=0)
        for name, value in (('右', self.width - content_right), ('下', self.height - content_bottom)):
            if not MARGIN_MIN <= value <= MARGIN_MAX:
                self._fail(f'[画布留白] {name}边距 {value:g}px 不在 {MARGIN_MIN}..{MARGIN_MAX}')
        # Same line the SVG route holds: a strip this wide is scaled down to
        # illegibility the moment a page embeds it at column width. Split the
        # cards across more rows instead.
        ratio = self.width / self.height if self.height else 0
        if ratio > TOKENS['maxAspectRatio']:
            self._fail(f'[画布过宽] {self.width:g}x{self.height:g} 宽高比 {ratio:.2f} > {TOKENS["maxAspectRatio"]}，请拆成多行')

    def _check_connectors(self):
        cards = {id(card): card for cards, _gap in self.rows for card in cards}
        for connector in self.connectors:
            for end in ('source', 'target'):
                if id(connector[end]) not in cards:
                    raise ValueError(f'connector {end} was never placed in a row')
            for point_a, point_b in zip(connector['points'], connector['points'][1:]):
                for card in cards.values():
                    if _crosses(point_a, point_b, card):
                        self._fail(
                            f'[连线穿卡] {connector["source"].identifier}→{connector["target"].identifier} '
                            f'穿过 {card.identifier}'
                        )

    def _route(self):
        for connector in self.connectors:
            source, target = connector['source'], connector['target']
            same_row = any(source in cards and target in cards for cards, _gap in self.rows)
            if same_row:
                y = round(max(source.y, target.y) + min(source.height, target.height) / 2)
                left, right = (source, target) if source.x < target.x else (target, source)
                gutter_start = left.x + left.width
                gutter_end = right.x
                if gutter_end - gutter_start < 8:
                    raise ValueError('connected cards are not separated by a gutter; place them apart')
                connector['points'] = [(gutter_start + 2, y), (gutter_end - 2, y)]
                continue
            # Row to row: drop into the vertical gap between the two rows and
            # cross there, where no card can be in the way.
            upper, lower = (source, target) if source.y < target.y else (target, source)
            lane = round((upper.y + upper.height + lower.y) / 2)
            if lane <= upper.y + upper.height or lane >= lower.y:
                raise ValueError('connected rows are not separated by a lane; keep them in separate rows')
            connector['points'] = [
                (round(upper.x + upper.width / 2), lane),
                (round(lower.x + lower.width / 2), lane),
            ]

    # --- emit -----------------------------------------------------------

    def _cell(self, identifier, role, group, value, style, parent, rect):
        return (f'        <mxCell id="{esc(identifier)}" value="{esc(value)}" '
                f'style="{esc(style)}" vertex="1" parent="{esc(parent)}" '
                f'data-role="{esc(role)}" data-diagram-group="{esc(group)}">'
                f'<mxGeometry x="{rect[0]:g}" y="{rect[1]:g}" width="{rect[2]:g}" height="{rect[3]:g}" '
                f'as="geometry"/></mxCell>')

    def _text_style(self, role, mono):
        weight = 'fontStyle=1;' if role in BOLD_ROLES else ''
        colour = {'status': '#475569', 'badge': '#1d4ed8', 'note': '#475569'}.get(role, '#1f2937')
        return (f'text;html=0;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;'
                f'fontFamily={MONO_FAMILY if mono else FAMILY};{weight}fontColor={colour};'
                f'fontSize={FONT[role]};role={role}')

    def _card_cells(self, card, row_group):
        tone = TONE.get(card.tone, TONE['process']).replace(',', ';')
        cells = [self._cell(card.identifier, 'card', row_group, '',
                            f'rounded=1;arcSize=14;html=0;strokeWidth=2;{tone};role=card',
                            '1', (card.x, card.y, card.width, card.height))]
        inner = card.width - 2 * CARD_PADDING
        offset = CARD_PADDING
        index = 0
        for role, text, mono in card.texts():
            if role == 'status':
                offset += DIVIDER_GAP
                cells.append(self._cell(f'{card.identifier}-divider', 'divider', card.identifier, '',
                                        'shape=line;strokeWidth=1;strokeColor=#cbd5e1;role=divider',
                                        card.identifier, (CARD_PADDING, offset, inner, 1)))
                offset += 1 + DIVIDER_GAP
            cells.append(self._cell(f'{card.identifier}-{index}', role, card.identifier, text,
                                    self._text_style(role, mono), card.identifier,
                                    (CARD_PADDING, offset, inner, lineh(role))))
            offset += lineh(role)
            index += 1
        return cells

    def _connector_cells(self):
        cells = []
        for index, connector in enumerate(self.connectors):
            dashed = 'dashed=1;strokeColor=#ea580c;' if connector['style'] == 'dashed' else 'strokeColor=#475569;'
            points = ''.join(f'<mxPoint x="{x:g}" y="{y:g}"/>' for x, y in connector['points'])
            cells.append(
                f'        <mxCell id="edge-{index}" value="{esc(connector["label"] or "")}" '
                f'style="edgeStyle=orthogonalEdgeStyle;rounded=0;endArrow=block;endFill=1;'
                f'fontFamily={FAMILY};fontSize=16;labelBackgroundColor=#ffffff;{dashed}role=connector" '
                f'edge="1" parent="1" source="{esc(connector["source"].identifier)}" '
                f'target="{esc(connector["target"].identifier)}" data-role="connector" '
                f'data-diagram-group="connectors">'
                f'<mxGeometry y="{LABEL_OFFSET if connector["label"] else 0}" relative="1" as="geometry">'
                f'<Array as="points">{points}</Array></mxGeometry></mxCell>'
            )
        return cells

    def save(self, path, strict=True):
        self._place()
        self._route()
        self.problems = []
        self._check_text()
        self._check_geometry()
        self._check_connectors()

        cells = []
        if self.title:
            cells.append(self._cell('figure-title', 'title', 'header', self.title,
                                    self._text_style('title', False), '1',
                                    (self.margin, self.margin, round(cellw(self.title, 'title')), lineh('title'))))
        for index, (cards, _gap) in enumerate(self.rows):
            for card in cards:
                cells.extend(self._card_cells(card, f'row-{index}'))
        cells.extend(self._connector_cells())

        xml = '\n'.join([
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<mxfile host="app.diagrams.net" agent="drawiokit" type="device">',
            f'  <diagram id="{esc(self.identifier)}" name="{esc(self.identifier)}">',
            f'    <mxGraphModel page="1" pageScale="1" pageWidth="{self.width:g}" pageHeight="{self.height:g}">',
            '      <root>',
            '        <mxCell id="0"/>',
            '        <mxCell id="1" parent="0"/>',
            *cells,
            '      </root>',
            '    </mxGraphModel>',
            '  </diagram>',
            '</mxfile>',
            '',
        ])
        Path(path).write_text(xml, encoding='utf-8')
        if strict and self.problems:
            detail = '\n  '.join(self.problems)
            raise RuntimeError(f'{path}: 自检未通过, {len(self.problems)} 处问题\n  {detail}')
        return path


def _crosses(start, end, card):
    """Liang-Barsky against the card interior, matching the linter's test."""
    low, high = 0.0, 1.0
    for origin, delta, minimum, maximum in (
        (start[0], end[0] - start[0], card.x, card.x + card.width),
        (start[1], end[1] - start[1], card.y, card.y + card.height),
    ):
        if delta == 0:
            if origin <= minimum or origin >= maximum:
                return False
            continue
        first, second = sorted(((minimum - origin) / delta, (maximum - origin) / delta))
        low, high = max(low, first), min(high, second)
        if low >= high:
            return False
    return high - low > 1e-6 and high > 0.0 and low < 1.0


def measure(card):
    """Card size without drawing it. Shares Card.measure so probe and draw agree."""
    card.measure()
    return card.width, card.height
