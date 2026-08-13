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

// Shared with the generators. See assets/layout-constants.json's _readme.
const TOKENS = require("../assets/layout-constants.json");

const padding = Number(process.env.TEXT_CLEARANCE_PX || TOKENS.textClearancePx);
const nodeTextPadding = Number(process.env.NODE_TEXT_PADDING_PX || TOKENS.nodeTextPaddingPx);
const maxArrowheadPx = Number(process.env.MAX_ARROWHEAD_PX || TOKENS.maxArrowheadPx);
const textCollisionYRatio = Number(process.env.TEXT_COLLISION_Y_RATIO || 0.35);
const textCollisionXRatio = Number(process.env.TEXT_COLLISION_X_RATIO || 0.25);
// Beyond this width:height ratio a figure is unreadable at page width: the
// browser scales it down until body text falls below legible size.
const maxAspectRatio = Number(process.env.MAX_ASPECT_RATIO || TOKENS.maxAspectRatio);
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

// An entity is one glyph, not four characters. Measuring "&lt;" as written
// makes a C++ or template signature about three times too wide for the run it
// covers — "add1&lt;&lt;&lt;1,1&gt;&gt;&gt;" measured 519 px against a real 263 —
// and the phantom width collides with whatever sits beside the card.
function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ")
    // Last, so an escaped entity like "&amp;lt;" does not decode twice.
    .replaceAll("&amp;", "&");
}

function cleanText(value) {
  return decodeEntities(value.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

// Hand-authored figures set their sizes in a <style> block and give <text> only
// a class. Measuring those at the 16px default inflates every box by ~28% for a
// 12.5px body class, which is enough to report connectors passing through text
// they clear by a wide margin. Resolve the class sizes instead.
function classFontSizes(svg) {
  const sizes = new Map();
  for (const style of svg.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
    for (const rule of style[1].matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const declaration = rule[2];
      const explicit = /font-size\s*:\s*(-?\d*\.?\d+)px/.exec(declaration);
      // The `font` shorthand puts the size right before the family list.
      const shorthand = /font\s*:\s*[^;]*?(-?\d*\.?\d+)px/.exec(declaration);
      const size = Number((explicit || shorthand || [])[1]);
      if (!Number.isFinite(size)) continue;
      for (const selector of rule[1].split(",")) {
        const name = /\.([A-Za-z_][\w-]*)\s*$/.exec(selector.trim());
        if (name) sizes.set(name[1], size);
      }
    }
  }
  return sizes;
}

// Filled per file before any measuring happens.
let classSizes = new Map();

function fontSizeOf(a, fallback) {
  const explicit = Number.parseFloat(a["font-size"]);
  if (Number.isFinite(explicit)) return explicit;
  for (const name of String(a.class || "").trim().split(/\s+/)) {
    if (classSizes.has(name)) return classSizes.get(name);
  }
  return fallback;
}

function makeTextBox(a, label, clip) {
  const x = num(a.x);
  const y = num(a.y);
  const font = fontSizeOf(a, 16);
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

// Full-width ranges (CJK ideographs, kana, hangul, CJK punctuation, fullwidth
// forms). A uniform 0.58 em advance under-measures these by ~40%, which is
// enough to hide a real collision between a CJK label and a Latin one.
const fullWidthPattern = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;

function advanceEm(character) {
  return fullWidthPattern.test(character) ? TOKENS.wideGlyphEm : TOKENS.narrowGlyphLintEm;
}

function inkWidth(label, fontSize) {
  return [...String(label)].reduce((sum, character) => sum + advanceEm(character) * fontSize, 0);
}

// Ink extents, not the font bounding box. Cap height ~0.78 em above the
// baseline and descender ~0.22 em below it; the looser 0.9/0.28 box used for
// connector clearance reports overlap on text stacks that render fine.
function inkBox(a, label, frame) {
  const { dx, dy } = frame;
  const fontSize = fontSizeOf(a, frame.fontSize);
  const width = inkWidth(label, fontSize);
  const anchor = a["text-anchor"] || frame.anchor;
  const x = num(a.x) + dx;
  const y = num(a.y) + dy;
  const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  return { label, fontSize, left, right: left + width, top: y - fontSize * 0.78, bottom: y + fontSize * 0.22 };
}

function translateOf(raw) {
  const transform = /\btransform="([^"]*)"/.exec(raw);
  if (!transform) return { dx: 0, dy: 0, supported: true };
  let dx = 0;
  let dy = 0;
  let supported = true;
  for (const op of transform[1].matchAll(/([A-Za-z]+)\s*\(([^)]*)\)/g)) {
    if (op[1] !== "translate") {
      supported = false;
      continue;
    }
    const parts = op[2].trim().split(/[\s,]+/).map(Number);
    dx += Number.isFinite(parts[0]) ? parts[0] : 0;
    dy += Number.isFinite(parts[1]) ? parts[1] : 0;
  }
  return { dx, dy, supported };
}

