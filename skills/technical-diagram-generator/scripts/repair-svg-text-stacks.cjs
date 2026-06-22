#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { layoutTextStack } = require("./svg-card-layout.cjs");

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("Usage: node repair-svg-text-stacks.cjs <out-dir> <diagram.svg> [more.svg...]");
  process.exit(2);
}

const outDir = path.resolve(args[0]);
const files = args.slice(1).map((file) => path.resolve(file));

function attrs(raw) {
  const out = {};
  for (const match of raw.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]*)"/g)) {
    out[match[1]] = match[2];
  }
  return out;
}

function num(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatNumber(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function setAttr(raw, name, value) {
  const stringValue = String(value);
  const attrRe = new RegExp(`\\b${name}="[^"]*"`);
  if (attrRe.test(raw)) {
    return raw.replace(attrRe, `${name}="${stringValue}"`);
  }
  return raw.replace(/\/?>$/, ` ${name}="${stringValue}"$&`);
}

function cleanText(value) {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function repairGroup(group) {
  const bodyMatch = group.match(/^(<g\b[^>]*>)([\s\S]*)(<\/g>)$/);
  if (!bodyMatch) return group;
  const [, open, body, close] = bodyMatch;
  const rectMatch = body.match(/<rect\b([^>]*)\/?>/);
  if (!rectMatch) return group;
  const rectAttrs = attrs(rectMatch[1]);
  const rect = {
    x: num(rectAttrs.x),
    y: num(rectAttrs.y),
    width: num(rectAttrs.width),
    height: num(rectAttrs.height),
  };

  const textMatches = [...body.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)];
  if (textMatches.length < 2) return group;

  const lines = [];
  textMatches.forEach((match, index) => {
    const a = attrs(match[1]);
    const label = cleanText(match[2]);
    const x = num(a.x);
    const y = num(a.y);
    if (!label) return;
    if (x < rect.x || x > rect.x + rect.width || y < rect.y || y > rect.y + rect.height) return;
    lines.push({
      index,
      label,
      x,
      y,
      fontSize: num(a["font-size"], 16),
      fontWeight: a["font-weight"] || "",
      textAnchor: a["text-anchor"] || "start",
    });
  });
  if (lines.length < 2) return group;

    const layout = layoutTextStack({ rect, lines, options: { preserveFirstY: true } });
  const yByIndex = new Map(layout.lines.map((line) => [line.index, formatNumber(line.y)]));

  let textIndex = 0;
  let newBody = body.replace(rectMatch[0], (raw) => {
    if (!layout.expands) return raw;
    return setAttr(raw, "height", layout.requiredHeight);
  });
  newBody = newBody.replace(/<text\b([^>]*)>([\s\S]*?)<\/text>/g, (raw) => {
    const nextY = yByIndex.get(textIndex);
    textIndex += 1;
    if (!nextY) return raw;
    return setAttr(raw, "y", nextY);
  });

  return `${open}${newBody}${close}`;
}

function updateCanvas(svg) {
  const rects = [...svg.matchAll(/<rect\b([^>]*)\/?>/g)].map((match) => {
    const a = attrs(match[1]);
    return {
      x: num(a.x),
      y: num(a.y),
      width: num(a.width),
      height: num(a.height),
    };
  }).filter((rect) => rect.width > 0 && rect.height > 0);
  if (!rects.length) return svg;
  const maxBottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  const svgMatch = svg.match(/<svg\b([^>]*)>/);
  if (!svgMatch) return svg;
  const a = attrs(svgMatch[1]);
  const height = num(a.height);
  if (!height || maxBottom <= height - 60) return svg;
  const nextHeight = Math.ceil(maxBottom + 90);
  const nextTag = setAttr(setAttr(svgMatch[0], "height", nextHeight), "viewBox", `0 0 ${num(a.width, nextHeight)} ${nextHeight}`);
  return svg.replace(svgMatch[0], nextTag);
}

fs.mkdirSync(outDir, { recursive: true });

for (const file of files) {
  const original = fs.readFileSync(file, "utf8");
  let repaired = original.replace(/<g\b[^>]*>[\s\S]*?<\/g>/g, repairGroup);
  repaired = updateCanvas(repaired);
  const outPath = path.join(outDir, path.basename(file));
  fs.writeFileSync(outPath, repaired, "utf8");
  console.log(`[repaired] ${file} -> ${outPath}`);
}
