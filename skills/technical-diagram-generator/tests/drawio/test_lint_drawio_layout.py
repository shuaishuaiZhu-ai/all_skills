"""Black-box CLI coverage for the Draw.io formal-layout linter."""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path


TEST_DIR = Path(__file__).resolve().parent
REPOSITORY_ROOT = TEST_DIR.parents[3]
LINTER = REPOSITORY_ROOT / "skills" / "technical-diagram-generator" / "scripts" / "lint-drawio-layout.py"
VALID_FIXTURE = TEST_DIR / "valid-formal-flow.drawio"
INVALID_FIXTURES = {
    "invalid-page-boundary.drawio": "E_PAGE_BOUNDS",
    "invalid-parent-boundary.drawio": "E_PARENT_BOUNDS",
    "invalid-gap-small.drawio": "E_GAP_SMALL",
    "invalid-gap-large.drawio": "E_GAP_LARGE",
    "invalid-font-small.drawio": "E_FONT_SMALL",
    "invalid-status-order.drawio": "E_STATUS_ORDER",
    "invalid-overlap.drawio": "E_OVERLAP",
    "invalid-edge-through.drawio": "E_EDGE_THROUGH",
    "invalid-canvas-whitespace.drawio": "E_CANVAS_WHITESPACE",
    "invalid-text-overflow.drawio": "E_TEXT_OVERFLOW",
}
FIXTURE_MUTATION_PREFIXES = {
    "invalid-page-boundary.drawio": {"title:mxGeometry[geometry]/@x"},
    "invalid-parent-boundary.drawio": {"card-input-status:mxGeometry[geometry]/@width"},
    "invalid-gap-small.drawio": {"card-process:mxGeometry[geometry]/@x", "card-output:mxGeometry[geometry]/@x"},
    "invalid-gap-large.drawio": {"note-reading:mxGeometry[geometry]/@x"},
    "invalid-font-small.drawio": {"card-input-body:@style"},
    "invalid-status-order.drawio": {"card-input-status:mxGeometry[geometry]/@y", "card-input-status:mxGeometry[geometry]/@height"},
    "invalid-overlap.drawio": {"card-process:mxGeometry[geometry]/@x", "card-output:mxGeometry[geometry]/@x"},
    "invalid-edge-through.drawio": {"edge-input-process:mxGeometry[geometry]/"},
    "invalid-canvas-whitespace.drawio": {"@model:@pageWidth"},
    "invalid-text-overflow.drawio": {"card-process-body:@style"},
}


def run_linter(path: Path, *extra_args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(LINTER), str(path), *extra_args],
        check=False,
        text=True,
        capture_output=True,
        cwd=REPOSITORY_ROOT,
    )


def error_codes(result: subprocess.CompletedProcess[str]) -> set[str]:
    return set(re.findall(r"^ERROR (E_[A-Z_]+)\b", result.stdout, flags=re.MULTILINE))


def run_xml(source: str, *extra_args: str) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory() as temporary_directory:
        fixture = Path(temporary_directory) / "geometry-regression.drawio"
        fixture.write_text(source, encoding="utf-8")
        return run_linter(fixture, *extra_args)


def normalized_attribute_map(path: Path) -> dict[str, str | None]:
    model = ET.parse(path).getroot().find("./diagram/mxGraphModel")
    assert model is not None
    result = {"@model:@pageWidth": model.get("pageWidth"), "@model:@pageHeight": model.get("pageHeight")}
    root = model.find("root")
    assert root is not None

    def collect(identifier: str, element: ET.Element, prefix: str) -> None:
        for attribute, value in element.attrib.items():
            if attribute != "id":
                result[f"{identifier}:{prefix}@{attribute}"] = value
        for index, child in enumerate(element):
            label = child.tag
            if child.get("as"):
                label += f"[{child.get('as')}]"
            else:
                label += f"[{index}]"
            collect(identifier, child, f"{prefix}{label}/")

    for cell in root.findall("mxCell"):
        identifier = cell.get("id")
        assert identifier is not None
        collect(identifier, cell, "")
    return result


