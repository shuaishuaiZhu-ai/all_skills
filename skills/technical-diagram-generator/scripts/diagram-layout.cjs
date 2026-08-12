"use strict";

const { layoutTextStack } = require("./svg-card-layout.cjs");

const DEFAULT_LAYOUT_TOKENS = Object.freeze({
  canvasMargin: 60,
  cardGap: 48,
  cardPadding: 24,
  roundedInsetPadding: 32,
  connectorClearance: 16,
  labelOffset: 20,
  complexLabelOffset: 24,
  titleFont: 24,
  bodyFont: 18,
  insetFont: 16,
  tableFont: 14,
  renderSafetyFactor: 1.15,
});

function charEm(character, kind) {
  if (/^[\u3400-\u9fff\uf900-\ufaff]$/u.test(character)) return 1;
  return kind === "code" ? 0.62 : 0.58;
}

function estimateTextWidth(text, fontSize, kind = "body") {
  return [...String(text)].reduce((sum, character) => sum + charEm(character, kind) * fontSize, 0) * DEFAULT_LAYOUT_TOKENS.renderSafetyFactor;
}

function wrapText(text, width, fontSize, kind) {
  const lines = [];
  let line = "";
  for (const character of String(text)) {
    if (character === "\n") {
      lines.push(line);
      line = "";
    } else if (line && estimateTextWidth(line + character, fontSize, kind) > width) {
      lines.push(line);
      line = character;
    } else {
      line += character;
    }
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

function textLines(component, width) {
  const padding = DEFAULT_LAYOUT_TOKENS.cardPadding;
  const availableWidth = width - padding * 2;
  const entries = wrapText(component.title, availableWidth, DEFAULT_LAYOUT_TOKENS.titleFont, "body").map((text) => ({
    text,
    role: "title",
    fontSize: DEFAULT_LAYOUT_TOKENS.titleFont,
  }));
  for (const body of component.body || []) {
    for (const text of wrapText(body, availableWidth, DEFAULT_LAYOUT_TOKENS.bodyFont, "body")) {
      entries.push({ text, role: "body", fontSize: DEFAULT_LAYOUT_TOKENS.bodyFont });
    }
  }
  if (component.status) {
    for (const text of wrapText(component.status, availableWidth, DEFAULT_LAYOUT_TOKENS.insetFont, "body")) {
      entries.push({ text, role: "status", fontSize: DEFAULT_LAYOUT_TOKENS.insetFont });
    }
  }
  return entries;
}

function measureNode(component, extraHeight) {
  const widest = Math.max(estimateTextWidth(component.title, DEFAULT_LAYOUT_TOKENS.titleFont), ...(component.body || []).map((text) => estimateTextWidth(text, DEFAULT_LAYOUT_TOKENS.bodyFont)), component.status ? estimateTextWidth(component.status, DEFAULT_LAYOUT_TOKENS.insetFont) : 0);
  const width = Math.max(260, Math.min(360, Math.ceil(widest + DEFAULT_LAYOUT_TOKENS.cardPadding * 2)));
  const rect = { x: 0, y: 0, width, height: 120 + extraHeight };
  const stack = layoutTextStack({
    rect,
    lines: textLines(component, width).map((line) => ({ ...line, x: rect.x + DEFAULT_LAYOUT_TOKENS.cardPadding, y: 0 })),
    padding: { top: DEFAULT_LAYOUT_TOKENS.cardPadding, bottom: DEFAULT_LAYOUT_TOKENS.cardPadding },
    options: { statusDividerGap: 16 },
  });
  return {
    id: component.id,
    role: component.type,
    title: component.title,
    rect: { ...rect, height: stack.requiredHeight },
    lines: stack.lines.map((line) => ({
      ...line,
      rect: {
        x: rect.x + DEFAULT_LAYOUT_TOKENS.cardPadding,
        y: Math.floor(line.y - line.fontSize * 0.9),
        width: Math.ceil(estimateTextWidth(line.text, line.fontSize, "body")),
        height: Math.ceil(line.fontSize * 1.18),
      },
    })),
    expands: stack.expands,
  };
}

function placeRows(nodes, spec, gap) {
  const margin = DEFAULT_LAYOUT_TOKENS.canvasMargin + DEFAULT_LAYOUT_TOKENS.connectorClearance;
  if (spec.layout.type !== "panel-grid") {
    let x = margin;
    for (const node of nodes) {
      node.rect.x = x;
      node.rect.y = margin;
      x += node.rect.width + gap;
    }
    return;
  }
  const occupied = new Set();
  let next = 0;
  const columnCount = Math.max(2, ...spec.components.filter((component) => Number.isInteger(component.column)).map((component) => component.column + 1));
  const nextAvailable = () => {
    while (occupied.has(`${Math.floor(next / columnCount)}:${next % columnCount}`)) next += 1;
    const coordinate = [Math.floor(next / columnCount), next % columnCount];
    next += 1;
    return coordinate;
  };
  const coordinates = (component) => {
    const preferred = Number.isInteger(component.row) && Number.isInteger(component.column) ? [component.row, component.column] : null;
    const coordinate = preferred && !occupied.has(`${preferred[0]}:${preferred[1]}`) ? preferred : nextAvailable();
    occupied.add(`${coordinate[0]}:${coordinate[1]}`);
    return coordinate;
  };
  const slots = spec.components.map(coordinates);
  const columns = Math.max(...slots.map(([, column]) => column)) + 1;
  const rows = Math.max(...slots.map(([row]) => row)) + 1;
  const columnWidths = Array(columns).fill(0);
  const rowHeights = Array(rows).fill(0);
  slots.forEach(([row, column], index) => {
    columnWidths[column] = Math.max(columnWidths[column], nodes[index].rect.width);
    rowHeights[row] = Math.max(rowHeights[row], nodes[index].rect.height);
  });
  slots.forEach(([row, column], index) => {
    nodes[index].rect.x = margin + columnWidths.slice(0, column).reduce((sum, width) => sum + width, 0) + gap * column;
    nodes[index].rect.y = margin + rowHeights.slice(0, row).reduce((sum, height) => sum + height, 0) + gap * row;
  });
}

function lineRects(node) {
  return node.lines.map((line) => ({ ...line, x: node.rect.x + DEFAULT_LAYOUT_TOKENS.cardPadding, rect: { ...line.rect, x: node.rect.x + DEFAULT_LAYOUT_TOKENS.cardPadding, y: node.rect.y + line.rect.y } }));
}

function segmentIntersectsRect(start, end, rect) {
  if (start.x === end.x) {
    return start.x > rect.x && start.x < rect.x + rect.width && Math.max(start.y, end.y) > rect.y && Math.min(start.y, end.y) < rect.y + rect.height;
  }
  return start.y > rect.y && start.y < rect.y + rect.height && Math.max(start.x, end.x) > rect.x && Math.min(start.x, end.x) < rect.x + rect.width;
}

function connectorPoints(source, target, nodes) {
  const sourceCenter = { x: source.rect.x + source.rect.width / 2, y: source.rect.y + source.rect.height / 2 };
  const targetCenter = { x: target.rect.x + target.rect.width / 2, y: target.rect.y + target.rect.height / 2 };
  if (Math.abs(targetCenter.x - sourceCenter.x) >= Math.abs(targetCenter.y - sourceCenter.y)) {
    const forward = targetCenter.x >= sourceCenter.x;
    const start = { x: forward ? source.rect.x + source.rect.width : source.rect.x, y: sourceCenter.y };
    const end = { x: forward ? target.rect.x : target.rect.x + target.rect.width, y: targetCenter.y };
    const crossesNode = nodes.some((node) => node !== source && node !== target && segmentIntersectsRect(start, end, node.rect));
    if (start.y === end.y && !crossesNode) return [start, end];
    const corridorY = Math.min(...nodes.map((node) => node.rect.y)) - DEFAULT_LAYOUT_TOKENS.connectorClearance;
    return [start, { x: start.x, y: corridorY }, { x: end.x, y: corridorY }, end];
  }
  const down = targetCenter.y >= sourceCenter.y;
  const sourceY = down ? source.rect.y + source.rect.height : source.rect.y;
  const targetY = down ? target.rect.y : target.rect.y + target.rect.height;
  const corridorY = (sourceY + targetY) / 2;
  return [
    { x: sourceCenter.x, y: sourceY },
    { x: sourceCenter.x, y: corridorY },
    { x: targetCenter.x, y: corridorY },
    { x: targetCenter.x, y: targetY },
  ];
}

function compileLayout(spec, options = {}) {
  const attempt = options.attempt ?? 0;
  if (!Number.isInteger(attempt) || attempt < 0 || attempt > 2) throw new RangeError("attempt must be 0, 1, or 2");
  const attemptGrowth = [0, 24, 48][attempt];
  const widestConnectorLabel = Math.max(0, ...spec.connectors.map((connector) => connector.label ? estimateTextWidth(connector.label, DEFAULT_LAYOUT_TOKENS.insetFont) : 0));
  const labeledConnectorGap = widestConnectorLabel ? Math.min(120, Math.ceil(widestConnectorLabel + 8 + attemptGrowth)) : 0;
  const cardGap = Math.max(DEFAULT_LAYOUT_TOKENS.cardGap + attemptGrowth, labeledConnectorGap);
  const extraHeight = attempt === 0 ? 0 : attemptGrowth * 2;
  const nodes = spec.components.map((component) => measureNode(component, extraHeight));
  placeRows(nodes, spec, cardGap);
  for (const node of nodes) node.lines = lineRects(node);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const connectors = spec.connectors.map((connector) => ({
    id: connector.id,
    source: connector.source,
    target: connector.target,
    label: connector.label || "",
    points: connectorPoints(byId.get(connector.source), byId.get(connector.target), nodes),
    labelOffset: connector.label ? (connector.style === "dashed" || spec.layout.type === "panel-grid" ? -DEFAULT_LAYOUT_TOKENS.complexLabelOffset : -DEFAULT_LAYOUT_TOKENS.labelOffset) : 0,
    style: connector.style || "solid",
  }));
  const allConnectorPoints = connectors.flatMap((connector) => connector.points);
  const maxRight = Math.max(DEFAULT_LAYOUT_TOKENS.canvasMargin, ...nodes.map((node) => node.rect.x + node.rect.width), ...allConnectorPoints.map((point) => point.x));
  const maxBottom = Math.max(DEFAULT_LAYOUT_TOKENS.canvasMargin, ...nodes.map((node) => node.rect.y + node.rect.height), ...allConnectorPoints.map((point) => point.y));
  return {
    schemaVersion: 1,
    id: spec.id,
    canvas: { width: maxRight + DEFAULT_LAYOUT_TOKENS.canvasMargin, height: maxBottom + DEFAULT_LAYOUT_TOKENS.canvasMargin },
    nodes,
    connectors,
    semanticOrder: nodes.map((node) => node.id),
    adjustments: nodes.some((node) => node.expands) ? ["expand-content-height"] : [],
  };
}

module.exports = { DEFAULT_LAYOUT_TOKENS, compileLayout, estimateTextWidth };
