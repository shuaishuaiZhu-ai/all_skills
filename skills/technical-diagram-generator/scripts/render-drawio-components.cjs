"use strict";

const ROLE_STYLE = Object.freeze({
  card: "rounded=1;arcSize=16;whiteSpace=wrap;html=0;strokeWidth=2;fillColor=#ffffff;strokeColor=#2563eb",
  title: "text;html=0;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;fontFamily=Arial;fontStyle=1",
  body: "text;html=0;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;fontFamily=Arial",
  divider: "shape=line;strokeWidth=1;strokeColor=#cbd5e1",
  status: "text;html=0;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;fontFamily=Arial",
  note: "rounded=1;arcSize=12;whiteSpace=wrap;html=0;strokeWidth=1;fontFamily=Arial",
  connector: "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;endArrow=block;endFill=1;fontFamily=Arial;fontSize=16;labelBackgroundColor=#ffffff;strokeColor=#475569",
});

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function number(value) {
  return Number(value).toFixed(2).replace(/\.00$/, "");
}

function groupFor(item) {
  return item.groupId || item.id;
}

function semanticAttributes(role, group) {
  return `role="${escapeXml(role)}" data-role="${escapeXml(role)}" data-diagram-group="${escapeXml(group)}"`;
}

function styleFor(role, extra = "") {
  return `${ROLE_STYLE[role] || ROLE_STYLE.title};role=${role};${extra}`;
}

function geometry(rect) {
  return `<mxGeometry x="${number(rect.x)}" y="${number(rect.y)}" width="${number(rect.width)}" height="${number(rect.height)}" as="geometry"/>`;
}

function localRect(node, rect) {
  return {
    x: rect.x - node.rect.x,
    y: rect.y - node.rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function createCellAllocator(layout) {
  const reserved = new Set([
    "0",
    "1",
    ...(layout.nodes || []).map((node) => node.id),
    ...(layout.connectors || []).map((connector) => connector.id),
  ]);
  let next = 0;
  return () => {
    let id;
    do {
      id = `tdg-cell-${next}`;
      next += 1;
    } while (reserved.has(id));
    reserved.add(id);
    return id;
  };
}

function cell(id, role, group, value, style, parent, rect) {
  return `        <mxCell id="${escapeXml(id)}" value="${escapeXml(value)}" style="${escapeXml(style)}" vertex="1" parent="${escapeXml(parent)}" ${semanticAttributes(role, group)}>${geometry(rect)}</mxCell>`;
}

function renderCard(node, cardId, allocateCellId) {
  const group = groupFor(node);
  const lines = node.lines || [];
  const status = lines.find((line) => line.role === "status");
  const statusRect = status ? localRect(node, status.rect) : {
    x: 24,
    y: node.rect.height - 24,
    width: node.rect.width - 48,
    height: 0,
  };
  const priorBottom = Math.max(24, ...lines.filter((line) => line.role !== "status").map((line) => localRect(node, line.rect).y + line.rect.height));
  const dividerY = status ? Math.floor((priorBottom + statusRect.y) / 2) : Math.max(24, statusRect.y - 8);
  const children = lines.map((line) => {
    return cell(allocateCellId(), line.role, group, line.text, styleFor(line.role, `fontSize=${line.fontSize}`), cardId, localRect(node, line.rect));
  });
  return [
    cell(cardId, "card", group, "", styleFor("card"), "1", node.rect),
    ...children,
    cell(allocateCellId(), "divider", group, "", styleFor("divider"), cardId, { x: 24, y: dividerY, width: node.rect.width - 48, height: 1 }),
    ...(status ? [] : [cell(allocateCellId(), "status", group, "", styleFor("status", "fontSize=16"), cardId, statusRect)]),
    cell(allocateCellId(), "note", group, "", styleFor("note", "fontSize=16"), cardId, { x: 32, y: node.rect.height - 32, width: node.rect.width - 64, height: 0 }),
  ];
}

function renderConnector(connector, connectorId, cardIds) {
  const group = groupFor(connector);
  const points = (connector.points || []).map((point) => `              <mxPoint x="${number(point.x)}" y="${number(point.y)}"/>`);
  const dashed = connector.style === "dashed" ? "dashed=1" : "";
  const labelOffset = connector.label ? connector.labelOffset : 0;
  return [
    `        <mxCell id="${escapeXml(connectorId)}" value="${escapeXml(connector.label || "")}" style="${escapeXml(styleFor("connector", dashed))}" edge="1" parent="1" source="${escapeXml(cardIds.get(connector.source))}" target="${escapeXml(cardIds.get(connector.target))}" ${semanticAttributes("connector", group)}>`,
    `          <mxGeometry y="${number(labelOffset)}" relative="1" as="geometry"><Array as="points">`,
    ...points,
    "            </Array></mxGeometry>",
    "        </mxCell>",
  ];
}

function renderDrawio(layout) {
  const nodes = new Map((layout.nodes || []).map((node) => [node.id, node]));
  const orderedNodes = (layout.semanticOrder || []).map((id) => nodes.get(id)).filter(Boolean);
  const allocateCellId = createCellAllocator(layout);
  const cardIds = new Map(orderedNodes.map((node) => [node.id, allocateCellId()]));
  const cells = [
    ...orderedNodes.flatMap((node) => renderCard(node, cardIds.get(node.id), allocateCellId)),
    ...(layout.connectors || []).flatMap((connector) => renderConnector(connector, allocateCellId(), cardIds)),
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<mxfile host="app.diagrams.net" agent="technical-diagram-generator" type="device">',
    `  <diagram id="${escapeXml(layout.id)}" name="${escapeXml(layout.id)}">`,
    `    <mxGraphModel page="1" pageScale="1" pageWidth="${number(layout.canvas.width)}" pageHeight="${number(layout.canvas.height)}">`,
    "      <root>",
    '        <mxCell id="0"/>',
    '        <mxCell id="1" parent="0"/>',
    ...cells,
    "      </root>",
    "    </mxGraphModel>",
    "  </diagram>",
    "</mxfile>",
  ].join("\n");
}

module.exports = { ROLE_STYLE, renderDrawio };
