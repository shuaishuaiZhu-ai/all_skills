#!/usr/bin/env node
const fs = require("fs");

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: node lint-mermaid-layout.cjs <diagram.mmd> [more.mmd...]");
  process.exit(2);
}

let failed = false;

function nodeId(raw) {
  const trimmed = raw.trim();
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_-]*)/);
  return match ? match[1] : null;
}

function edgeIds(line) {
  const edge = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*(?:-->|---|-.->|==>)\s*([A-Za-z_][A-Za-z0-9_-]*)/);
  return edge ? [edge[1], edge[2]] : null;
}

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const first = lines.find((line) => line.trim()) || "";
  const isTopDown = /\bflowchart\s+(TB|TD)\b/i.test(first);
  const stack = [];
  const owner = new Map();
  const subgraphs = new Map();

  for (const line of lines) {
    const sub = line.match(/^\s*subgraph\s+([A-Za-z_][A-Za-z0-9_-]*)?(?:\s*\["([^"]*)"\])?/);
    if (sub) {
      const id = sub[1] || `subgraph_${subgraphs.size + 1}`;
      const title = sub[2] || id;
      stack.push(id);
      subgraphs.set(id, { title, nodes: new Set() });
      continue;
    }
    if (/^\s*end\s*$/.test(line)) {
      stack.pop();
      continue;
    }
    const id = nodeId(line);
    if (id && stack.length) {
      const group = stack[stack.length - 1];
      owner.set(id, group);
      subgraphs.get(group)?.nodes.add(id);
    }
  }

  const risks = [];
  for (const line of lines) {
    const ids = edgeIds(line);
    if (!ids) continue;
    const [from, to] = ids;
    const fromGroup = owner.get(from);
    const toGroup = owner.get(to);
    if (isTopDown && toGroup && fromGroup !== toGroup) {
      risks.push({
        line: line.trim(),
        reason: `external edge enters titled subgraph "${subgraphs.get(toGroup)?.title || toGroup}" in TB/TD layout`,
      });
    }
  }

  if (risks.length) {
    failed = true;
    console.error(`\n[layout risk] ${file}`);
    for (const risk of risks) {
      console.error(`- ${risk.reason}: ${risk.line}`);
    }
    console.error("  Fix: use LR layout, add safe entry anchors away from the title band, or switch to SVG/Graphviz with explicit connector routing.");
  } else {
    console.log(`[ok] ${file}`);
  }
}

process.exit(failed ? 1 : 0);
