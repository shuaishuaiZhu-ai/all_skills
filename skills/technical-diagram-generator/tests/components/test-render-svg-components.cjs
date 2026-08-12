"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadDiagramSpec } = require("../../scripts/diagram-spec.cjs");
const { compileLayout } = require("../../scripts/diagram-layout.cjs");
const { renderSvg } = require("../../scripts/render-svg-components.cjs");

const spec = loadDiagramSpec(path.join(__dirname, "fixtures", "valid-flow.json"));
const layout = compileLayout(spec, { attempt: 0 });
const svg = renderSvg(layout);

assert.match(svg, /^<svg\b[^>]*data-generator="technical-diagram-generator"/);
assert.equal((svg.match(/data-role="card"/g) || []).length, 2);
assert.match(svg, /data-role="connector"/);
assert.match(svg, /data-diagram-group="compile"/);
assert.match(svg, /data-diagram-group="launch"/);
assert.doesNotMatch(svg, /<mxfile\b|mxGraphModel/);

const compileIndex = svg.indexOf('data-node-id="compile"');
const launchIndex = svg.indexOf('data-node-id="launch"');
const connectorIndex = svg.indexOf('data-role="connector"');
assert.ok(compileIndex >= 0 && compileIndex < launchIndex && launchIndex < connectorIndex, "nodes follow semanticOrder before connectors");
assert.match(svg, /data-role="title"/);
assert.match(svg, /data-role="body"/);
assert.match(svg, /data-role="divider"/);
assert.match(svg, /font-family="Arial, sans-serif"/, "SVG text must use the same cross-platform sans-serif baseline");
assert.match(svg, /<line[^>]*data-role="divider"/, "SVG channel must render a visible divider, not only semantic placeholder text");
assert.match(svg, /data-role="status"/);
assert.match(svg, /data-role="note"/);
assert.match(svg, /<polyline\b/);

const escaped = renderSvg({
  ...layout,
  nodes: [{
    ...layout.nodes[0],
    id: 'node&<"\'',
    groupId: 'group&<"\'',
    title: "",
    lines: [{ ...layout.nodes[0].lines[0], text: '<&"\'' }],
  }],
  connectors: [],
  semanticOrder: ['node&<"\''],
});
assert.match(escaped, /data-node-id="node&amp;&lt;&quot;&apos;"/);
assert.match(escaped, /data-diagram-group="group&amp;&lt;&quot;&apos;"/);
assert.match(escaped, /&lt;&amp;&quot;&apos;<\/text>/);

function connectorLayout(id, points, label) {
  return {
    canvas: { width: 640, height: 480 },
    nodes: [],
    semanticOrder: [],
    connectors: [{ id, groupId: id, points, label, style: "solid" }],
  };
}

const verticalSvg = renderSvg(connectorLayout(
  "vertical",
  [{ x: 120, y: 80 }, { x: 120, y: 360 }],
  "vertical connector label"
));
const orthogonalSvg = renderSvg(connectorLayout(
  "orthogonal",
  [{ x: 120, y: 80 }, { x: 120, y: 380 }, { x: 400, y: 380 }],
  "orthogonal connector label"
));

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tdg-svg-render-"));
try {
  const output = path.join(root, "valid-flow.svg");
  const verticalOutput = path.join(root, "vertical.svg");
  const orthogonalOutput = path.join(root, "orthogonal.svg");
  fs.writeFileSync(output, svg, "utf8");
  fs.writeFileSync(verticalOutput, verticalSvg, "utf8");
  fs.writeFileSync(orthogonalOutput, orthogonalSvg, "utf8");
  assert.deepEqual(fs.readdirSync(root).sort(), ["orthogonal.svg", "valid-flow.svg", "vertical.svg"]);
  const lint = spawnSync(process.execPath, [path.join(__dirname, "..", "..", "scripts", "lint-svg-text-overlap.cjs"), output, verticalOutput, orthogonalOutput], { encoding: "utf8" });
  assert.equal(lint.status, 0, lint.stdout + lint.stderr);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("PASS test-render-svg-components");