def logical_cell_ids(path: Path) -> set[str]:
    root = ET.parse(path).getroot().find("./diagram/mxGraphModel/root")
    assert root is not None
    identifiers: set[str] = set()
    for child in root:
        if child.tag == "mxCell":
            identifier = child.get("id")
        elif child.tag in {"object", "UserObject"}:
            inner = child.find("mxCell")
            identifier = child.get("id") or (inner.get("id") if inner is not None else None)
        else:
            continue
        assert identifier is not None
        identifiers.add(identifier)
    return identifiers


class DrawioLayoutLinterCliTests(unittest.TestCase):
    def test_valid_formal_flow_is_clean_in_strict_mode(self) -> None:
        """Catches a regression that rejects the formal reference fixture."""
        result = run_linter(VALID_FIXTURE, "--strict")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("ERROR", result.stdout)
        self.assertNotIn("WARNING", result.stdout)

    def test_each_adversarial_fixture_reports_only_its_intended_error(self) -> None:
        """Catches missing geometry/style checks and accidental extra findings."""
        for filename, expected_code in INVALID_FIXTURES.items():
            with self.subTest(fixture=filename):
                result = run_linter(TEST_DIR / filename, "--strict")

                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(error_codes(result), {expected_code}, result.stdout + result.stderr)

    def test_named_fixtures_preserve_valid_cells_and_allowlisted_mutations(self) -> None:
        """Catches tiny surrogate fixtures or mutations outside their named failure mode."""
        valid_ids = logical_cell_ids(VALID_FIXTURE)
        self.assertEqual(len(valid_ids), 41)
        valid_attributes = normalized_attribute_map(VALID_FIXTURE)
        for filename, allowed_prefixes in FIXTURE_MUTATION_PREFIXES.items():
            with self.subTest(fixture=filename):
                fixture = TEST_DIR / filename
                fixture_attributes = normalized_attribute_map(fixture)
                fixture_ids = logical_cell_ids(fixture)
                changed = {
                    key for key in set(valid_attributes) | set(fixture_attributes)
                    if valid_attributes.get(key) != fixture_attributes.get(key)
                }

                self.assertEqual(fixture_ids, valid_ids)
                self.assertTrue(changed)
                self.assertTrue(
                    all(any(key == prefix or key.startswith(prefix) for prefix in allowed_prefixes) for key in changed),
                    f"unexpected normalized changes for {filename}: {sorted(changed)}",
                )

    def test_error_code_comes_from_fixture_content_not_its_filename(self) -> None:
        """Catches a linter that maps fixture names to hard-coded error codes."""
        source = TEST_DIR / "invalid-gap-small.drawio"
        with tempfile.TemporaryDirectory() as temporary_directory:
            renamed_fixture = Path(temporary_directory) / "renamed-unrelated.drawio"
            shutil.copyfile(source, renamed_fixture)
            result = run_linter(renamed_fixture, "--strict")

        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(error_codes(result), {"E_GAP_SMALL"}, result.stdout + result.stderr)

    def test_explicit_edge_point_outside_page_reports_page_bounds(self) -> None:
        """Catches a page check that ignores explicit edge geometry."""
        source = """<?xml version=\"1.0\"?>
<mxfile><diagram id=\"d\"><mxGraphModel pageWidth=\"200\" pageHeight=\"160\"><root>
<mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/>
<mxCell id=\"card\" style=\"role=card;\" vertex=\"1\" parent=\"1\" data-role=\"card\"><mxGeometry x=\"60\" y=\"60\" width=\"80\" height=\"40\" as=\"geometry\"/></mxCell>
<mxCell id=\"edge\" edge=\"1\" parent=\"1\"><mxGeometry relative=\"1\" as=\"geometry\"><mxPoint x=\"-10\" y=\"80\" as=\"sourcePoint\"/><mxPoint x=\"100\" y=\"80\" as=\"targetPoint\"/></mxGeometry></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture = Path(temporary_directory) / "explicit-edge.drawio"
            fixture.write_text(source, encoding="utf-8")
            result = run_linter(fixture, "--strict")

        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("E_PAGE_BOUNDS", error_codes(result), result.stdout + result.stderr)

    def test_connected_edge_ignores_fallback_terminal_points(self) -> None:
        """Catches connected-edge fallback points being treated as real explicit geometry."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="400" pageHeight="220"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="a" style="role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="60" y="60" width="100" height="100" as="geometry"/></mxCell>
