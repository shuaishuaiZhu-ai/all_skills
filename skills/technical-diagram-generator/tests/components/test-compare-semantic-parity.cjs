"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const {
  manifestFromSvg,
  manifestFromDrawio,
  compareSemanticManifests,
} = require("../../scripts/compare-semantic-parity.cjs");
const { loadDiagramSpec } = require("../../scripts/diagram-spec.cjs");
const { compileLayout } = require("../../scripts/diagram-layout.cjs");
const { renderSvg } = require("../../scripts/render-svg-components.cjs");
const { renderDrawio } = require("../../scripts/render-drawio-components.cjs");

const svg = `
<svg>
  <g data-role="card" data-node-id="compile" data-diagram-group="main"><rect x="0" y="0" width="100" height="80"/><text data-role="title">Compile</text></g>
  <g data-role="card" data-node-id="launch" data-diagram-group="main"><rect x="200" y="0" width="100" height="80"/><text data-role="title">Launch</text></g>
  <g data-role="connector" data-connector-id="compile-launch" data-diagram-group="compile-launch"><polyline points="100,40 200,40"/><text data-role="connector-label">submit</text></g>
</svg>`;
const drawio = `
<mxfile><diagram><mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="a" value="Compile" vertex="1" parent="1" role="card" data-role="card" data-diagram-group="main"><mxGeometry x="0" y="0" width="100" height="80" as="geometry"/></mxCell>
  <mxCell id="b" value="Launch" vertex="1" parent="1" role="card" data-role="card" data-diagram-group="main"><mxGeometry x="200" y="0" width="100" height="80" as="geometry"/></mxCell>
  <mxCell id="edge" value="submit" edge="1" parent="1" source="a" target="b" role="connector" data-role="connector" data-diagram-group="compile-launch"><mxGeometry relative="1" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>`;

const svgManifest = manifestFromSvg(svg);
const drawioManifest = manifestFromDrawio(drawio);
assert.deepEqual(svgManifest.components, [
  { id: "compile", role: "card", label: "Compile", groupId: "main" },
  { id: "launch", role: "card", label: "Launch", groupId: "main" },
]);
assert.equal(svgManifest.connectors[0].source, "compile");
assert.equal(svgManifest.connectors[0].target, "launch");
assert.equal(compareSemanticManifests(svgManifest, drawioManifest).length, 0);

const missing = manifestFromDrawio(drawio.replace(/<mxCell id="b"[\s\S]*?<\/mxCell>/, ""));
assert.deepEqual(compareSemanticManifests(svgManifest, missing).map((finding) => finding.code), ["E_SEMANTIC_MISSING"]);

const reversed = manifestFromDrawio(drawio.replace('source="a" target="b"', 'source="a" target="a"'));
assert.deepEqual(compareSemanticManifests(svgManifest, reversed).map((finding) => finding.code), ["E_SEMANTIC_DIRECTION"]);

const wrappedSvg = svg.replace('<text data-role="title">Compile</text>', '<text data-role="title">Compile</text><text data-role="title">Stage</text>');
const wrappedDrawio = drawio.replace(
  '<mxCell id="edge"',
  '<mxCell id="compile-title-0" value="Compile" vertex="1" parent="a" data-role="title"/><mxCell id="compile-title-1" value="Stage" vertex="1" parent="a" data-role="title"/><mxCell id="edge"'
);
assert.equal(manifestFromSvg(wrappedSvg).components[0].label, "Compile Stage");
assert.equal(manifestFromDrawio(wrappedDrawio).components[0].label, "Compile Stage");
assert.equal(compareSemanticManifests(manifestFromSvg(wrappedSvg), manifestFromDrawio(wrappedDrawio)).length, 0);

