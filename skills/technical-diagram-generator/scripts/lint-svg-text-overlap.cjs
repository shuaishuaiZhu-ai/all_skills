#!/usr/bin/env node
const fs = require("fs");
const {
  lineOverlapRisks,
} = require("./svg-card-layout.cjs");

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: node lint-svg-text-overlap.cjs <diagram.svg> [more.svg...]");
  process.exit(2);
}

const padding = Number(process.env.TEXT_CLEARANCE_PX || 16);
const nodeTextPadding = Number(process.env.NODE_TEXT_PADDING_PX || 10);
const maxArrowheadPx = Number(process.env.MAX_ARROWHEAD_PX || 24);
let failed = false;

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

function cleanText(value) {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function makeTextBox(a, label, clip) {
  const x = num(a.x);
  const y = num(a.y);
  const font = num(a["font-size"], 16);
  const width = Math.max(font * 2, label.length * font * 0.58);
  const height = font * 1.35;
  const anchor = a["text-anchor"] || "start";
  let left = x;
  if (anchor === "middle") left = x - width / 2;
  if (anchor === "end") left = x - width;
  const box = {
    label,
    left: left - padding,
    right: left + width + padding,
    top: y - height - padding / 2,
    bottom: y + padding,
  };
  if (clip) {
    box.left = Math.max(box.left, clip.left);
    box.right = Math.min(box.right, clip.right);
    box.top = Math.max(box.top, clip.top);
    box.bottom = Math.min(box.bottom, clip.bottom);
  }
  return box;
}

function textBoxes(svg) {
  const boxes = [];
  const clippedRanges = [];
  for (const group of svg.matchAll(/<g\b[^>]*>([\s\S]*?)<\/g>/g)) {
    const body = group[1];
    const rectMatch = body.match(/<rect\b([^>]*)\/?>/);
    if (!rectMatch) continue;
    const rect = attrs(rectMatch[1]);
    const clip = {
      left: num(rect.x),
      top: num(rect.y),
      right: num(rect.x) + num(rect.width),
      bottom: num(rect.y) + num(rect.height),
    };
    clippedRanges.push({ start: group.index, end: group.index + group[0].length });
    for (const textMatch of body.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
      const a = attrs(textMatch[1]);
      const label = cleanText(textMatch[2]);
      if (!label) continue;
      boxes.push(makeTextBox(a, label, clip));
    }
  }
  for (const match of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    if (clippedRanges.some((range) => match.index >= range.start && match.index < range.end)) continue;
    const a = attrs(match[1]);
    const label = cleanText(match[2]);
    if (!label) continue;
    boxes.push(makeTextBox(a, label, null));
  }
  return boxes;
}

function parsePoints(value) {
  const nums = [...String(value || "").matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  const points = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    points.push({ x: nums[i], y: nums[i + 1] });
  }
  return points;
}

function markerDefs(svg) {
  const markers = new Map();
  for (const match of svg.matchAll(/<marker\b([^>]*)>[\s\S]*?<\/marker>/g)) {
    const a = attrs(match[1]);
    if (!a.id) continue;
    markers.set(a.id, {
      width: num(a.markerWidth, 3),
      height: num(a.markerHeight, 3),
      units: a.markerUnits || "strokeWidth",
    });
  }
  return markers;
}

function lineSegments(svg) {
  const segments = [];
  for (const match of svg.matchAll(/<line\b([^>]*)\/?>/g)) {
    const a = attrs(match[1]);
    segments.push({
      raw: match[0],
      x1: num(a.x1),
      y1: num(a.y1),
      x2: num(a.x2),
      y2: num(a.y2),
      strokeWidth: num(a["stroke-width"], 1),
      markerEnd: a["marker-end"] || "",
    });
  }
  for (const match of svg.matchAll(/<polyline\b([^>]*)\/?>/g)) {
    const a = attrs(match[1]);
    const points = parsePoints(a.points);
    for (let i = 0; i + 1 < points.length; i += 1) {
      segments.push({
        raw: match[0],
        x1: points[i].x,
        y1: points[i].y,
        x2: points[i + 1].x,
        y2: points[i + 1].y,
        strokeWidth: num(a["stroke-width"], 1),
        markerEnd: a["marker-end"] || "",
      });
    }
  }
  for (const match of svg.matchAll(/<path\b([^>]*)\/?>/g)) {
    const a = attrs(match[1]);
    if (!a.d) continue;
    const nums = [...a.d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    for (let i = 0; i + 3 < nums.length; i += 2) {
      segments.push({
        raw: match[0].slice(0, 120),
        x1: nums[i],
        y1: nums[i + 1],
        x2: nums[i + 2],
        y2: nums[i + 3],
        strokeWidth: num(a["stroke-width"], 1),
        markerEnd: a["marker-end"] || "",
      });
    }
  }
  return segments;
}

function arrowheadRisks(segments, markers) {
  const risks = [];
  for (const seg of segments) {
    const match = /url\(#([^)]+)\)/.exec(seg.markerEnd);
    if (!match) continue;
    const marker = markers.get(match[1]);
    if (!marker) continue;
    const scale = marker.units === "userSpaceOnUse" ? 1 : seg.strokeWidth;
    const effective = Math.max(marker.width, marker.height) * scale;
    const length = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
    if (effective > maxArrowheadPx || (length > 0 && effective > length * 0.65)) {
      risks.push({ marker: match[1], effective, length, segment: seg.raw });
    }
  }
  return risks;
}

function cardTextLines(svg) {
  const cards = [];
  for (const group of svg.matchAll(/<g\b[^>]*>([\s\S]*?)<\/g>/g)) {
    const body = group[1];
    const rectMatch = body.match(/<rect\b([^>]*)\/?>/);
    if (!rectMatch) continue;
    const rect = attrs(rectMatch[1]);
    const lines = [];
    for (const textMatch of body.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
      const a = attrs(textMatch[1]);
      const label = cleanText(textMatch[2]);
      if (!label) continue;
      const x = num(a.x);
      const y = num(a.y);
      if (x < num(rect.x) || x > num(rect.x) + num(rect.width) || y < num(rect.y) || y > num(rect.y) + num(rect.height)) {
        continue;
      }
      lines.push({
        label,
        x,
        y,
        fontSize: num(a["font-size"], 16),
        fontWeight: a["font-weight"] || "",
        textAnchor: a["text-anchor"] || "start",
      });
    }
    if (lines.length > 1) {
      cards.push({
        rect: `${num(rect.x)},${num(rect.y)},${num(rect.x) + num(rect.width)},${num(rect.y) + num(rect.height)}`,
        lines,
      });
    }
  }
  return cards;
}

function textLineOverlapRisks(svg) {
  const risks = [];
  for (const card of cardTextLines(svg)) {
    for (const risk of lineOverlapRisks(card.lines)) {
      risks.push({
        rect: card.rect,
        previous: risk.previous.label,
        current: risk.current.label,
        gap: risk.gap,
        minGap: risk.minGap,
        overlap: risk.overlap,
      });
    }
  }
  return risks;
}

function textInsideRectRisks(svg) {
  const risks = [];
  for (const group of svg.matchAll(/<g\b[^>]*>([\s\S]*?)<\/g>/g)) {
    const body = group[1];
    const rectMatch = body.match(/<rect\b([^>]*)\/?>/);
    if (!rectMatch) continue;
    const rect = attrs(rectMatch[1]);
    const left = num(rect.x);
    const top = num(rect.y);
    const right = left + num(rect.width);
    const bottom = top + num(rect.height);
    for (const textMatch of body.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
      const a = attrs(textMatch[1]);
      const label = cleanText(textMatch[2]);
      if (!label) continue;
      const x = num(a.x);
      const y = num(a.y);
      if (x < left || x > right || y < top || y > bottom) continue;
      const font = num(a["font-size"], 16);
      const textTop = y - font * 0.9;
      const textBottom = y + font * 0.28;
      if (textTop < top + nodeTextPadding || textBottom > bottom - nodeTextPadding) {
        risks.push({ label, rect: `${left},${top},${right},${bottom}` });
      }
    }
  }
  return risks;
}

function segmentIntersectsBox(seg, box) {
  const length = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
  const trim = Math.min(2, length / 4);
  const ux = length > 0 ? (seg.x2 - seg.x1) / length : 0;
  const uy = length > 0 ? (seg.y2 - seg.y1) / length : 0;
  const x1 = seg.x1 + ux * trim;
  const y1 = seg.y1 + uy * trim;
  const x2 = seg.x2 - ux * trim;
  const y2 = seg.y2 - uy * trim;
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  if (maxX < box.left || minX > box.right || maxY < box.top || minY > box.bottom) return false;
  if (x1 === x2) return x1 >= box.left && x1 <= box.right && maxY >= box.top && minY <= box.bottom;
  if (y1 === y2) return y1 >= box.top && y1 <= box.bottom && maxX >= box.left && minX <= box.right;
  const steps = 24;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return true;
  }
  return false;
}

for (const file of files) {
  const svg = fs.readFileSync(file, "utf8");
  const boxes = textBoxes(svg);
  const segments = lineSegments(svg);
  const markers = markerDefs(svg);
  const hits = [];
  for (const box of boxes) {
    for (const seg of segments) {
      if (segmentIntersectsBox(seg, box)) {
        hits.push({ label: box.label, segment: seg.raw });
        break;
      }
    }
  }
  const arrowRisks = arrowheadRisks(segments, markers);
  const rectTextRisks = textInsideRectRisks(svg);
  const lineRisks = textLineOverlapRisks(svg);
  if (hits.length || arrowRisks.length || rectTextRisks.length || lineRisks.length) {
    failed = true;
    console.error(`\n[svg layout risk] ${file}`);
    for (const hit of hits.slice(0, 20)) {
      console.error(`- connector intersects text area: "${hit.label}"`);
    }
    for (const risk of arrowRisks.slice(0, 20)) {
      console.error(
        `- arrowhead "${risk.marker}" too large: ${risk.effective.toFixed(1)} px effective on ${risk.length.toFixed(1)} px segment`
      );
    }
    for (const risk of rectTextRisks.slice(0, 20)) {
      console.error(`- text too close to or outside node box: "${risk.label}" in rect ${risk.rect}`);
    }
    for (const risk of lineRisks.slice(0, 20)) {
      console.error(
        `- text lines too close in rect ${risk.rect}: "${risk.previous}" -> "${risk.current}", gap ${risk.gap.toFixed(1)} px, min ${risk.minGap.toFixed(1)} px, overlap ${risk.overlap.toFixed(1)} px`
      );
    }
    const hidden = hits.length + arrowRisks.length + rectTextRisks.length + lineRisks.length - 80;
    if (hidden > 0) console.error(`- ${hidden} more`);
  } else {
    console.log(`[ok] ${file}`);
  }
}

process.exit(failed ? 1 : 0);