<mxCell id="b" style="role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="240" y="60" width="100" height="100" as="geometry"/></mxCell>
<mxCell id="edge" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"><mxPoint x="-10" y="110" as="sourcePoint"/><mxPoint x="270" y="110" as="targetPoint"/></mxGeometry></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_diagonal_gap_uses_euclidean_clearance(self) -> None:
        """Catches diagonal spacing being reduced to min(horizontal, vertical) gap."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="340" pageHeight="340"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="a" style="role=card;diagramGroup=flow;" vertex="1" parent="1" data-role="card" data-diagram-group="flow"><mxGeometry x="60" y="60" width="100" height="100" as="geometry"/></mxCell>
<mxCell id="b" style="role=card;diagramGroup=flow;" vertex="1" parent="1" data-role="card" data-diagram-group="flow"><mxGeometry x="180" y="180" width="100" height="100" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertEqual(error_codes(result), {"E_GAP_SMALL"}, result.stdout + result.stderr)
        self.assertIn("axis=diagonal gap=28.2843", result.stdout)

    def test_far_diagonal_gap_is_not_misclassified_as_small(self) -> None:
        """Catches a 440/20 diagonal pair being reported as a 20 px small gap."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="760" pageHeight="340"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="a" style="role=card;diagramGroup=flow;" vertex="1" parent="1" data-role="card" data-diagram-group="flow"><mxGeometry x="60" y="60" width="100" height="100" as="geometry"/></mxCell>
<mxCell id="b" style="role=card;diagramGroup=flow;" vertex="1" parent="1" data-role="card" data-diagram-group="flow"><mxGeometry x="600" y="180" width="100" height="100" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertEqual(error_codes(result), {"E_GAP_LARGE"}, result.stdout + result.stderr)
        self.assertIn("axis=diagonal", result.stdout)

    def test_object_wrapper_outer_id_is_authoritative(self) -> None:
        """Catches conflicting inner IDs that break parent references to object IDs."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="800" pageHeight="420"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<object id="outer" value="Outer" data-role="card"><mxCell id="inner" style="role=note;" vertex="1" parent="1"><mxGeometry x="60" y="60" width="300" height="300" as="geometry"/></mxCell></object>
<mxCell id="body" style="role=body;fontSize=18;" vertex="1" parent="outer" data-role="body"><mxGeometry x="24" y="72" width="250" height="48" as="geometry"/></mxCell>
<mxCell id="filler" style="role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="440" y="60" width="300" height="300" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_userobject_wrapper_outer_id_is_authoritative(self) -> None:
        """Catches UserObject wrappers whose outer IDs are not normalized consistently."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="800" pageHeight="420"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<UserObject id="outer-user" value="Outer" data-role="card"><mxCell id="inner-user" style="role=note;" vertex="1" parent="1"><mxGeometry x="60" y="60" width="300" height="300" as="geometry"/></mxCell></UserObject>
