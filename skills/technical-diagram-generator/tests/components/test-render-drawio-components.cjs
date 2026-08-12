"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadDiagramSpec } = require("../../scripts/diagram-spec.cjs");
const { compileLayout } = require("../../scripts/diagram-layout.cjs");
const { renderDrawio } = require("../../scripts/render-drawio-components.cjs");

const spec = loadDiagramSpec(path.join(__dirname, "fixtures", "valid-flow.json"));
const layout = compileLayout(spec, { attempt: 0 });
const drawio = renderDrawio(layout);

assert.match(drawio, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
assert.equal((drawio.match(/data-role="card"/g) || []).length, 2);
assert.match(drawio, /style="[^"]*strokeColor=#2563eb[^"]*"[^>]*data-role="card"/, "Draw.io cards must share the SVG visual token");
assert.match(drawio, /style="[^"]*fontStyle=1[^"]*"[^>]*data-role="title"/, "Draw.io titles must share the SVG bold hierarchy");
assert.match(drawio, /style="(?![^"]*fontStyle=1)[^"]*"[^>]*data-role="body"/, "Draw.io body text must not inherit the title weight");
assert.match(drawio, /role=connector/);
assert.match(drawio, /style="[^"]*fontSize=16[^"]*"[^>]*data-role="connector"/, "connector labels must meet the 16pt readability floor");
assert.match(drawio, /style="[^"]*html=0[^"]*"[^>]*data-role="title"/, "generated text must export as native SVG text instead of foreignObject HTML");
assert.match(drawio, /style="[^"]*fontFamily=Arial[^"]*"[^>]*data-role="body"/, "Draw.io text must use the cross-platform sans-serif baseline");
assert.doesNotMatch(drawio, /style="[^"]*html=1[^"]*"[^>]*data-role="(?:title|body|status)"/);
assert.match(drawio, /data-role="divider"[^>]*><mxGeometry[^>]*height="1"/, "divider must be a visible line in its reserved band");
assert.match(drawio, /<mxGeometry y="-24" relative="1" as="geometry">/);
const expectedTitleFontSizes = layout.nodes.flatMap((node) => node.lines.filter((line) => line.role === "title").map((line) => String(line.fontSize)));
const titleFontSizes = [...drawio.matchAll(/style="[^"]*fontSize=([^;"]+)[^"]*"[^>]*data-role="title"/g)].map((match) => match[1]);
assert.deepEqual(titleFontSizes, expectedTitleFontSizes, "title fontSize must come from the LayoutDocument title line");

const collisionSpec = {
  ...spec,
  components: [
    ...spec.components,
    { ...spec.components[1], id: "compile-divider" },
  ],
  connectors: [
    ...spec.connectors,
    { id: "edge", source: "compile-divider", target: "launch", label: "", style: "solid" },
  ],
};
const collisionDrawio = renderDrawio(compileLayout(collisionSpec, { attempt: 0 }));
const collisionCellIds = [...collisionDrawio.matchAll(/<mxCell id="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(collisionCellIds).size, collisionCellIds.length, "Draw.io cell IDs must be globally unique");
const collisionCardIds = new Set([...collisionDrawio.matchAll(/<mxCell id="([^"]+)"[^>]*data-role="card"/g)].map((match) => match[1]));
const collisionEdgeTerminals = [...collisionDrawio.matchAll(/<mxCell[^>]*data-role="connector"[^>]*source="([^"]+)" target="([^"]+)"/g)];
for (const [, source, target] of collisionEdgeTerminals) {
  assert.ok(collisionCardIds.has(source), "connector source must reference an allocated card ID");
  assert.ok(collisionCardIds.has(target), "connector target must reference an allocated card ID");
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tdg-drawio-render-"));
try {
  const output = path.join(root, "valid-flow.drawio");
  fs.writeFileSync(output, drawio, "utf8");
  const python = process.platform === "win32" ? "python" : "python3";
  const xmlCheck = spawnSync(python, ["-c", [
    "import sys, xml.etree.ElementTree as ET",
    "root = ET.parse(sys.argv[1]).getroot()",
    "assert root.tag == 'mxfile'",
    "cells = root.findall('./diagram/mxGraphModel/root/mxCell')",
    "by_id = {cell.get('id'): cell for cell in cells}",
    "cards = [cell for cell in cells if cell.get('data-role') == 'card']",
    "assert len(cards) == 2",
    "assert {'card', 'title', 'body', 'divider', 'status', 'note', 'connector'} <= {cell.get('data-role') for cell in cells}",
    "for cell in cells:",
    "    if cell.get('role'):",
    "        assert cell.get('data-role') == cell.get('role')",
    "        assert cell.get('data-diagram-group')",
    "for card in cards:",
    "    assert card.get('parent') == '1'",
    "    assert card.find('mxGeometry').get('x') is not None",
    "    for child in [item for item in cells if item.get('parent') == card.get('id')]:",
    "        assert child.find('mxGeometry').get('x') is not None",
    "connectors = [cell for cell in cells if cell.get('data-role') == 'connector']",
    "assert len(connectors) == 1",
    "edge = connectors[0]",
    "assert edge.get('source') in by_id and edge.get('target') in by_id",
    "assert edge.find('./mxGeometry/Array[@as=\"points\"]/mxPoint') is not None",
  ].join("\n"), output], { encoding: "utf8" });
  assert.equal(xmlCheck.status, 0, xmlCheck.stdout + xmlCheck.stderr);
  const lint = spawnSync(python, [path.join(__dirname, "..", "..", "scripts", "lint-drawio-layout.py"), output, "--strict"], { encoding: "utf8" });
  assert.equal(lint.status, 0, lint.stdout + lint.stderr);

  const svgLintPath = path.join(__dirname, "..", "..", "scripts", "lint-svg-text-overlap.cjs");
  const edgeLabelSvg = path.join(root, "edge-label-background.svg");
  fs.writeFileSync(edgeLabelSvg, '<svg><g><rect fill="#ffffff" stroke="none" x="10" y="10" width="90" height="20"/><text x="55" y="26" text-anchor="middle" font-size="16">注册后查询</text></g></svg>', "utf8");
  const edgeLabelLint = spawnSync(process.execPath, [svgLintPath, edgeLabelSvg], { encoding: "utf8" });
  assert.equal(edgeLabelLint.status, 0, edgeLabelLint.stdout + edgeLabelLint.stderr, "Draw.io edge-label backgrounds are not node boundaries");

  const exportedDividerSvg = path.join(root, "exported-divider.svg");
  fs.writeFileSync(exportedDividerSvg, '<svg content="&lt;mxCell id=&quot;divider-cell&quot; data-role=&quot;divider&quot; /&gt;"><g data-cell-id="divider-cell"><g><path d="M 10 20 L 100 20" stroke="#000000"/></g></g><text x="20" y="20" font-size="16">正文</text></svg>', "utf8");
  const exportedDividerLint = spawnSync(process.execPath, [svgLintPath, exportedDividerSvg], { encoding: "utf8" });
  assert.equal(exportedDividerLint.status, 0, exportedDividerLint.stdout + exportedDividerLint.stderr, "Draw.io divider paths must not be treated as connectors");

  const unsafeNodeSvg = path.join(root, "unsafe-node.svg");
  fs.writeFileSync(unsafeNodeSvg, '<svg><g><rect fill="#ffffff" stroke="#000000" x="10" y="10" width="90" height="20"/><text x="20" y="18" font-size="16">节点文字</text></g></svg>', "utf8");
  const unsafeNodeLint = spawnSync(process.execPath, [svgLintPath, unsafeNodeSvg], { encoding: "utf8" });
  assert.equal(unsafeNodeLint.status, 1, "real node text touching a boundary must still fail");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("PASS test-render-drawio-components");
