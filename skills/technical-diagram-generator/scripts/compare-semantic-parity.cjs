"use strict";

const fs = require("node:fs");

function attributes(source) {
  const result = {};
  for (const match of String(source || "").matchAll(/([\w:-]+)="([^"]*)"/g)) result[match[1]] = decodeXml(match[2]);
  return result;
}

function decodeXml(value) {
  return String(value || "").replace(/&(amp|lt|gt|quot|apos);/g, (_match, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[name]);
}

function textValue(value) {
  return decodeXml(String(value || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim());
}

function componentKey(component) {
  return [component.role, component.label, component.groupId].join("\u0000");
}

function connectorKey(connector) {
  return [connector.role, connector.label, connector.groupId].join("\u0000");
}

function endpointPairKey(connector) {
  return [connector.sourceKey, connector.targetKey].join("\u0000");
}

function compareResidualConnectors(first, second) {
  const firstKey = [endpointPairKey(first), first.id || ""].join("\u0000");
  const secondKey = [endpointPairKey(second), second.id || ""].join("\u0000");
  return firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0;
}

function normalizedLines(lines) {
  return textValue(lines.join(" "));
}

function groupByKey(items, keyFor) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFor(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function unmatchedConnectors(first, second) {
  const remainingSecond = groupByKey(second, endpointPairKey);
  const remainingFirst = [];
  for (const connector of first) {
    const matches = remainingSecond.get(endpointPairKey(connector));
    if (matches && matches.length) matches.pop();
    else remainingFirst.push(connector);
  }
  return {
    first: remainingFirst.sort(compareResidualConnectors),
    second: [...remainingSecond.values()].flat().sort(compareResidualConnectors),
  };
}

function pairResidualConnectors(first, second) {
  const candidates = [];
  for (const [firstIndex, firstConnector] of first.entries()) {
    for (const [secondIndex, secondConnector] of second.entries()) {
      const sharedEndpoints = Number(firstConnector.sourceKey === secondConnector.sourceKey)
        + Number(firstConnector.targetKey === secondConnector.targetKey);
      if (sharedEndpoints) candidates.push({ firstIndex, secondIndex, sharedEndpoints });
    }
  }
  candidates.sort((left, right) => right.sharedEndpoints - left.sharedEndpoints
    || compareResidualConnectors(first[left.firstIndex], first[right.firstIndex])
    || compareResidualConnectors(second[left.secondIndex], second[right.secondIndex]));

  const pairedFirst = new Set();
  const pairedSecond = new Set();
  const pairs = [];
  for (const candidate of candidates) {
    if (pairedFirst.has(candidate.firstIndex) || pairedSecond.has(candidate.secondIndex)) continue;
    pairedFirst.add(candidate.firstIndex);
    pairedSecond.add(candidate.secondIndex);
    pairs.push({ first: first[candidate.firstIndex], second: second[candidate.secondIndex] });
  }

  const remainingFirst = first.filter((_connector, index) => !pairedFirst.has(index));
  const remainingSecond = second.filter((_connector, index) => !pairedSecond.has(index));
  for (let index = 0; index < Math.min(remainingFirst.length, remainingSecond.length); index += 1) {
    pairs.push({ first: remainingFirst[index], second: remainingSecond[index] });
  }
  return {
    pairs,
    first: remainingFirst.slice(remainingSecond.length),
    second: remainingSecond.slice(remainingFirst.length),
  };
}

function points(value) {
  const values = [...String(value || "").matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  const result = [];
  for (let index = 0; index + 1 < values.length; index += 2) result.push({ x: values[index], y: values[index + 1] });
  return result;
}

function contains(rect, point) {
  return point && point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function manifestFromSvg(text) {
  const components = [];
  const rects = new Map();
  const connectorBlocks = [];
  for (const match of String(text).matchAll(/<g\b([^>]*)>([\s\S]*?)<\/g>/g)) {
    const attrs = attributes(match[1]);
    const role = attrs["data-role"] || attrs.role;
    if (role === "card") {
      const id = attrs["data-node-id"] || attrs.id;
      const groupId = attrs["data-diagram-group"] || id;
      const rectMatch = match[2].match(/<rect\b([^>]*)\/?\s*>/);
      const titleMatch = match[2].match(/<text\b([^>]*)>([\s\S]*?)<\/text>/);
      if (!id || !rectMatch) continue;
      const rect = attributes(rectMatch[1]);
      const titleLines = [...match[2].matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)]
        .filter((item) => (attributes(item[1])["data-role"] || attributes(item[1]).role) === "title")
        .map((item) => textValue(item[2]));
      components.push({ id, role: "card", label: titleLines.length ? normalizedLines(titleLines) : textValue(titleMatch ? titleMatch[2] : ""), groupId });
      rects.set(id, { x: Number(rect.x), y: Number(rect.y), width: Number(rect.width), height: Number(rect.height) });
    } else if (role === "connector") {
      connectorBlocks.push({ attrs, body: match[2] });
    }
  }
  const connectors = connectorBlocks.map(({ attrs, body }) => {
    const polyline = body.match(/<polyline\b([^>]*)\/?\s*>/);
    const route = points(polyline ? attributes(polyline[1]).points : "");
    const labelMatch = [...body.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)].find((item) => (attributes(item[1])["data-role"] || attributes(item[1]).role) === "connector-label");
    const endpoints = [route[0], route.at(-1)].map((point) => [...rects].find(([, rect]) => contains(rect, point))?.[0]);
    return { id: attrs["data-connector-id"] || attrs.id, role: "connector", label: textValue(labelMatch ? labelMatch[2] : ""), groupId: attrs["data-diagram-group"] || attrs["data-connector-id"], source: endpoints[0], target: endpoints[1] };
  }).filter((connector) => connector.id);
  return { components, connectors };
}

function manifestFromDrawio(text) {
  const cells = [];
  for (const match of String(text).matchAll(/<mxCell\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/mxCell>)/g)) {
    const attrs = attributes(match[1]);
    cells.push({ attrs, body: match[2] || "" });
  }
  const components = cells.filter(({ attrs }) => (attrs["data-role"] || attrs.role) === "card").map(({ attrs }) => {
    const titleLines = cells
      .filter(({ attrs: child }) => child.parent === attrs.id && (child["data-role"] || child.role) === "title")
      .map(({ attrs: child }) => textValue(child.value));
    return {
      id: attrs.id,
      role: "card",
      label: titleLines.length ? normalizedLines(titleLines) : textValue(attrs.value),
      groupId: attrs["data-diagram-group"] || attrs.id,
    };
  });
  const cardById = new Map(components.map((component) => [component.id, component]));
  const connectors = cells.filter(({ attrs }) => attrs.edge === "1" && (attrs["data-role"] || attrs.role) === "connector").map(({ attrs }) => ({
    id: attrs.id,
    role: "connector",
    label: textValue(attrs.value),
    groupId: attrs["data-diagram-group"] || attrs.id,
    source: attrs.source,
    target: attrs.target,
    sourceKey: cardById.has(attrs.source) ? componentKey(cardById.get(attrs.source)) : undefined,
    targetKey: cardById.has(attrs.target) ? componentKey(cardById.get(attrs.target)) : undefined,
  }));
  return { components, connectors };
}

function comparableConnectors(manifest) {
  const components = new Map(manifest.components.map((component) => [component.id, componentKey(component)]));
  return manifest.connectors.map((connector) => ({
    ...connector,
    sourceKey: connector.sourceKey || components.get(connector.source),
    targetKey: connector.targetKey || components.get(connector.target),
  }));
}

function compareSemanticManifests(first, second) {
  const findings = [];
  const firstComponents = groupByKey(first.components, componentKey);
  const secondComponents = groupByKey(second.components, componentKey);
  for (const [key, components] of firstComponents) {
    const other = secondComponents.get(key) || [];
    for (const component of components.slice(other.length)) findings.push({ code: "E_SEMANTIC_MISSING", side: "second", component });
  }
  for (const [key, components] of secondComponents) {
    const other = firstComponents.get(key) || [];
    for (const component of components.slice(other.length)) findings.push({ code: "E_SEMANTIC_MISSING", side: "first", component });
  }
  if (findings.length) return findings;
  const firstConnectors = groupByKey(comparableConnectors(first), connectorKey);
  const secondConnectors = groupByKey(comparableConnectors(second), connectorKey);
  for (const [key, connectors] of firstConnectors) {
    const other = secondConnectors.get(key) || [];
    const unmatched = unmatchedConnectors(connectors, other);
    // Exact endpoint pairs are already removed. Pair the remainder by the
    // largest same-direction endpoint overlap, with endpoint-sorted fallback,
    // so input/XML order cannot turn an unpaired connector into a direction change.
    const residual = pairResidualConnectors(unmatched.first, unmatched.second);
    for (const { first: connector, second: matchingConnector } of residual.pairs) {
      findings.push({ code: "E_SEMANTIC_DIRECTION", connector: connector.id, first: { source: connector.sourceKey, target: connector.targetKey }, second: { source: matchingConnector.sourceKey, target: matchingConnector.targetKey } });
    }
    for (const connector of residual.first) findings.push({ code: "E_SEMANTIC_MISSING", side: "second", connector });
    for (const connector of residual.second) findings.push({ code: "E_SEMANTIC_MISSING", side: "first", connector });
  }
  for (const [key, connectors] of secondConnectors) {
    if (firstConnectors.has(key)) continue;
    for (const connector of connectors) findings.push({ code: "E_SEMANTIC_MISSING", side: "first", connector });
  }
  return findings;
}

function main() {
  const [svgPath, drawioPath] = process.argv.slice(2);
  if (!svgPath || !drawioPath) throw new Error("Usage: compare-semantic-parity.cjs <diagram.svg> <diagram.drawio>");
  const findings = compareSemanticManifests(manifestFromSvg(fs.readFileSync(svgPath, "utf8")), manifestFromDrawio(fs.readFileSync(drawioPath, "utf8")));
  process.stdout.write(`${JSON.stringify({ pass: findings.length === 0, findings })}\n`);
  if (findings.length) process.exitCode = 1;
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`E_SEMANTIC_PARITY: ${error.message}\n`); process.exitCode = 1; }
}

module.exports = { manifestFromSvg, manifestFromDrawio, compareSemanticManifests };
