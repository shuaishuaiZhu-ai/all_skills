#!/usr/bin/env python3
"""Lint uncompressed Draw.io diagrams for formal layout regressions."""

from __future__ import annotations

import argparse
import itertools
import math
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from html import unescape
from pathlib import Path


ROOT_IDS = {"0", "1"}
ANCHOR_ROLES = {"card", "module", "node", "panel", "note"}
FONT_MINIMUMS = {
    "badge": 16.0,
    "body": 18.0,
    "status": 16.0,
    "note": 16.0,
    "table-cell": 14.0,
    "title": 24.0,
    "section-title": 24.0,
}
MARGIN_MINIMUM = 40.0
MARGIN_MAXIMUM = 80.0
INSET_PARENT_PADDING = 32.0
EDGE_LABEL_CLEARANCE = 16.0
INSET_PARENT_ROLES = {
    "badge": {"card"},
    "note": {"card", "panel"},
}
# Draw.io stores the label as a cell property, so an oversized single-line label
# renders past the shape outline without changing any geometry. Estimate advance
# width from the font size: full-width/CJK glyphs take about one em, others 0.55.
DEFAULT_FONT_SIZE = 12.0
WIDE_GLYPH_EM = 1.0
NARROW_GLYPH_EM = 0.55
# Monospace advance is wider than proportional sans. Courier New and DejaVu Sans
# Mono both advance 0.60 em; a Draw.io PNG export measured 0.592 em of ink for a
# 36-character label at fontSize 20, so 0.60 em models the advance without
# overestimating (an overestimate would turn this check into a false positive).
MONO_GLYPH_EM = 0.60
MONO_FAMILY_MARKERS = ("mono", "courier", "consolas", "menlo")
# CSS "line-height: normal" for Draw.io HTML labels is about 1.2 em. Using the
# lower bound keeps the wrapped-height check from firing on borderline layouts.
WRAPPED_LINE_HEIGHT = 1.2
# Below this usable height a cell was never sized to hold a text row at all; that
# is a geometry defect owned by the bounds and status-order checks.
DEGENERATE_TEXT_HEIGHT = 12.0
BOLD_WIDTH_FACTOR = 1.05
LABEL_PADDING = 4.0
TEXT_OVERFLOW_TOLERANCE = 0.02


@dataclass(frozen=True)
class Rect:
    x: float
    y: float
    width: float
    height: float

    @property
    def right(self) -> float:
        return self.x + self.width

    @property
    def bottom(self) -> float:
        return self.y + self.height


@dataclass
class Cell:
    identifier: str
    parent: str | None
    source: str | None
    target: str | None
    role: str | None
    group: str | None
    value: str | None
    style: dict[str, str]
    geometry: ET.Element | None
    vertex: bool
    edge: bool
    visible: bool


@dataclass(frozen=True)
class ExplicitPoint:
    kind: str
    x: float
    y: float


class DiagramError(Exception):
    """An expected, user-actionable Draw.io input error."""