<mxCell id="body" style="role=body;fontSize=18;" vertex="1" parent="outer-user" data-role="body"><mxGeometry x="24" y="72" width="250" height="48" as="geometry"/></mxCell>
<mxCell id="filler" style="role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="440" y="60" width="300" height="300" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_object_wrapper_metadata_and_cell_geometry_are_normalized(self) -> None:
        """Catches parsers that ignore Draw.io object/UserObject cell wrappers."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="800" pageHeight="160"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<object id="wrapped-title" value="Wrapped title" data-role="title" data-diagram-group="main-flow"><mxCell style="text;fontSize=24;" vertex="1" parent="1"><mxGeometry x="-1" y="60" width="741" height="40" as="geometry"/></mxCell></object>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertEqual(error_codes(result), {"E_PAGE_BOUNDS"}, result.stdout + result.stderr)

    def test_nested_edge_points_are_checked_against_edge_parent(self) -> None:
        """Catches parent-bound checks that consider only vertex rectangles."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="800" pageHeight="420"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="group" style="rounded=1;role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="60" y="60" width="680" height="300" as="geometry"/></mxCell>
<mxCell id="edge" style="endArrow=block;" edge="1" parent="group"><mxGeometry relative="1" as="geometry"><mxPoint x="20" y="100" as="sourcePoint"/><mxPoint x="720" y="100" as="targetPoint"/></mxGeometry></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertEqual(error_codes(result), {"E_PARENT_BOUNDS"}, result.stdout + result.stderr)

    def test_gap_checks_non_adjacent_same_row_pair_in_a_group(self) -> None:
        """Catches global-adjacent scans that miss a 20 px related pair."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="340" pageHeight="360"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="a" style="role=card;diagramGroup=flow;" vertex="1" parent="1" data-role="card" data-diagram-group="flow"><mxGeometry x="60" y="60" width="100" height="100" as="geometry"/></mxCell>
<mxCell id="interposed" style="role=card;diagramGroup=flow;" vertex="1" parent="1" data-role="card" data-diagram-group="flow"><mxGeometry x="140" y="200" width="100" height="100" as="geometry"/></mxCell>
<mxCell id="c" style="role=card;diagramGroup=flow;" vertex="1" parent="1" data-role="card" data-diagram-group="flow"><mxGeometry x="180" y="60" width="100" height="100" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertEqual(error_codes(result), {"E_GAP_SMALL"}, result.stdout + result.stderr)

    def test_card_overlap_with_table_cell_is_not_exempt(self) -> None:
        """Catches blanket table-cell overlap exemptions that hide card collisions."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="490" pageHeight="420"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="card" style="role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="60" y="60" width="300" height="300" as="geometry"/></mxCell>
<mxCell id="table" style="role=table-cell;fontSize=14;" vertex="1" parent="1" data-role="table-cell"><mxGeometry x="330" y="100" width="100" height="100" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertEqual(error_codes(result), {"E_OVERLAP"}, result.stdout + result.stderr)

    def test_strict_canvas_rejects_a_ten_pixel_margin(self) -> None:
        """Catches strict canvas checks that enforce only excessive whitespace."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="800" pageHeight="420"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="card" style="role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="10" y="40" width="730" height="320" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertEqual(error_codes(result), {"E_CANVAS_WHITESPACE"}, result.stdout + result.stderr)

    def test_quality_only_canvas_violation_is_non_strict_clean(self) -> None:
        """Catches a non-strict mode that still applies formal quality gates."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="800" pageHeight="420"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="card" style="role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="60" y="60" width="300" height="300" as="geometry"/></mxCell>
<mxCell id="body" style="role=body;fontSize=17;" vertex="1" parent="card" data-role="body"><mxGeometry x="24" y="72" width="250" height="48" as="geometry"/></mxCell>
<mxCell id="filler" style="role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="440" y="60" width="300" height="300" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source)

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_auto_routed_terminal_segments_are_not_guessed(self) -> None:
        """Catches edge-through logic that invents source/target terminal segments."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="400" pageHeight="220"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="a" style="role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="60" y="60" width="100" height="100" as="geometry"/></mxCell>
<mxCell id="b" style="role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="240" y="60" width="100" height="100" as="geometry"/></mxCell>
<mxCell id="edge" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="270" y="110"/></Array></mxGeometry></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_status_uses_card_ancestor_and_last_divider_across_groups(self) -> None:
        """Catches direct-parent-only status/divider pairing and arbitrary divider choice."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="800" pageHeight="420"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="card" style="role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="60" y="60" width="680" height="300" as="geometry"/></mxCell>
