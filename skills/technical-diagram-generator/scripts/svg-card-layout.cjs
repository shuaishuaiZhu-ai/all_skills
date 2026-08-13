// Shared with svgkit.py, drawiokit.py and both linters. See the file's _readme.
const TOKENS = require("../assets/layout-constants.json");

const DEFAULT_TOP_PADDING = TOKENS.cardTopPadding;
const DEFAULT_BOTTOM_PADDING = TOKENS.cardBottomPadding;
const DEFAULT_TITLE_BODY_GAP = TOKENS.titleBodyGap;
const DEFAULT_BODY_LINE_GAP = TOKENS.bodyLineGap;
const DEFAULT_BODY_LINE_MIN_GAP = TOKENS.bodyLineMinGap;
const DEFAULT_OVERLAP_TOLERANCE = TOKENS.overlapTolerancePx;

function toNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isTitleLine(line, index = 0) {
  const weight = String(line.fontWeight || "").toLowerCase();
  return (
    index === 0 &&
    (line.role === "title" ||
      line.textAnchor === "middle" ||
      weight === "bold" ||
      weight === "bolder" ||
      toNumber(weight, 0) >= 700)
  );
}

function requiredBaselineGap(prev, cur, index, options = {}) {
  const maxFont = Math.max(prev.fontSize, cur.fontSize);
  const isTitleTransition = isTitleLine(prev, index - 1) && !isTitleLine(cur, index);
  const statusDividerGap = cur.role === "status" ? (options.statusDividerGap || 0) : 0;
  if (isTitleTransition) {
    return maxFont * (options.titleBodyGapFactor || DEFAULT_TITLE_BODY_GAP) + statusDividerGap;
  }
  return maxFont * (options.bodyLineGapFactor || DEFAULT_BODY_LINE_GAP) + statusDividerGap;
}

function lintBaselineGap(prev, cur, index, options = {}) {
  const maxFont = Math.max(prev.fontSize, cur.fontSize);
  const isTitleTransition = isTitleLine(prev, index - 1) && !isTitleLine(cur, index);
  if (isTitleTransition) {
    return maxFont * (options.titleBodyGapFactor || DEFAULT_TITLE_BODY_GAP);
  }
  return maxFont * (options.bodyLineMinGapFactor || DEFAULT_BODY_LINE_MIN_GAP);
}

function lineBox(line) {
  return {
    top: line.y - line.fontSize * 0.9,
    bottom: line.y + line.fontSize * 0.28,
  };
}

function lineOverlapRisks(lines, options = {}) {
  const sorted = [...lines].sort((a, b) => a.y - b.y || a.x - b.x);
  const risks = [];
  const overlapTolerance = options.overlapTolerance ?? DEFAULT_OVERLAP_TOLERANCE;
  const gapTolerance = options.gapTolerance ?? 0.5;
  for (let index = 1; index < sorted.length; index += 1) {
    const prev = sorted[index - 1];
    const cur = sorted[index];
    const gap = cur.y - prev.y;
    const minGap = lintBaselineGap(prev, cur, index, options);
    const prevBox = lineBox(prev);
    const curBox = lineBox(cur);
    const overlap = prevBox.bottom - curBox.top;
    if (gap < minGap - gapTolerance || overlap > overlapTolerance) {
      risks.push({
        previous: prev,
        current: cur,
        gap,
        minGap,
        overlap,
      });
    }
  }
  return risks;
}

function layoutTextStack({ rect, lines, padding = {}, options = {} }) {
  const topPadding = padding.top ?? DEFAULT_TOP_PADDING;
  const bottomPadding = padding.bottom ?? DEFAULT_BOTTOM_PADDING;
  const sorted = [...lines].sort((a, b) => a.y - b.y || a.x - b.x);
  if (!sorted.length) {
    return {
      lines: [],
      requiredHeight: rect.height,
      expands: false,
    };
  }

  const laidOut = [];
  const minFirstY = rect.y + topPadding + sorted[0].fontSize * 0.9;
  let y = options.preserveFirstY ? Math.max(sorted[0].y, minFirstY) : minFirstY;
  laidOut.push({ ...sorted[0], y });
  for (let index = 1; index < sorted.length; index += 1) {
    const prev = laidOut[index - 1];
    const cur = sorted[index];
    y = prev.y + requiredBaselineGap(prev, cur, index, options);
    laidOut.push({ ...cur, y });
  }

  const last = laidOut[laidOut.length - 1];
  const requiredBottom = last.y + last.fontSize * 0.28 + bottomPadding;
  const requiredHeight = Math.max(rect.height, Math.ceil(requiredBottom - rect.y));
  return {
    lines: laidOut,
    requiredHeight,
    expands: requiredHeight > rect.height,
  };
}

module.exports = {
  DEFAULT_BODY_LINE_GAP,
  DEFAULT_BODY_LINE_MIN_GAP,
  DEFAULT_BOTTOM_PADDING,
  DEFAULT_OVERLAP_TOLERANCE,
  DEFAULT_TITLE_BODY_GAP,
  DEFAULT_TOP_PADDING,
  isTitleLine,
  layoutTextStack,
  lineBox,
  lineOverlapRisks,
  lintBaselineGap,
  requiredBaselineGap,
};