def local_name(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def named_children(element: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in element if local_name(child) == name]


def named_child(element: ET.Element, name: str) -> ET.Element | None:
    children = named_children(element, name)
    return children[0] if children else None


def parse_style(style: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for token in style.split(";"):
        if "=" in token:
            key, value = token.split("=", 1)
            values[key.strip()] = value.strip()
    return values


def number(value: str | None, default: float = 0.0) -> float:
    try:
        return float(value) if value is not None else default
    except ValueError as exc:
        raise DiagramError(f"invalid number {value!r}") from exc


def first_value(*values: str | None) -> str | None:
    return next((value for value in values if value is not None), None)


def is_visible(element: ET.Element, style: dict[str, str]) -> bool:
    return (
        element.get("visible") != "0"
        and style.get("visible") != "0"
        and style.get("opacity") != "0"
    )


def parse_diagram(path: Path) -> tuple[dict[str, Cell], float, float]:
    try:
        document = ET.parse(path)
    except (ET.ParseError, OSError) as exc:
        raise DiagramError(f"cannot parse XML: {exc}") from exc
    mxfile = document.getroot()
    diagrams = named_children(mxfile, "diagram")
    if len(diagrams) != 1:
        raise DiagramError(f"expected exactly one diagram, found {len(diagrams)}")
    model = named_child(diagrams[0], "mxGraphModel")
    if model is None:
        raise DiagramError("compressed-or-unsupported diagram XML")
    root = named_child(model, "root")
    if root is None:
        raise DiagramError("missing mxGraphModel root")

    cells: dict[str, Cell] = {}
    for child in root:
        wrapper: ET.Element | None = None
        if local_name(child) == "mxCell":
            cell_element = child
        elif local_name(child) in {"object", "UserObject"}:
            wrapper = child
            cell_element = named_child(wrapper, "mxCell")
            if cell_element is None:
                raise DiagramError(f"{local_name(wrapper)} without mxCell")
        else:
            continue

        wrapper_style = parse_style(wrapper.get("style", "") if wrapper is not None else "")
        cell_style = parse_style(cell_element.get("style", ""))
        style = {**wrapper_style, **cell_style}
        identifier = first_value(wrapper.get("id") if wrapper is not None else None, cell_element.get("id"))
        if not identifier:
            raise DiagramError("mxCell without id")
        if identifier in cells:
            raise DiagramError(f"duplicate cell id {identifier}")
        wrapper_role = wrapper.get("data-role") if wrapper is not None else None
        wrapper_group = wrapper.get("data-diagram-group") if wrapper is not None else None
        cells[identifier] = Cell(
            identifier=identifier,
            parent=first_value(cell_element.get("parent"), wrapper.get("parent") if wrapper is not None else None),
            source=first_value(cell_element.get("source"), wrapper.get("source") if wrapper is not None else None),
            target=first_value(cell_element.get("target"), wrapper.get("target") if wrapper is not None else None),
            role=first_value(wrapper_role, cell_element.get("data-role"), wrapper_style.get("role"), cell_style.get("role")),
            group=first_value(wrapper_group, cell_element.get("data-diagram-group"), wrapper_style.get("diagramGroup"), cell_style.get("diagramGroup")),
            value=first_value(wrapper.get("value") if wrapper is not None else None, cell_element.get("value")),
            style=style,
            geometry=named_child(cell_element, "mxGeometry"),
            vertex=cell_element.get("vertex") == "1",
            edge=cell_element.get("edge") == "1",
            visible=is_visible(cell_element, style) and (wrapper is None or is_visible(wrapper, wrapper_style)),
        )
    return cells, number(model.get("pageWidth")), number(model.get("pageHeight"))


def geometry_of(cell: Cell) -> Rect | None:
    if cell.geometry is None or cell.edge:
        return None
    return Rect(
        number(cell.geometry.get("x")),
        number(cell.geometry.get("y")),
        number(cell.geometry.get("width")),
        number(cell.geometry.get("height")),
    )


def parent_chain(cell: Cell, cells: dict[str, Cell]) -> list[Cell]:
    chain: list[Cell] = []
    seen = {cell.identifier}
    parent_id = cell.parent
    while parent_id and parent_id not in ROOT_IDS:
        if parent_id in seen:
            raise DiagramError(f"parent cycle at {cell.identifier}")
        parent = cells.get(parent_id)
        if parent is None:
            raise DiagramError(f"missing parent {parent_id} for {cell.identifier}")
        chain.append(parent)
        seen.add(parent_id)
        parent_id = parent.parent
    return chain


def absolute_offset(cell: Cell, cells: dict[str, Cell]) -> tuple[float, float]:
    x = y = 0.0
    for parent in parent_chain(cell, cells):
        parent_rect = geometry_of(parent)
        if parent_rect is not None:
            x += parent_rect.x
            y += parent_rect.y
    return x, y


def absolute_rect(cell: Cell, cells: dict[str, Cell]) -> Rect | None:
    rect = geometry_of(cell)
    if rect is None:
        return None
    x, y = absolute_offset(cell, cells)
    return Rect(rect.x + x, rect.y + y, rect.width, rect.height)


def is_effectively_visible(cell: Cell, cells: dict[str, Cell]) -> bool:
    """A Draw.io cell is visible only when it and every logical ancestor are visible."""
    return cell.visible and all(parent.visible for parent in parent_chain(cell, cells))


def visible_vertices(cells: dict[str, Cell]) -> list[Cell]:
    return [
        cell
        for cell in cells.values()
        if cell.vertex and is_effectively_visible(cell, cells) and geometry_of(cell) is not None
    ]


def is_ancestor(first: Cell, second: Cell, cells: dict[str, Cell]) -> bool:
    return any(parent.identifier == first.identifier for parent in parent_chain(second, cells))


def point_from_element(element: ET.Element | None) -> tuple[float, float] | None:
    if element is None:
        return None
    return number(element.get("x")), number(element.get("y"))


def explicit_point(kind: str, element: ET.Element | None) -> ExplicitPoint | None:
    point = point_from_element(element)
    return ExplicitPoint(kind, *point) if point is not None else None


def validate_terminal_references(cells: dict[str, Cell]) -> None:
    for edge in (cell for cell in cells.values() if cell.edge):
        for kind, identifier in (("source", edge.source), ("target", edge.target)):
            if identifier is None:
                continue
            terminal = cells.get(identifier)
            if terminal is None:
                raise DiagramError(f"dangling {kind} terminal {identifier} for {edge.identifier}")
            if not terminal.vertex:
                raise DiagramError(f"invalid {kind} terminal {identifier} for {edge.identifier}")


def local_edge_path(edge: Cell) -> tuple[list[ExplicitPoint], list[tuple[ExplicitPoint, ExplicitPoint]]]:
    geometry = edge.geometry
    if geometry is None:
        return [], []
    source_point = explicit_point("sourcePoint", next((point for point in named_children(geometry, "mxPoint") if point.get("as") == "sourcePoint"), None))
    target_point = explicit_point("targetPoint", next((point for point in named_children(geometry, "mxPoint") if point.get("as") == "targetPoint"), None))
    waypoints = [
        explicit_point("waypoint", point)
        for array in named_children(geometry, "Array") if array.get("as") == "points"
        for point in named_children(array, "mxPoint")
    ]
    points = [point for point in [source_point if edge.source is None else None, *waypoints, target_point if edge.target is None else None] if point is not None]
    if edge.source is None and edge.target is None and not points and geometry.get("relative") != "1" and all(
        geometry.get(attribute) is not None for attribute in ("x", "y", "width", "height")
    ):
        start_x, start_y = number(geometry.get("x")), number(geometry.get("y"))
        points = [
            ExplicitPoint("absolute-start", start_x, start_y),
            ExplicitPoint("absolute-end", start_x + number(geometry.get("width")), start_y + number(geometry.get("height"))),
        ]
    return points, list(zip(points, points[1:]))


def absolute_edge_points(edge: Cell, cells: dict[str, Cell]) -> list[ExplicitPoint]:
    offset_x, offset_y = absolute_offset(edge, cells)
    return [ExplicitPoint(point.kind, point.x + offset_x, point.y + offset_y) for point in local_edge_path(edge)[0]]


def absolute_edge_segments(edge: Cell, cells: dict[str, Cell]) -> list[tuple[ExplicitPoint, ExplicitPoint]]:
    offset_x, offset_y = absolute_offset(edge, cells)
    return [
        (ExplicitPoint(first.kind, first.x + offset_x, first.y + offset_y), ExplicitPoint(second.kind, second.x + offset_x, second.y + offset_y))
        for first, second in local_edge_path(edge)[1]
    ]


def stroke_extent(cell: Cell) -> float:
    if cell.style.get("strokeColor") == "none":
        return 0.0
    return max(0.0, number(cell.style.get("strokeWidth"), 1.0) / 2.0)


def arrow_extent(cell: Cell, end: str) -> float:
    arrow = cell.style.get(f"{end}Arrow")
    if not arrow or arrow == "none":
        return 0.0
    return max(0.0, number(cell.style.get(f"{end}Size"), 6.0))


def point_extent(cell: Cell, point: ExplicitPoint) -> float:
    extent = stroke_extent(cell)
    if point.kind == "sourcePoint":
        extent += arrow_extent(cell, "start")
    if point.kind == "targetPoint":
        extent += arrow_extent(cell, "end")
    return extent


def expanded(rect: Rect, extent: float) -> Rect:
    return Rect(rect.x - extent, rect.y - extent, rect.width + 2 * extent, rect.height + 2 * extent)


def overlaps(first: Rect, second: Rect) -> bool:
    return min(first.right, second.right) - max(first.x, second.x) > 2.0 and min(first.bottom, second.bottom) - max(first.y, second.y) > 2.0


def union(rectangles: list[Rect]) -> Rect:
    left, top = min(rect.x for rect in rectangles), min(rect.y for rect in rectangles)
    return Rect(left, top, max(rect.right for rect in rectangles) - left, max(rect.bottom for rect in rectangles) - top)


def segment_crosses_interior(start: tuple[float, float], end: tuple[float, float], rect: Rect) -> bool:
    dx, dy = end[0] - start[0], end[1] - start[1]
    low, high = 0.0, 1.0
    for origin, delta, minimum, maximum in ((start[0], dx, rect.x, rect.right), (start[1], dy, rect.y, rect.bottom)):
        if delta == 0:
            if origin <= minimum or origin >= maximum:
                return False
            continue
        first, second = sorted(((minimum - origin) / delta, (maximum - origin) / delta))
        low, high = max(low, first), min(high, second)
        if low >= high:
            return False
    return high - low > 1e-6 and high > 0.0 and low < 1.0


def structural_table_pair(first: Cell, second: Cell, first_rect: Rect, second_rect: Rect) -> bool:
    if first.role != "table-cell" or second.role != "table-cell" or first.parent != second.parent:
        return False
    vertical_overlap = min(first_rect.bottom, second_rect.bottom) > max(first_rect.y, second_rect.y)
    horizontal_overlap = min(first_rect.right, second_rect.right) > max(first_rect.x, second_rect.x)
    horizontal_boundary = min(abs(first_rect.right - second_rect.x), abs(second_rect.right - first_rect.x)) <= 2.0
    vertical_boundary = min(abs(first_rect.bottom - second_rect.y), abs(second_rect.bottom - first_rect.y)) <= 2.0
    return (vertical_overlap and horizontal_boundary) or (horizontal_overlap and vertical_boundary)


def logical_card(cell: Cell, cells: dict[str, Cell]) -> Cell | None:
    for parent in parent_chain(cell, cells):
        if parent.role == "card":
            return parent
    return None


def is_wide_glyph(character: str) -> bool:
    return unicodedata.east_asian_width(character) in {"W", "F"}


def label_lines(value: str) -> list[str]:
    """Split a Draw.io label into rendered lines, dropping markup and entities."""
    text = re.sub(r"(?i)<\s*br\s*/?\s*>", "\n", value)
    text = re.sub(r"(?i)</\s*(div|p|li|tr)\s*>", "\n", text)
    text = re.sub(r"<[^>]*>", "", text)
    text = unescape(text).replace(" ", " ")
    return [line.strip() for line in text.split("\n")]


def is_monospace(family: str | None) -> bool:
    lowered = (family or "").lower()
    return any(marker in lowered for marker in MONO_FAMILY_MARKERS)


def estimate_text_width(text: str, font_size: float, bold: bool, monospace: bool = False) -> float:
    narrow = MONO_GLYPH_EM if monospace else NARROW_GLYPH_EM
    ems = sum(WIDE_GLYPH_EM if is_wide_glyph(character) else narrow for character in text)
    width = ems * font_size
    return width * BOLD_WIDTH_FACTOR if bold else width


def wrap_tokens(line: str) -> list[str]:
    """Split a line into wrap units: whole words for narrow runs, single wide glyphs."""
    tokens: list[str] = []
    buffer = ""
    for character in line:
        if is_wide_glyph(character):
            if buffer:
                tokens.append(buffer)
                buffer = ""
            tokens.append(character)
        elif character == " ":
            if buffer:
                tokens.append(buffer)
                buffer = ""
        else:
            buffer += character
    if buffer:
        tokens.append(buffer)
    return tokens


def wrapped_line_count(line: str, available: float, font_size: float, bold: bool, monospace: bool) -> int:
    """Greedily wrap one logical line and return how many rendered lines it needs."""
    space = estimate_text_width(" ", font_size, bold, monospace)
    rows = 1
    used = 0.0
    for token in wrap_tokens(line):
        width = estimate_text_width(token, font_size, bold, monospace)
        separator = 0.0 if used == 0.0 or is_wide_glyph(token[0]) else space
        if used > 0.0 and used + separator + width > available:
            rows += 1
            used = width
        else:
            used += separator + width
    return rows


def label_overflow(cell: Cell) -> tuple[str, str, float, float] | None:
    """Return (axis, detail-text, needed, available) when a label exceeds its cell."""
    if not cell.vertex or not cell.value or not cell.value.strip():
        return None
    style = cell.style
    if "labelPosition" in style or "verticalLabelPosition" in style:
        return None
    if style.get("overflow") == "hidden":
        return None
    rect = geometry_of(cell)
    if rect is None or rect.width <= 0 or rect.height <= 0:
        return None
    font_size = number(style.get("fontSize"), DEFAULT_FONT_SIZE)
    if font_size <= 0:
        return None
    bold = int(number(style.get("fontStyle"), 0.0)) & 1 == 1
    monospace = is_monospace(style.get("fontFamily"))
    horizontal_spacing = number(style.get("spacingLeft"), 0.0) + number(style.get("spacingRight"), 0.0)
    width_available = rect.width - 2 * LABEL_PADDING - horizontal_spacing
    if width_available <= 0:
        return None
    lines = [line for line in label_lines(cell.value) if line]
    if not lines:
        return None
    if style.get("whiteSpace") != "wrap":
        # Draw.io renders the label on one line, so it runs past the outline.
        allowance = max(4.0, width_available * TEXT_OVERFLOW_TOLERANCE)
        worst: tuple[str, str, float, float] | None = None
        for line in lines:
            needed = estimate_text_width(line, font_size, bold, monospace)
            if needed > width_available + allowance and (worst is None or needed > worst[2]):
                worst = ("horizontal", line, needed, width_available)
        return worst
    # Wrapped labels cannot overflow horizontally, but extra rendered rows push the
    # text block past the cell height.
    vertical_spacing = number(style.get("spacingTop"), 0.0) + number(style.get("spacingBottom"), 0.0)
    height_available = rect.height - 2 * LABEL_PADDING - vertical_spacing
    if height_available < DEGENERATE_TEXT_HEIGHT:
        # A cell this flat was never sized to hold text, so its geometry is the
        # defect and the bounds/order checks own it. Anything taller is judged on
        # whether the wrapped rows actually fit.
        return None
    rows = sum(wrapped_line_count(line, width_available, font_size, bold, monospace) for line in lines)
    needed_height = rows * font_size * WRAPPED_LINE_HEIGHT
    allowance = max(4.0, height_available * TEXT_OVERFLOW_TOLERANCE)
    if needed_height > height_available + allowance:
        return ("vertical", f"{rows} wrapped rows", needed_height, height_available)
    return None


def format_rect(rect: Rect) -> str:
    return f"({rect.x:g},{rect.y:g},{rect.width:g},{rect.height:g})"


def lint(path: Path, strict: bool) -> list[str]:
    cells, page_width, page_height = parse_diagram(path)
    validate_terminal_references(cells)
    vertices = visible_vertices(cells)
    rectangles = {cell.identifier: absolute_rect(cell, cells) for cell in vertices}
    findings: list[tuple[str, str, str]] = []

    def report(code: str, identity: str, detail: str) -> None:
        findings.append((code, identity, f"ERROR {code} {identity}: {detail}"))

    page_violation = False
    for cell in vertices:
        rect = rectangles[cell.identifier]
        assert rect is not None
        visual = expanded(rect, stroke_extent(cell))
        if visual.x < 0 or visual.y < 0 or visual.right > page_width or visual.bottom > page_height:
            page_violation = True
            report("E_PAGE_BOUNDS", cell.identifier, f"rect={format_rect(rect)} page=(0,0,{page_width:g},{page_height:g})")
        if cell.parent and cell.parent not in ROOT_IDS:
            parent = cells.get(cell.parent)
            parent_rect = geometry_of(parent) if parent is not None else None
            local = geometry_of(cell)
            if parent_rect is not None and local is not None and (local.x < 0 or local.y < 0 or local.right > parent_rect.width or local.bottom > parent_rect.height):
                report("E_PARENT_BOUNDS", cell.identifier, f"parent={parent.identifier} local={format_rect(local)} parent-size=({parent_rect.width:g},{parent_rect.height:g})")
            allowed_parent_roles = INSET_PARENT_ROLES.get(cell.role or "")
            if (
                strict
                and allowed_parent_roles is not None
                and parent is not None
                and parent.role in allowed_parent_roles
                and parent.style.get("rounded") == "1"
                and parent_rect is not None
                and local is not None
            ):
                padding = (local.x, local.y, parent_rect.width - local.right, parent_rect.height - local.bottom)
                if any(value < INSET_PARENT_PADDING for value in padding):
                    report(
                        "E_PARENT_PADDING",
                        cell.identifier,
                        f"parent={parent.identifier} padding=({','.join(f'{value:g}' for value in padding)}) minimum={INSET_PARENT_PADDING:g}",
                    )

    for edge in (cell for cell in cells.values() if cell.edge and is_effectively_visible(cell, cells)):
        if strict and edge.value and edge.value.strip():
            offset = number(edge.geometry.get("y")) if edge.geometry is not None else 0.0
            if abs(offset) < EDGE_LABEL_CLEARANCE:
                report(
                    "E_EDGE_LABEL_INLINE",
                    edge.identifier,
                    f"label-offset={offset:g} minimum={EDGE_LABEL_CLEARANCE:g}",
                )
        local_points, _segments = local_edge_path(edge)
        absolute_points = absolute_edge_points(edge, cells)
        for point in absolute_points:
            extent = point_extent(edge, point)
            if point.x - extent < 0 or point.y - extent < 0 or point.x + extent > page_width or point.y + extent > page_height:
                page_violation = True
                report("E_PAGE_BOUNDS", edge.identifier, f"point=({point.x:g},{point.y:g}) page=(0,0,{page_width:g},{page_height:g})")
                break
        if edge.parent and edge.parent not in ROOT_IDS:
            parent = cells.get(edge.parent)
            parent_rect = geometry_of(parent) if parent is not None else None
            if parent_rect is not None:
                for point in local_points:
                    extent = point_extent(edge, point)
                    if point.x - extent < 0 or point.y - extent < 0 or point.x + extent > parent_rect.width or point.y + extent > parent_rect.height:
                        report("E_PARENT_BOUNDS", edge.identifier, f"parent={parent.identifier} point=({point.x:g},{point.y:g}) parent-size=({parent_rect.width:g},{parent_rect.height:g})")
                        break

    if strict and not page_violation:
        content: list[Rect] = [
            expanded(rectangles[cell.identifier], stroke_extent(cell))
            for cell in vertices if cell.parent in ROOT_IDS and rectangles[cell.identifier] is not None
        ]
        for edge in (
            cell
            for cell in cells.values()
            if cell.edge and is_effectively_visible(cell, cells) and cell.parent in ROOT_IDS
        ):
            points = absolute_edge_points(edge, cells)
            for point in points:
                extent = point_extent(edge, point)
                content.append(Rect(point.x - extent, point.y - extent, 2 * extent, 2 * extent))
        if content:
            bounds = union(content)
            margins = (bounds.x, bounds.y, page_width - bounds.right, page_height - bounds.bottom)
            if any(margin < MARGIN_MINIMUM or margin > MARGIN_MAXIMUM for margin in margins):
                report("E_CANVAS_WHITESPACE", "page", f"content={format_rect(bounds)} margins=({','.join(f'{margin:g}' for margin in margins)})")

    if strict:
        groups: dict[tuple[str | None, str], list[Cell]] = {}
        for cell in vertices:
            if cell.group and cell.role in ANCHOR_ROLES:
                groups.setdefault((cell.parent, cell.group), []).append(cell)
        for (_parent, group), members in groups.items():
            for first, second in itertools.combinations(members, 2):
                first_rect, second_rect = rectangles[first.identifier], rectangles[second.identifier]
                assert first_rect is not None and second_rect is not None
                vertical_overlap = min(first_rect.bottom, second_rect.bottom) > max(first_rect.y, second_rect.y)
                horizontal_overlap = min(first_rect.right, second_rect.right) > max(first_rect.x, second_rect.x)
                if vertical_overlap:
                    axis = "horizontal"
                    gap = max(first_rect.x, second_rect.x) - min(first_rect.right, second_rect.right)
                    occluded = any(
                        other.identifier not in (first.identifier, second.identifier)
                        and min(first_rect.x, second_rect.x) < other_rect.x < max(first_rect.x, second_rect.x)
                        and min(other_rect.bottom, first_rect.bottom) > max(other_rect.y, first_rect.y)
                        and min(other_rect.bottom, second_rect.bottom) > max(other_rect.y, second_rect.y)
                        for other in members for other_rect in [rectangles[other.identifier]]
                    )
                elif horizontal_overlap:
                    axis = "vertical"
                    gap = max(first_rect.y, second_rect.y) - min(first_rect.bottom, second_rect.bottom)
                    occluded = any(
                        other.identifier not in (first.identifier, second.identifier)
                        and min(first_rect.y, second_rect.y) < other_rect.y < max(first_rect.y, second_rect.y)
                        and min(other_rect.right, first_rect.right) > max(other_rect.x, first_rect.x)
                        and min(other_rect.right, second_rect.right) > max(other_rect.x, second_rect.x)
                        for other in members for other_rect in [rectangles[other.identifier]]
                    )
                else:
                    axis = "diagonal"
                    horizontal_gap = max(first_rect.x, second_rect.x) - min(first_rect.right, second_rect.right)
                    vertical_gap = max(first_rect.y, second_rect.y) - min(first_rect.bottom, second_rect.bottom)
                    gap = math.hypot(horizontal_gap, vertical_gap)
                    occluded = False
                if occluded or gap < 0:
                    continue
                identity = ",".join(sorted((first.identifier, second.identifier)))
                detail = f"cells={identity} group={group} axis={axis} gap={gap:g}"
                if gap < 32.0:
                    report("E_GAP_SMALL", identity, detail)
                elif gap > 120.0:
                    report("E_GAP_LARGE", identity, detail)
        for cell in vertices:
            minimum = FONT_MINIMUMS.get(cell.role or "")
            if minimum is not None and number(cell.style.get("fontSize"), 0.0) < minimum:
                size = number(cell.style.get("fontSize"), 0.0)
                report("E_FONT_SMALL", cell.identifier, f"role={cell.role} fontSize={size:g} minimum={minimum:g}")
        for cell in vertices:
            overflow = label_overflow(cell)
            if overflow is not None:
                axis, subject, needed, available = overflow
                excerpt = subject if len(subject) <= 40 else f"{subject[:40]}..."
                hint = (
                    "widen the cell, reduce fontSize, or set whiteSpace=wrap"
                    if axis == "horizontal"
                    else "increase the cell height or shorten the text"
                )
                report(
                    "E_TEXT_OVERFLOW",
                    cell.identifier,
                    f"axis={axis} needed={needed:.0f} available={available:.0f} subject={excerpt!r} hint={hint}",
                )

    for status in (cell for cell in vertices if cell.role == "status"):
        container = logical_card(status, cells)
        status_rect = rectangles[status.identifier]
        assert status_rect is not None
        if container is None:
            continue
        dividers = [cell for cell in vertices if cell.role == "divider" and logical_card(cell, cells) == container]
        if not dividers:
            continue
        divider = max(dividers, key=lambda cell: (rectangles[cell.identifier].bottom, cell.identifier))
        divider_rect = rectangles[divider.identifier]
        assert divider_rect is not None
        if status_rect.y < divider_rect.bottom + 8.0:
            report("E_STATUS_ORDER", status.identifier, f"divider={divider.identifier} status-top={status_rect.y:g} divider-bottom={divider_rect.bottom:g}")

    for index, first in enumerate(vertices):
        first_rect = rectangles[first.identifier]
        assert first_rect is not None
        for second in vertices[index + 1:]:
            second_rect = rectangles[second.identifier]
            assert second_rect is not None
            if is_ancestor(first, second, cells) or is_ancestor(second, first, cells) or structural_table_pair(first, second, first_rect, second_rect):
                continue
            if overlaps(first_rect, second_rect):
                report("E_OVERLAP", f"{first.identifier},{second.identifier}", f"rects={format_rect(first_rect)},{format_rect(second_rect)}")

    for edge in (cell for cell in cells.values() if cell.edge and is_effectively_visible(cell, cells)):
        for start, end in absolute_edge_segments(edge, cells):
            for cell in vertices:
                if is_ancestor(cell, edge, cells):
                    continue
                rect = rectangles[cell.identifier]
                assert rect is not None
                if segment_crosses_interior((start.x, start.y), (end.x, end.y), rect):
                    report("E_EDGE_THROUGH", edge.identifier, f"segment=({start.x:g},{start.y:g})->({end.x:g},{end.y:g}) crosses={cell.identifier}")
                    break
            else:
                continue
            break

    return [message for _code, _identity, message in sorted(findings)]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("diagram", type=Path)
    parser.add_argument("--strict", action="store_true", help="apply formal quality thresholds")
    args = parser.parse_args(argv)
    try:
        findings = lint(args.diagram, args.strict)
    except DiagramError as exc:
        print(f"ERROR E_XML: {exc}")
        return 2
    for finding in findings:
        print(finding)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