<mxCell id="inner" style="role=group;" vertex="1" parent="card" data-role="group"><mxGeometry x="0" y="0" width="680" height="300" as="geometry"/></mxCell>
<mxCell id="first-divider" style="role=divider;" vertex="1" parent="inner" data-role="divider"><mxGeometry x="24" y="60" width="632" height="1" as="geometry"/></mxCell>
<mxCell id="last-divider" style="role=divider;" vertex="1" parent="inner" data-role="divider"><mxGeometry x="24" y="136" width="632" height="1" as="geometry"/></mxCell>
<mxCell id="status-group" style="role=group;" vertex="1" parent="inner" data-role="group"><mxGeometry x="0" y="0" width="680" height="300" as="geometry"/></mxCell>
<mxCell id="status" style="role=status;fontSize=16;" vertex="1" parent="status-group" data-role="status"><mxGeometry x="24" y="120" width="632" height="10" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertEqual(error_codes(result), {"E_STATUS_ORDER"}, result.stdout + result.stderr)

    def test_explicit_top_level_edge_contributes_to_strict_canvas_extent(self) -> None:
        """Catches canvas fitting that ignores explicitly routed root-level edges."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="800" pageHeight="200"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="card" style="role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="60" y="60" width="680" height="80" as="geometry"/></mxCell>
<mxCell id="edge" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="10" y="100" as="sourcePoint"/><mxPoint x="20" y="100" as="targetPoint"/></mxGeometry></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertEqual(error_codes(result), {"E_CANVAS_WHITESPACE"}, result.stdout + result.stderr)

    def test_arrow_extent_is_included_in_page_allowance(self) -> None:
        """Catches fixed two-pixel allowances that ignore declared arrow size."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="200" pageHeight="160"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="edge" style="strokeWidth=2;endArrow=block;endSize=8;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="60" y="80" as="sourcePoint"/><mxPoint x="195" y="80" as="targetPoint"/></mxGeometry></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertEqual(error_codes(result), {"E_PAGE_BOUNDS"}, result.stdout + result.stderr)

    def test_unconnected_source_point_to_waypoint_is_an_explicit_segment(self) -> None:
        """Catches source-unconnected half paths that skip their real first segment."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="400" pageHeight="220"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="anchor" style="role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="60" y="60" width="100" height="100" as="geometry"/></mxCell>
<mxCell id="obstacle" style="role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="240" y="60" width="100" height="100" as="geometry"/></mxCell>
<mxCell id="edge" edge="1" parent="1" target="obstacle"><mxGeometry relative="1" as="geometry"><mxPoint x="180" y="110" as="sourcePoint"/><Array as="points"><mxPoint x="300" y="110"/></Array></mxGeometry></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertEqual(error_codes(result), {"E_EDGE_THROUGH"}, result.stdout + result.stderr)

    def test_waypoint_to_unconnected_target_point_is_an_explicit_segment(self) -> None:
        """Catches target-unconnected half paths that skip their real final segment."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="400" pageHeight="220"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="source" style="role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="60" y="60" width="100" height="100" as="geometry"/></mxCell>
