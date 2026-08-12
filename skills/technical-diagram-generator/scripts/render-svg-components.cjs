"use strict";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function roleAttributes(node) {
  return `data-role="${escapeXml(node.role)}" data-diagram-group="${escapeXml(node.groupId || node.id)}"`;
}

function number(value) {
  return Number(value).toFixed(2).replace(/\.00$/, "");
}

function textElement(role, groupId, id, line, attributes = "") {
  return `<text ${roleAttributes({ role, groupId, id })} font-family="Arial, sans-serif" ${attributes}>${escapeXml(line.text || "")}</text>`;
}

function renderCard(node) {
  const { rect } = node;
  const group = { role: "card", groupId: node.groupId, id: node.id };
  const textLines = (node.lines || []).map((line) =>
    textElement(line.role, node.groupId, node.id, line, `x="${number(line.x)}" y="${number(rect.y + line.y)}" font-size="${number(line.fontSize)}"${line.role === "title" ? ' font-weight="700"' : ""}`)
  );
  const status = (node.lines || []).find((line) => line.role === "status");
  const priorBottom = Math.max(rect.y + 24, ...(node.lines || []).filter((line) => line.role !== "status").map((line) => line.rect.y + line.rect.height));
  const dividerY = status ? Math.floor((priorBottom + status.rect.y) / 2) : rect.y + rect.height / 2;
  const noteY = rect.y + rect.height - 16;
  return [
    `<g ${roleAttributes(group)} data-node-id="${escapeXml(node.id)}">`,
    `<rect x="${number(rect.x)}" y="${number(rect.y)}" width="${number(rect.width)}" height="${number(rect.height)}" rx="16" ry="16" fill="#ffffff" stroke="#2563eb" stroke-width="2"/>`,
    ...textLines,
    `<line ${roleAttributes({ role: "divider", groupId: node.groupId, id: node.id })} x1="${number(rect.x + 24)}" y1="${number(dividerY)}" x2="${number(rect.x + rect.width - 24)}" y2="${number(dividerY)}" stroke="#cbd5e1" stroke-width="1"/>`,
    ...(status ? [] : [textElement("status", node.groupId, node.id, { text: "" }, `x="${number(rect.x + 24)}" y="${number(noteY)}" font-size="1" aria-hidden="true"`)]),
    textElement("note", node.groupId, node.id, { text: "" }, `x="${number(rect.x + 24)}" y="${number(noteY)}" font-size="1" aria-hidden="true"`),
    "</g>",
  ].join("");
}

function labelMetrics(label) {
  const fontSize = 14;
  return {
    width: Math.max(fontSize * 2, String(label || "").length * fontSize * 0.58),
    height: fontSize * 1.35,
    fontSize,
  };
}

function labelBox(position, metrics) {
  const clearance = 16;
  return {
    left: position.x - metrics.width / 2 - clearance,
    right: position.x + metrics.width / 2 + clearance,
    top: position.y - metrics.height - clearance / 2,
    bottom: position.y + clearance,
  };
}

function segmentIntersectsLabel(segment, box) {
  const minX = Math.min(segment.start.x, segment.end.x);
  const maxX = Math.max(segment.start.x, segment.end.x);
  const minY = Math.min(segment.start.y, segment.end.y);
  const maxY = Math.max(segment.start.y, segment.end.y);
  if (maxX < box.left || minX > box.right || maxY < box.top || minY > box.bottom) return false;
  if (segment.start.x === segment.end.x) return segment.start.x >= box.left && segment.start.x <= box.right;
  if (segment.start.y === segment.end.y) return segment.start.y >= box.top && segment.start.y <= box.bottom;
  return true;
}

function labelCandidates(segment, metrics, preferredSide) {
  const midpoint = {
    x: (segment.start.x + segment.end.x) / 2,
    y: (segment.start.y + segment.end.y) / 2,
  };
  const clearance = 16;
  const gap = clearance + 2;
  const sides = preferredSide < 0 ? [-1, 1] : [1, -1];
  const horizontal = Math.abs(segment.end.x - segment.start.x) >= Math.abs(segment.end.y - segment.start.y);
  return sides.map((side) => horizontal
    ? { x: midpoint.x, y: midpoint.y + side * (metrics.height + gap) }
    : { x: midpoint.x + side * (metrics.width / 2 + gap), y: midpoint.y });
}

function labelPosition(connector) {
  const points = connector.points || [];
  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    segments.push({ start, end, length: Math.hypot(end.x - start.x, end.y - start.y) });
  }
  if (!segments.length) return { x: 0, y: connector.labelOffset || 0 };
  const metrics = labelMetrics(connector.label);
  const preferredSide = connector.labelOffset || 1;
  for (const segment of [...segments].sort((a, b) => b.length - a.length)) {
    for (const candidate of labelCandidates(segment, metrics, preferredSide)) {
      if (!segments.some((other) => segmentIntersectsLabel(other, labelBox(candidate, metrics)))) return candidate;
    }
  }
  return labelCandidates(segments[0], metrics, preferredSide)[0];
}

function renderConnector(connector) {
  const group = { role: "connector", groupId: connector.groupId, id: connector.id };
  const points = (connector.points || []).map((point) => `${number(point.x)},${number(point.y)}`).join(" ");
  const label = labelPosition(connector);
  const dash = connector.style === "dashed" ? ' stroke-dasharray="8 6"' : "";
  return [
    `<g ${roleAttributes(group)} data-connector-id="${escapeXml(connector.id)}">`,
    `<polyline ${roleAttributes(group)} points="${points}" fill="none" stroke="#475569" stroke-width="2" marker-end="url(#tdg-arrow)"${dash}/>`,
    textElement("connector-label", connector.groupId, connector.id, { text: connector.label || "" }, `x="${number(label.x)}" y="${number(label.y)}" font-size="14" text-anchor="middle"`),
    "</g>",
  ].join("");
}

function renderSvg(layout) {
  const nodes = new Map((layout.nodes || []).map((node) => [node.id, node]));
  const orderedNodes = (layout.semanticOrder || []).map((id) => nodes.get(id)).filter(Boolean);
  const width = number(layout.canvas && layout.canvas.width);
  const height = number(layout.canvas && layout.canvas.height);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-generator="technical-diagram-generator">`,
    '<defs><marker id="tdg-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><polygon points="0,0 8,4 0,8" fill="#475569"/></marker></defs>',
    ...orderedNodes.map(renderCard),
    ...(layout.connectors || []).map(renderConnector),
    "</svg>",
  ].join("");
}

module.exports = { escapeXml, renderSvg, roleAttributes };