// A <text> renders at its own x/y plus every ancestor transform, and inherits
// text-anchor and font-size from them. Reading only the <text> element gets both
// wrong on Draw.io exports, which carry those on the wrapping <g>: a centred
// connector label measured as left-anchored 16px text lands a full label-width
// to the right of where it draws, on top of whatever card is there.
function inkTextBoxes(svg) {
  const boxes = [];
  const stack = [{ dx: 0, dy: 0, supported: true, anchor: "start", fontSize: 16 }];
  for (const match of svg.matchAll(/<(\/?)(g|text)\b([^>]*?)(\/?)>/g)) {
    const [, closing, name, raw, selfClosing] = match;
    const frame = stack[stack.length - 1];
    if (name === "g") {
      if (closing) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      if (selfClosing) continue;
      const shift = translateOf(raw);
      const inherited = attrs(raw);
      stack.push({
        dx: frame.dx + shift.dx,
        dy: frame.dy + shift.dy,
        supported: frame.supported && shift.supported,
        anchor: inherited["text-anchor"] || frame.anchor,
        fontSize: fontSizeOf(inherited, frame.fontSize),
      });
      continue;
    }
    if (closing || selfClosing) continue;
    const end = svg.indexOf("</text>", match.index);
    const label = cleanText(svg.slice(match.index + match[0].length, end < 0 ? svg.length : end));
    const a = attrs(raw);
    const own = translateOf(raw);
    // Empty semantic placeholders carry no ink and cannot collide. A rotated or
    // matrix-transformed label has no axis-aligned ink box, so skipping it beats
    // measuring it at coordinates it is not drawn at.
    if (!label || !frame.supported || !own.supported) continue;
    if (a["aria-hidden"] === "true" || fontSizeOf(a, frame.fontSize) < 4) continue;
    boxes.push(inkBox(a, label, {
      dx: frame.dx + own.dx,
      dy: frame.dy + own.dy,
      anchor: frame.anchor,
      fontSize: frame.fontSize,
    }));
  }
  return boxes;
}

// Two labels collide when their ink boxes overlap on BOTH axes by more than a
// share of their own size. Relative thresholds keep intentionally tight text
// stacks (baseline gaps down to 1.2 em) out of the report while still catching
// labels that render on top of each other.
function textCollisionRisks(svg) {
  const boxes = inkTextBoxes(svg);
  const risks = [];
  for (let index = 0; index < boxes.length; index += 1) {
    for (let other = index + 1; other < boxes.length; other += 1) {
      const first = boxes[index];
      const second = boxes[other];
      const overlapX = Math.min(first.right, second.right) - Math.max(first.left, second.left);
      const overlapY = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
      if (overlapX <= 0 || overlapY <= 0) continue;
      const minWidth = Math.min(first.right - first.left, second.right - second.left);
      const minFont = Math.min(first.fontSize, second.fontSize);
      if (overlapY > minFont * textCollisionYRatio && overlapX > minWidth * textCollisionXRatio) {
        risks.push({ first: first.label, second: second.label, overlapX, overlapY });
      }
    }
  }
  return risks;
}