<mxCell id="obstacle" style="role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="240" y="60" width="100" height="100" as="geometry"/></mxCell>
<mxCell id="edge" edge="1" parent="1" source="source"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="180" y="110"/></Array><mxPoint x="300" y="110" as="targetPoint"/></mxGeometry></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertEqual(error_codes(result), {"E_EDGE_THROUGH"}, result.stdout + result.stderr)

    def test_dangling_source_terminal_is_stable_xml_error(self) -> None:
        """Catches source references that bypass normalized-terminal validation."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="200" pageHeight="160"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="edge" edge="1" parent="1" source="missing"><mxGeometry relative="1" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source)

        self.assertEqual(error_codes(result), {"E_XML"}, result.stdout + result.stderr)
        self.assertIn("dangling source terminal missing for edge", result.stdout)

    def test_dangling_target_terminal_is_stable_xml_error(self) -> None:
        """Catches target references that bypass normalized-terminal validation."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="200" pageHeight="160"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="edge" edge="1" parent="1" target="missing"><mxGeometry relative="1" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source)

        self.assertEqual(error_codes(result), {"E_XML"}, result.stdout + result.stderr)
        self.assertIn("dangling target terminal missing for edge", result.stdout)

    def test_connected_waypoint_does_not_inherit_terminal_arrow_extent(self) -> None:
        """Catches a waypoint near page inheriting an attached edge's end-arrow extent."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="400" pageHeight="220"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="a" style="role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="60" y="60" width="100" height="100" as="geometry"/></mxCell>
<mxCell id="b" style="role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="240" y="60" width="100" height="100" as="geometry"/></mxCell>
<mxCell id="edge" style="endArrow=block;endSize=8;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="397" y="110"/></Array></mxGeometry></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source)

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_gap_group_names_are_scoped_to_sibling_parent(self) -> None:
        """Catches gap checks that compare same-named groups across separate containers."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="800" pageHeight="420"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="left" style="role=panel;" vertex="1" parent="1" data-role="panel"><mxGeometry x="60" y="60" width="300" height="300" as="geometry"/></mxCell>
<mxCell id="right" style="role=panel;" vertex="1" parent="1" data-role="panel"><mxGeometry x="440" y="60" width="300" height="300" as="geometry"/></mxCell>
<mxCell id="a" style="role=card;diagramGroup=flow;" vertex="1" parent="left" data-role="card" data-diagram-group="flow"><mxGeometry x="20" y="20" width="100" height="100" as="geometry"/></mxCell>
<mxCell id="b" style="role=card;diagramGroup=flow;" vertex="1" parent="right" data-role="card" data-diagram-group="flow"><mxGeometry x="20" y="20" width="100" height="100" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_hidden_ancestor_suppresses_descendant_vertex_and_edge_geometry(self) -> None:
        """Catches hidden groups whose off-page children still participate in visible geometry checks."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="400" pageHeight="220"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="hidden" style="role=panel;" visible="0" vertex="1" parent="1" data-role="panel"><mxGeometry x="60" y="60" width="100" height="100" as="geometry"/></mxCell>
<mxCell id="child" style="role=card;" vertex="1" parent="hidden" data-role="card"><mxGeometry x="500" y="0" width="100" height="100" as="geometry"/></mxCell>
<mxCell id="edge" edge="1" parent="hidden"><mxGeometry relative="1" as="geometry"><mxPoint x="-100" y="20" as="sourcePoint"/><mxPoint x="600" y="20" as="targetPoint"/></mxGeometry></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_badge_requires_safe_padding_inside_rounded_card(self) -> None:
        """Catches inset labels that sit in a rounded parent's border arc."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="800" pageHeight="420"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="card" style="rounded=1;arcSize=16;role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="60" y="60" width="680" height="300" as="geometry"/></mxCell>