const component = { id: "a", role: "card", label: "Compile", groupId: "main" };
const connector = { id: "edge", role: "connector", label: "submit", groupId: "compile-launch", source: "a", target: "b" };
const baseManifest = {
  components: [component, { ...component, id: "b", label: "Launch" }],
  connectors: [connector],
};
const duplicateComponent = { ...component, id: "copy" };
const duplicateConnector = { ...connector, id: "edge-copy" };
assert.deepEqual(
  compareSemanticManifests({ ...baseManifest, components: [...baseManifest.components, duplicateComponent] }, baseManifest).map((finding) => finding.code),
  ["E_SEMANTIC_MISSING"]
);
assert.deepEqual(
  compareSemanticManifests({ ...baseManifest, connectors: [...baseManifest.connectors, duplicateConnector] }, baseManifest).map((finding) => finding.code),
  ["E_SEMANTIC_MISSING"]
);

const duplicateConnectorPairs = [
  { ...connector, id: "edge-forward" },
  { ...connector, id: "edge-backward", source: "b", target: "a" },
];
assert.deepEqual(
  compareSemanticManifests(
    { ...baseManifest, connectors: duplicateConnectorPairs },
    { ...baseManifest, connectors: [...duplicateConnectorPairs].reverse() }
  ).map((finding) => finding.code),
  [],
  "duplicate connectors with the same metadata compare endpoint pairs as an unordered multiset"
);
assert.deepEqual(
  compareSemanticManifests(
    { ...baseManifest, connectors: duplicateConnectorPairs },
    {
      ...baseManifest,
      connectors: [duplicateConnectorPairs[0], { ...duplicateConnectorPairs[1], target: "b" }],
    }
  ).map((finding) => finding.code),
  ["E_SEMANTIC_DIRECTION"],
  "a changed endpoint in an otherwise matching duplicate connector group reports direction mismatch"
);
assert.deepEqual(
  compareSemanticManifests(
    { ...baseManifest, connectors: duplicateConnectorPairs },
    { ...baseManifest, connectors: [duplicateConnectorPairs[0]] }
  ).map((finding) => finding.code),
  ["E_SEMANTIC_MISSING"],
  "a duplicate connector count mismatch reports missing multiplicity"
);

const residualComponents = ["a", "b", "c", "d"].map((label) => ({
  id: label,
  role: "card",
  label,
  groupId: "main",
}));
const endpointKey = (label) => `card\u0000${label}\u0000main`;
const residualFirst = [
  { id: "b-to-a", role: "connector", label: "rel", groupId: "shared", source: "b", target: "a" },
  { id: "c-to-d", role: "connector", label: "rel", groupId: "shared", source: "c", target: "d" },
];
const residualSecond = [
  { id: "b-to-b", role: "connector", label: "rel", groupId: "shared", source: "b", target: "b" },
];
const expectedResidualFindings = [
  {
    code: "E_SEMANTIC_DIRECTION",
    connector: "b-to-a",
    first: { source: endpointKey("b"), target: endpointKey("a") },
    second: { source: endpointKey("b"), target: endpointKey("b") },
  },
  {
    code: "E_SEMANTIC_MISSING",
    side: "second",
    connector: {
      ...residualFirst[1],
      sourceKey: endpointKey("c"),
      targetKey: endpointKey("d"),
    },
  },
];
assert.deepEqual(
  compareSemanticManifests(
    { components: residualComponents, connectors: residualFirst },
    { components: residualComponents, connectors: residualSecond }
  ),
  expectedResidualFindings,
  "residual connectors pair a shared endpoint before reporting the unmatched cardinality"
);
assert.deepEqual(
  compareSemanticManifests(
    { components: residualComponents, connectors: [...residualFirst].reverse() },
    { components: residualComponents, connectors: residualSecond }
  ),
  expectedResidualFindings,
  "residual connector findings are independent of XML or input-array order"
);

const layout = compileLayout(loadDiagramSpec(path.join(__dirname, "fixtures", "valid-flow.json")), { attempt: 0 });
assert.equal(
  compareSemanticManifests(manifestFromSvg(renderSvg(layout)), manifestFromDrawio(renderDrawio(layout))).length,
  0,
  "valid-flow SVG and Draw.io renderings must have semantic parity"
);

console.log("PASS test-compare-semantic-parity");