// Every other check here is regex-based and tolerates markup no XML parser
// accepts — an unescaped quote inside an attribute value slipped through as
// "[ok]" while the renderer refused the file outright.
function markupRisks(svg) {
  const risks = [];
  const stack = [];
  // The attribute run is lazy so the trailing slash of a self-closing tag is
  // not swallowed as attribute text — that would leave every <rect/> on the
  // stack and report the whole document as unclosed.
  for (const match of svg.matchAll(/<(\/?)([A-Za-z][\w:-]*)((?:[^<>"']|"[^"]*"|'[^']*')*?)\s*(\/?)>/g)) {
    const [, closing, name, attributeText, selfClosing] = match;
    if (closing) {
      const open = stack.pop();
      if (open !== name) risks.push({ message: `tag mismatch: <${open || "?"}> closed by </${name}>` });
      continue;
    }
    const remainder = attributeText.replace(/\s+[\w:-]+\s*=\s*("[^"]*"|'[^']*')/g, "").trim();
    if (remainder) risks.push({ message: `<${name}> has unparseable attributes near "${remainder.slice(0, 40)}"` });
    if (!selfClosing) stack.push(name);
  }
  for (const name of stack) risks.push({ message: `unclosed <${name}>` });
  return risks;
}

function dividerRisks(svg, segments) {
  const boxes = inkTextBoxes(svg);
  const risks = [];
  for (const seg of segments) {
    const isDivider = seg.role === "divider" || /data-role=["']divider["']/.test(seg.raw);
    if (!isDivider || seg.y1 !== seg.y2) continue;
    const left = Math.min(seg.x1, seg.x2);
    const right = Math.max(seg.x1, seg.x2);
    for (const box of boxes) {
      if (seg.y1 <= box.top || seg.y1 >= box.bottom) continue;
      if (Math.min(right, box.right) - Math.max(left, box.left) <= 0) continue;
      risks.push({ label: box.label, y: seg.y1 });
      break;
    }
  }
  return risks;
}

function canvasShapeRisks(svg) {
  const match = /<svg\b([^>]*)>/.exec(svg);
  if (!match) return [];
  const a = attrs(match[1]);
  const viewBox = String(a.viewBox || "").trim().split(/[\s,]+/).map(Number);
  const width = num(a.width, viewBox.length === 4 ? viewBox[2] : 0);
  const height = num(a.height, viewBox.length === 4 ? viewBox[3] : 0);
  if (!(width > 0 && height > 0)) return [];
  const ratio = width / height;
  if (ratio <= maxAspectRatio) return [];
  return [{ width, height, ratio }];
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

function embeddedCellRoles(svg) {
  const roles = new Map();
  const content = /\bcontent="([^"]*)"/.exec(svg)?.[1];
  if (!content) return roles;
  const decoded = content
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
  for (const match of decoded.matchAll(/<mxCell\b([^>]*)\/?\s*>/g)) {
    const cell = attrs(match[1]);
    if (cell.id && cell["data-role"]) roles.set(cell.id, cell["data-role"]);
  }
  return roles;
}

function enclosingCellRole(svg, index, roles) {
  const start = svg.lastIndexOf('<g data-cell-id="', index);
  if (start < 0) return "";
  const opening = svg.slice(start, svg.indexOf(">", start) + 1);
  const id = /data-cell-id="([^"]+)"/.exec(opening)?.[1];
  return id ? roles.get(id) || "" : "";
}

function lineSegments(svg) {
  const segments = [];
  const roles = embeddedCellRoles(svg);
  for (const match of svg.matchAll(/<line\b([^>]*)\/?>/g)) {
    const a = attrs(match[1]);
    segments.push({
      raw: match[0],
      role: a["data-role"] || enclosingCellRole(svg, match.index, roles),
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
        role: a["data-role"] || enclosingCellRole(svg, match.index, roles),
        x1: points[i].x,
        y1: points[i].y,
        x2: points[i + 1].x,
        y2: points[i + 1].y,
        strokeWidth: num(a["stroke-width"], 1),
        // marker-end sits on the final vertex only. Attributing it to every
        // sub-segment reports a short intermediate jog as an oversized
        // arrowhead that is not drawn there at all.
        markerEnd: i + 2 === points.length ? a["marker-end"] || "" : "",
      });
    }
  }
  for (const match of svg.matchAll(/<path\b([^>]*)\/?>/g)) {
    const a = attrs(match[1]);
    if (!a.d) continue;
    for (const subpath of pathSubpaths(a.d)) {
      for (let i = 0; i + 1 < subpath.length; i += 1) {
        segments.push({
          raw: match[0].slice(0, 120),
          role: a["data-role"] || enclosingCellRole(svg, match.index, roles),
          x1: subpath[i].x,
          y1: subpath[i].y,
          x2: subpath[i + 1].x,
          y2: subpath[i + 1].y,
          strokeWidth: num(a["stroke-width"], 1),
          markerEnd: i + 2 === subpath.length ? a["marker-end"] || "" : "",
        });
      }
    }
  }
  return segments;
}

// Number of parameters each path command consumes per repetition, and how many
// trailing ones are the endpoint. Control points are not vertices: treating them
// as such is what made every Graphviz SVG report a dozen phantom connectors.
const PATH_COMMANDS = {
  m: { arity: 2, endpoint: 2 },
  l: { arity: 2, endpoint: 2 },
  h: { arity: 1, endpoint: 1 },
  v: { arity: 1, endpoint: 1 },
  c: { arity: 6, endpoint: 2 },
  s: { arity: 4, endpoint: 2 },
  q: { arity: 4, endpoint: 2 },
  t: { arity: 2, endpoint: 2 },
  a: { arity: 7, endpoint: 2 },
  z: { arity: 0, endpoint: 0 },
};

// Reading every number in a `d` attribute as an x,y pair turns "V572 H440" into
// a diagonal that cuts across the whole figure, and reports it as a connector
// through whatever text it passes. Parse the commands instead.
function pathSubpaths(d) {
  const subpaths = [];
  let current = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  for (const command of String(d).matchAll(/([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g)) {
    const letter = command[1];
    const spec = PATH_COMMANDS[letter.toLowerCase()];
    if (!spec) continue;
    const relative = letter === letter.toLowerCase();
    const numbers = [...command[2].matchAll(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g)].map((m) => Number(m[0]));
    if (spec.arity === 0) {
      if (current.length) current.push({ x: startX, y: startY });
      x = startX;
      y = startY;
      continue;
    }
    for (let index = 0; index + spec.arity <= numbers.length; index += spec.arity) {
      const group = numbers.slice(index, index + spec.arity);
      if (spec.endpoint === 1) {
        const value = group[0];
        if (letter.toLowerCase() === "h") x = relative ? x + value : value;
        else y = relative ? y + value : value;
      } else {
        const [dx, dy] = group.slice(-2);
        x = relative ? x + dx : dx;
        y = relative ? y + dy : dy;
      }
      // A moveto starts a new subpath; only its repeats are implicit linetos.
      if (letter.toLowerCase() === "m" && index === 0) {
        if (current.length > 1) subpaths.push(current);
        current = [{ x, y }];
        startX = x;
        startY = y;
        continue;
      }
      if (!current.length) {
        current.push({ x, y });
        startX = x;
        startY = y;
        continue;
      }
      current.push({ x, y });
    }
  }
  if (current.length > 1) subpaths.push(current);
  return subpaths;
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
        // Carry the authored role through. Without it the title is identified
        // by "bold and first", which a badge line above the title breaks — the
        // linter then demands body spacing where the layout applied title
        // spacing, and every badged card reports a false overlap.
        role: a["data-role"] || "",
        fontSize: fontSizeOf(a, 16),
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
    const fill = String(rect.fill || "").toLowerCase();
    if (rect.stroke === "none" && (fill === "#fff" || fill === "#ffffff" || fill === "white")) continue;
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
      const font = fontSizeOf(a, 16);
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
  classSizes = classFontSizes(svg);
  const boxes = textBoxes(svg);
  const segments = lineSegments(svg);
  const markers = markerDefs(svg);
  const hits = [];
  for (const box of boxes) {
    for (const seg of segments) {
      if (seg.role === "divider" || /data-role=["']divider["']/.test(seg.raw)) continue;
      if (seg.role === "canvas" || /data-role=["']canvas["']/.test(seg.raw)) continue;
      if (segmentIntersectsBox(seg, box)) {
        hits.push({ label: box.label, segment: seg.raw });
        break;
      }
    }
  }
  const arrowRisks = arrowheadRisks(segments, markers);
  const rectTextRisks = textInsideRectRisks(svg);
  const lineRisks = textLineOverlapRisks(svg);
  const collisionRisks = textCollisionRisks(svg);
  const shapeRisks = canvasShapeRisks(svg);
  const markup = markupRisks(svg);
  const dividers = dividerRisks(svg, segments);
  if (markup.length || dividers.length || hits.length || arrowRisks.length || rectTextRisks.length || lineRisks.length || collisionRisks.length || shapeRisks.length) {
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
    for (const risk of collisionRisks.slice(0, 20)) {
      console.error(
        `- text collides with text: "${risk.first}" / "${risk.second}", overlap ${risk.overlapX.toFixed(1)} x ${risk.overlapY.toFixed(1)} px`
      );
    }
    for (const risk of markup.slice(0, 10)) {
      console.error(`- malformed markup: ${risk.message}`);
    }
    for (const risk of dividers.slice(0, 10)) {
      console.error(`- divider crosses text: "${risk.label}" at y=${risk.y}`);
    }
    for (const risk of shapeRisks) {
      console.error(
        `- canvas too wide to read at page width: ${risk.width} x ${risk.height} px, ratio ${risk.ratio.toFixed(2)} exceeds ${maxAspectRatio}`
      );
    }
    const hidden = hits.length + arrowRisks.length + rectTextRisks.length + lineRisks.length + collisionRisks.length - 100;
    if (hidden > 0) console.error(`- ${hidden} more`);
  } else {
    console.log(`[ok] ${file}`);
  }
}

process.exit(failed ? 1 : 0);