<mxCell id="badge" value="代码来源" style="rounded=1;arcSize=20;role=badge;fontSize=16;" vertex="1" parent="card" data-role="badge"><mxGeometry x="24" y="24" width="140" height="32" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(error_codes(result), {"E_PARENT_PADDING"}, result.stdout + result.stderr)

    def test_badge_text_is_not_smaller_than_status_text(self) -> None:
        """Catches tiny inset labels that remain hard to read after padding is fixed."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="800" pageHeight="420"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="card" style="rounded=1;arcSize=16;role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="60" y="60" width="680" height="300" as="geometry"/></mxCell>
<mxCell id="badge" value="代码来源" style="rounded=1;arcSize=20;role=badge;fontSize=15;" vertex="1" parent="card" data-role="badge"><mxGeometry x="40" y="40" width="140" height="32" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(error_codes(result), {"E_FONT_SMALL"}, result.stdout + result.stderr)

    def test_badge_in_plain_panel_does_not_use_rounded_card_padding(self) -> None:
        """Catches card-specific badge padding being applied to ordinary containers."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="800" pageHeight="420"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="panel" style="role=panel;" vertex="1" parent="1" data-role="panel"><mxGeometry x="60" y="60" width="680" height="300" as="geometry"/></mxCell>
<mxCell id="badge" value="普通标签" style="rounded=1;arcSize=20;role=badge;fontSize=16;" vertex="1" parent="panel" data-role="badge"><mxGeometry x="10" y="10" width="140" height="32" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_labeled_connector_without_perpendicular_offset_is_rejected(self) -> None:
        """Catches connector strokes drawn through their own centered labels."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="800" pageHeight="420"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="left" style="rounded=1;role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="60" y="60" width="300" height="300" as="geometry"/></mxCell>
<mxCell id="right" style="rounded=1;role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="440" y="60" width="300" height="300" as="geometry"/></mxCell>
<mxCell id="edge" value="编译产物" style="edgeStyle=orthogonalEdgeStyle;fontSize=16;role=connector;" edge="1" parent="1" source="left" target="right" data-role="connector"><mxGeometry relative="1" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(error_codes(result), {"E_EDGE_LABEL_INLINE"}, result.stdout + result.stderr)

    def test_note_requires_safe_padding_inside_rounded_panel(self) -> None:
        """Catches framed notes that cover a rounded parent's bottom outline."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="800" pageHeight="420"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="panel" style="rounded=1;role=panel;" vertex="1" parent="1" data-role="panel"><mxGeometry x="60" y="60" width="680" height="300" as="geometry"/></mxCell>
<mxCell id="note" value="边界说明" style="rounded=1;role=note;fontSize=16;" vertex="1" parent="panel" data-role="note"><mxGeometry x="40" y="240" width="600" height="40" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(error_codes(result), {"E_PARENT_PADDING"}, result.stdout + result.stderr)

    def test_labeled_connector_with_perpendicular_offset_is_clean(self) -> None:
        """Keeps readable connector labels that are explicitly lifted off the stroke."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="800" pageHeight="420"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="left" style="rounded=1;role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="60" y="60" width="300" height="300" as="geometry"/></mxCell>
<mxCell id="right" style="rounded=1;role=card;" vertex="1" parent="1" data-role="card"><mxGeometry x="440" y="60" width="300" height="300" as="geometry"/></mxCell>
<mxCell id="edge" value="编译产物" style="edgeStyle=orthogonalEdgeStyle;fontSize=16;role=connector;" edge="1" parent="1" source="left" target="right" data-role="connector"><mxGeometry y="-20" relative="1" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_note_with_safe_padding_inside_rounded_panel_is_clean(self) -> None:
        """Keeps framed notes that leave the required parent-border clearance."""
        source = """<?xml version="1.0"?>
<mxfile><diagram id="d"><mxGraphModel pageWidth="800" pageHeight="420"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="panel" style="rounded=1;role=panel;" vertex="1" parent="1" data-role="panel"><mxGeometry x="60" y="60" width="680" height="300" as="geometry"/></mxCell>
<mxCell id="note" value="边界说明" style="rounded=1;role=note;fontSize=16;" vertex="1" parent="panel" data-role="note"><mxGeometry x="40" y="220" width="600" height="40" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>"""
        result = run_xml(source, "--strict")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
