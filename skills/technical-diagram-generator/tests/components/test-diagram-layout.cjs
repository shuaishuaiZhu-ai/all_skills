"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { loadDiagramSpec } = require("../../scripts/diagram-spec.cjs");
const { compileLayout, estimateTextWidth, DEFAULT_LAYOUT_TOKENS } = require("../../scripts/diagram-layout.cjs");

const fixture = (name) => loadDiagramSpec(path.join(__dirname, "fixtures", name));
const hasPositiveCanvas = (layout) => layout.canvas.width > 0 && layout.canvas.height > 0;
const isInCanvas = (rect, canvas) =>
  rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= canvas.width && rect.y + rect.height <= canvas.height;
const rectContains = (outer, inner) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
const rectsOverlap = (left, right) =>
  left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
const segmentIntersectsRect = (start, end, rect) => {
  if (start.x === end.x) {
    return start.x > rect.x && start.x < rect.x + rect.width && Math.max(start.y, end.y) > rect.y && Math.min(start.y, end.y) < rect.y + rect.height;
  }
  if (start.y === end.y) {
    return start.y > rect.y && start.y < rect.y + rect.height && Math.max(start.x, end.x) > rect.x && Math.min(start.x, end.x) < rect.x + rect.width;
  }
  return true;
};

assert.equal(DEFAULT_LAYOUT_TOKENS.canvasMargin, 60);
assert.equal(DEFAULT_LAYOUT_TOKENS.cardGap, 48);
assert.equal(DEFAULT_LAYOUT_TOKENS.roundedInsetPadding, 32);
assert.equal(DEFAULT_LAYOUT_TOKENS.titleFont, 24);
assert.equal(estimateTextWidth("代码", 18, "body"), 36 * 1.15);

const flow = compileLayout(fixture("valid-flow.json"), { attempt: 0 });
assert.deepEqual(flow.semanticOrder, ["compile", "launch"]);
assert.equal(flow.connectors[0].labelOffset, -24);
const flowGap = flow.nodes[1].rect.x - (flow.nodes[0].rect.x + flow.nodes[0].rect.width);
assert.ok(flowGap >= estimateTextWidth(flow.connectors[0].label, DEFAULT_LAYOUT_TOKENS.insetFont) + 8, "labeled connector must fit between adjacent cards without covering either boundary");
assert.ok(hasPositiveCanvas(flow));
assert.ok(flow.nodes.every((node) => node.role && node.rect.width > 0 && node.rect.height > 0 && isInCanvas(node.rect, flow.canvas)));
assert.ok(flow.nodes.every((node) => node.lines.filter((line) => line.role === "title").every((line) => line.fontSize === DEFAULT_LAYOUT_TOKENS.titleFont)));
assert.ok(flow.nodes.every((node) => node.lines.filter((line) => line.role === "body").every((line) => line.fontSize === DEFAULT_LAYOUT_TOKENS.bodyFont)));
for (const node of flow.nodes) {
  const status = node.lines.find((line) => line.role === "status");
  const prior = node.lines.filter((line) => line.role !== "status").at(-1);
  assert.ok(status.rect.y - (prior.rect.y + prior.rect.height) >= 12, `status divider band is missing in ${node.id}`);
}
assert.ok(flow.adjustments.includes("expand-content-height"), "24px titles expand cards only when their shared text stack requires it");

const timeline = compileLayout(fixture("valid-timeline.json"), { attempt: 1 });
assert.deepEqual(timeline.semanticOrder, ["plan", "build", "verify"]);
assert.ok(hasPositiveCanvas(timeline));
assert.equal(timeline.connectors[0].labelOffset, -20);
assert.equal(timeline.connectors[1].labelOffset, 0);
assert.ok(timeline.nodes.every((node) => isInCanvas(node.rect, timeline.canvas)));
assert.ok(timeline.connectors.find((connector) => connector.id === "plan-verify").points.length > 2);

const panelGrid = compileLayout(fixture("valid-panel-grid.json"), { attempt: 2 });
assert.deepEqual(panelGrid.semanticOrder, ["input", "transform", "output"]);
assert.ok(hasPositiveCanvas(panelGrid));
assert.equal(panelGrid.connectors[1].labelOffset, -24);
assert.ok(panelGrid.nodes.every((node) => isInCanvas(node.rect, panelGrid.canvas)));
assert.ok(panelGrid.nodes.find((node) => node.id === "transform").rect.x > panelGrid.nodes.find((node) => node.id === "input").rect.x);
assert.ok(panelGrid.nodes.find((node) => node.id === "output").rect.y > panelGrid.nodes.find((node) => node.id === "input").rect.y);
for (let index = 0; index < panelGrid.nodes.length; index += 1) {
  for (let otherIndex = index + 1; otherIndex < panelGrid.nodes.length; otherIndex += 1) {
    assert.ok(!rectsOverlap(panelGrid.nodes[index].rect, panelGrid.nodes[otherIndex].rect), `panel-grid nodes overlap: ${panelGrid.nodes[index].id}/${panelGrid.nodes[otherIndex].id}`);
  }
}

const longText = compileLayout(fixture("long-cjk.json"), { attempt: 1 });
assert.ok(longText.canvas.height > flow.canvas.height);
assert.ok(longText.adjustments.includes("expand-content-height"));
assert.ok(longText.nodes.find((node) => node.id === "long-title").lines.filter((line) => line.role === "title").length > 1, "long CJK title wraps at the fixed title font");
for (const node of longText.nodes) {
  assert.ok(node.lines.every((line) => rectContains(node.rect, line.rect)), `text line escapes ${node.id}`);
  assert.ok(node.lines.every((line) => line.rect.width <= node.rect.width - DEFAULT_LAYOUT_TOKENS.cardPadding * 2), `text line exceeds usable width in ${node.id}`);
}

for (const layout of [flow, timeline, panelGrid, longText]) {
  for (const connector of layout.connectors) {
    const source = layout.nodes.find((node) => node.id === connector.source);
    const target = layout.nodes.find((node) => node.id === connector.target);
    assert.ok(connector.points.length >= 2);
    assert.ok(connector.points.every((point) => point.x >= DEFAULT_LAYOUT_TOKENS.canvasMargin && point.y >= DEFAULT_LAYOUT_TOKENS.canvasMargin && point.x <= layout.canvas.width - DEFAULT_LAYOUT_TOKENS.canvasMargin && point.y <= layout.canvas.height - DEFAULT_LAYOUT_TOKENS.canvasMargin), `connector ${connector.id} escapes the canvas margin`);
    for (let index = 1; index < connector.points.length; index += 1) {
      const start = connector.points[index - 1];
      const end = connector.points[index];
      assert.ok(start.x === end.x || start.y === end.y, `connector ${connector.id} has a non-orthogonal segment`);
      assert.ok(!layout.nodes.some((node) => node.id !== source.id && node.id !== target.id && segmentIntersectsRect(start, end, node.rect)), `connector ${connector.id} crosses a card`);
    }
  }
}

assert.ok(compileLayout(fixture("valid-flow.json"), { attempt: 2 }).nodes[1].rect.x - compileLayout(fixture("valid-flow.json"), { attempt: 2 }).nodes[0].rect.x > flow.nodes[1].rect.x - flow.nodes[0].rect.x);
assert.throws(() => compileLayout(fixture("valid-flow.json"), { attempt: 3 }), /attempt/);

console.log("PASS test-diagram-layout");
