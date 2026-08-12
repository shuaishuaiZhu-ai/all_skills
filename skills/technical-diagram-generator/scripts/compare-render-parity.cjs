"use strict";

const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const TARGET_WIDTH = 2000;
const ACTIVE_CHANNEL_DELTA = 12;
const ASPECT_THRESHOLD_PERCENT = 0.5;
const VISIBLE_BOUNDS_THRESHOLD_PERCENT = 0.5;
const ACTIVE_COVERAGE_THRESHOLD_PERCENTAGE_POINTS = 1.5;
// Calibrated from four valid Draw.io 31.1.8 exports, including native-SVG CJK
// component text and the source-backed add1 regression; update only with fresh
// fixture measurements.
const MEAN_ABSOLUTE_RGB_DIFFERENCE_THRESHOLD = 16.81;
const LOCAL_GRID_COLUMNS = 24;
const LOCAL_GRID_ROWS = 14;
const LOCAL_ACTIVE_MASK_MISMATCH_THRESHOLD_PERCENT = 25.893;
const LOCAL_WINDOWS = [{ name: "cell", width: 84, height: 76 }, { name: "label-connector", width: 84, height: 24 }];
const STRONG_CHANNEL_MAX = 200;
const LOCAL_STRONG_MISMATCH_THRESHOLD_PERCENT = 19.108;
const KERNEL = sharp.kernel.lanczos3;

class ParityError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function emptyMetrics() {
  return {
    rawAspectDeltaPercent: null,
    rawVisibleBoundsDeltaPercent: null,
    aspectDeltaPercent: null,
    visibleBoundsDeltaPercent: null,
    visibleBoundsAlignmentDeltaPercent: null,
    activeCoverageDeltaPercentagePoints: null,
    meanAbsoluteRgbDifference: null,
    localActiveMaskMismatchPercent: null,
    localActiveMaskMismatchByScalePercent: null,
    localStrongMismatchPercent: null,
    svg: null,
    png: null,
  };
}

function thresholds() {
  return {
    aspectDeltaPercent: ASPECT_THRESHOLD_PERCENT,
    visibleBoundsDeltaPercent: VISIBLE_BOUNDS_THRESHOLD_PERCENT,
    visibleBoundsAlignmentDeltaPercent: VISIBLE_BOUNDS_THRESHOLD_PERCENT,
    activeCoverageDeltaPercentagePoints: ACTIVE_COVERAGE_THRESHOLD_PERCENTAGE_POINTS,
    meanAbsoluteRgbDifference: MEAN_ABSOLUTE_RGB_DIFFERENCE_THRESHOLD,
    localActiveMaskMismatchPercent: LOCAL_ACTIVE_MASK_MISMATCH_THRESHOLD_PERCENT,
    localStrongMismatchPercent: LOCAL_STRONG_MISMATCH_THRESHOLD_PERCENT,
  };
}

function parseArguments(argv) {
  const positionals = [];
  let reportPath = null;
  let errorMessage = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--json") {
      const candidate = argv[index + 1];
      if (!candidate || candidate.startsWith("-") || reportPath) errorMessage = errorMessage || "--json requires one .json report path.";
      else if (path.extname(candidate).toLowerCase() !== ".json") { errorMessage = errorMessage || "--json report path must end in .json."; index += 1; }
      else { reportPath = path.resolve(candidate); index += 1; }
    } else if (argv[index].startsWith("--")) {
      errorMessage = errorMessage || `Unknown or incomplete argument: ${argv[index]}`;
    } else {
      positionals.push(argv[index]);
    }
  }
  const svgPath = positionals[0] ? path.resolve(positionals[0]) : null;
  const pngPath = positionals[1] ? path.resolve(positionals[1]) : null;
  errorMessage = errorMessage || (positionals.length !== 2 ? "Expected <diagram.drawio.svg> <diagram.drawio.png> [--json <report.json>]." : null);
  const inputs = { svgPath, pngPath, reportPath };
  if (reportPath && (reportPath === svgPath || reportPath === pngPath)) errorMessage = errorMessage || "--json report path must differ from both inputs.";
  if (errorMessage) throw Object.assign(new ParityError("E_PARITY_INPUT", errorMessage), { inputs });
  return inputs;
}

function validateInputs({ svgPath, pngPath }) {
  if (svgPath === pngPath) {
    throw new ParityError("E_PARITY_INPUT", "SVG and PNG inputs resolve to the same path.");
  }
  for (const inputPath of [svgPath, pngPath]) {
    let stat;
    try {
      stat = fs.statSync(inputPath);
    } catch {
      throw new ParityError("E_PARITY_INPUT", `Input file does not exist: ${inputPath}`);
    }
    if (!stat.isFile()) {
      throw new ParityError("E_PARITY_INPUT", `Input path is not a file: ${inputPath}`);
    }
  }
}

function isWhite(data, offset) {
  return data[offset] >= 255 - ACTIVE_CHANNEL_DELTA &&
    data[offset + 1] >= 255 - ACTIVE_CHANNEL_DELTA &&
    data[offset + 2] >= 255 - ACTIVE_CHANNEL_DELTA;
}

function activeStats(data, width, height) {
  let activePixels = 0;
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isWhite(data, (y * width + x) * 3)) {
        activePixels += 1;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
    }
  }
  if (activePixels === 0) {
    return { activePixels, coveragePercent: 0, bounds: null, pixelBounds: null };
  }
  return {
    activePixels,
    coveragePercent: (activePixels / (width * height)) * 100,
    pixelBounds: { left, right, top, bottom },
    bounds: {
      left: left / width,
      right: right / width,
      top: top / height,
      bottom: bottom / height,
    },
    center: { x: (left + right) / (2 * width), y: (top + bottom) / (2 * height) },
  };
}

function cropRaw(data, width, height, pixelBounds) {
  if (!pixelBounds) return { data, width, height };
  const croppedWidth = pixelBounds.right - pixelBounds.left;
  const croppedHeight = pixelBounds.bottom - pixelBounds.top;
  const cropped = Buffer.alloc(croppedWidth * croppedHeight * 3);
  for (let row = 0; row < croppedHeight; row += 1) {
    const sourceStart = ((row + pixelBounds.top) * width + pixelBounds.left) * 3;
    data.copy(cropped, row * croppedWidth * 3, sourceStart, sourceStart + croppedWidth * 3);
  }
  return { data: cropped, width: croppedWidth, height: croppedHeight };
}

async function normalize(inputPath) {
  let raster;
  try {
    raster = await sharp(inputPath, { density: 144, limitInputPixels: false })
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new ParityError("E_PARITY_INPUT", `Unable to read ${inputPath}: ${error.message}`);
  }
  const source = { data: raster.data, width: raster.info.width, height: raster.info.height };
  if (source.width < 2 || source.height < 2) {
    throw new ParityError("E_PARITY_INPUT", `Image dimensions are invalid: ${inputPath}`);
  }
  const rawStats = activeStats(source.data, source.width, source.height);
  const effective = cropRaw(source.data, source.width, source.height, rawStats.pixelBounds);
  const normalized = await sharp(effective.data, {
    raw: { width: effective.width, height: effective.height, channels: 3 },
  })
    .resize({ width: TARGET_WIDTH, kernel: KERNEL })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stats = activeStats(normalized.data, normalized.info.width, normalized.info.height);
  const outerWhitespace = rawStats.pixelBounds ? {
    left: rawStats.pixelBounds.left,
    right: source.width - rawStats.pixelBounds.right,
    top: rawStats.pixelBounds.top,
    bottom: source.height - rawStats.pixelBounds.bottom,
    strippedToVisibleContent: true,
  } : { left: 0, right: 0, top: 0, bottom: 0, strippedToVisibleContent: false };
  return {
    rawWidth: source.width,
    rawHeight: source.height,
    effectiveWidth: effective.width,
    effectiveHeight: effective.height,
    normalizedWidth: normalized.info.width,
    normalizedHeight: normalized.info.height,
    rawAspectRatio: source.width / source.height,
    aspectRatio: effective.width / effective.height,
    outerWhitespace,
    rawVisibleBounds: rawStats.bounds,
    rawVisibleCenter: rawStats.center,
    data: normalized.data,
    ...stats,
  };
}

function maximumBoundsDeltaPercent(first, second) {
  return Math.max(
    Math.abs(first.left - second.left),
    Math.abs(first.right - second.right),
    Math.abs(first.top - second.top),
    Math.abs(first.bottom - second.bottom),
  ) * 100;
}

function visibleBoundsAlignmentDeltaPercent(first, second) {
  return Math.max(Math.abs(first.x - second.x), Math.abs(first.y - second.y)) * 100;
}

function tileActiveMaskMismatchPercent(first, second) {
  const width = TARGET_WIDTH;
  const height = Math.max(first.normalizedHeight, second.normalizedHeight);
  const firstIntegral = new Uint32Array((width + 1) * (height + 1));
  const secondIntegral = new Uint32Array((width + 1) * (height + 1));
  const firstStrong = new Uint32Array((width + 1) * (height + 1));
  const secondStrong = new Uint32Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y += 1) for (let x = 1; x <= width; x += 1) {
    const firstY = Math.min(first.normalizedHeight - 1, Math.floor((y - 1) * first.normalizedHeight / height));
    const secondY = Math.min(second.normalizedHeight - 1, Math.floor((y - 1) * second.normalizedHeight / height));
    const a = isWhite(first.data, (firstY * width + x - 1) * 3) ? 0 : 1;
    const b = isWhite(second.data, (secondY * width + x - 1) * 3) ? 0 : 1;
    const at = y * (width + 1) + x; const up = (y - 1) * (width + 1) + x;
    firstIntegral[at] = a + firstIntegral[up] + firstIntegral[at - 1] - firstIntegral[up - 1];
    secondIntegral[at] = b + secondIntegral[up] + secondIntegral[at - 1] - secondIntegral[up - 1];
    const sa = Math.min(first.data[(firstY * width + x - 1) * 3], first.data[(firstY * width + x - 1) * 3 + 1], first.data[(firstY * width + x - 1) * 3 + 2]) <= STRONG_CHANNEL_MAX ? 1 : 0;
    const sb = Math.min(second.data[(secondY * width + x - 1) * 3], second.data[(secondY * width + x - 1) * 3 + 1], second.data[(secondY * width + x - 1) * 3 + 2]) <= STRONG_CHANNEL_MAX ? 1 : 0;
    firstStrong[at] = sa + firstStrong[up] + firstStrong[at - 1] - firstStrong[up - 1];
    secondStrong[at] = sb + secondStrong[up] + secondStrong[at - 1] - secondStrong[up - 1];
  }
  const scores = {};
  let strongLargest = 0;
  for (const window of LOCAL_WINDOWS) {
    let largest = 0;
    for (let top = 0; top <= height - window.height; top += 1) for (let left = 0; left <= width - window.width; left += 1) {
      const right = left + window.width; const bottom = top + window.height;
      const sum = (integral) => integral[bottom * (width + 1) + right] - integral[top * (width + 1) + right] - integral[bottom * (width + 1) + left] + integral[top * (width + 1) + left];
      largest = Math.max(largest, Math.abs(sum(firstIntegral) - sum(secondIntegral)) / (window.width * window.height));
      strongLargest = Math.max(strongLargest, Math.abs(sum(firstStrong) - sum(secondStrong)) / (window.width * window.height));
    }
    scores[window.name] = largest * 100;
  }
  return { score: Math.max(...Object.values(scores)), scores, strongScore: strongLargest * 100 };
}

function meanAbsoluteRgbDifference(first, second) {
  const width = TARGET_WIDTH;
  const height = Math.max(first.normalizedHeight, second.normalizedHeight);
  let total = 0;
  const pixels = width * height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const firstOffset = y < first.normalizedHeight ? (y * width + x) * 3 : -1;
      const secondOffset = y < second.normalizedHeight ? (y * width + x) * 3 : -1;
      for (let channel = 0; channel < 3; channel += 1) {
        const firstValue = firstOffset < 0 ? 255 : first.data[firstOffset + channel];
        const secondValue = secondOffset < 0 ? 255 : second.data[secondOffset + channel];
        total += Math.abs(firstValue - secondValue);
      }
    }
  }
  return total / (pixels * 3);
}

function drawioVersion() {
  const executable = "C:\\Program Files\\draw.io\\draw.io.exe";
  if (process.platform !== "win32" || !fs.existsSync(executable)) return null;
  try {
    return execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", `(Get-Item -LiteralPath '${executable}').VersionInfo.ProductVersion`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim() || null;
  } catch {
    return null;
  }
}

function imageReport(image) {
  return {
    rawWidth: image.rawWidth,
    rawHeight: image.rawHeight,
    effectiveWidth: image.effectiveWidth,
    effectiveHeight: image.effectiveHeight,
    rawAspectRatio: image.rawAspectRatio,
    aspectRatio: image.aspectRatio,
    normalizedWidth: image.normalizedWidth,
    normalizedHeight: image.normalizedHeight,
    outerWhitespace: image.outerWhitespace,
    rawVisibleBounds: image.rawVisibleBounds,
    rawVisibleCenter: image.rawVisibleCenter,
    activeCoveragePercent: image.coveragePercent,
    visibleBounds: image.bounds,
  };
}

function baseReport(inputs) {
  return {
    inputs: { svg: inputs?.svgPath ?? null, png: inputs?.pngPath ?? null },
    versions: { sharp: sharp.versions.sharp, drawio: drawioVersion() },
    normalization: {
      targetWidth: TARGET_WIDTH,
      kernel: "lanczos3",
      activePixelChannelDeltaFromWhite: ACTIVE_CHANNEL_DELTA,
      outerBorderPolicy: "Strip outer whitespace for content-normalized aspect, coverage, global diff, and local-grid comparison. Bounds use visible-content centers in original normalized canvas, tolerating symmetric padding while measuring one-sided translation.",
      localGrid: { windows: LOCAL_WINDOWS, scanStride: 1, activeMaskMetric: "maximum sliding-window active-coverage delta", strongMetric: `maximum sliding-window strong-foreground coverage delta (minimum RGB channel <= ${STRONG_CHANNEL_MAX})`, strongThresholdPercent: LOCAL_STRONG_MISMATCH_THRESHOLD_PERCENT },
    },
    metrics: emptyMetrics(),
    thresholds: thresholds(),
    pass: false,
    errorCodes: [],
  };
}

function compare(svg, png, report) {
  report.metrics.svg = imageReport(svg);
  report.metrics.png = imageReport(png);
  report.metrics.rawAspectDeltaPercent = Math.abs(svg.rawAspectRatio - png.rawAspectRatio) / svg.rawAspectRatio * 100;
  if (svg.rawVisibleBounds && png.rawVisibleBounds) {
    report.metrics.rawVisibleBoundsDeltaPercent = maximumBoundsDeltaPercent(svg.rawVisibleBounds, png.rawVisibleBounds);
    report.metrics.visibleBoundsAlignmentDeltaPercent = visibleBoundsAlignmentDeltaPercent(svg.rawVisibleCenter, png.rawVisibleCenter);
    report.metrics.visibleBoundsDeltaPercent = report.metrics.visibleBoundsAlignmentDeltaPercent;
  }
  report.metrics.aspectDeltaPercent = Math.abs(svg.aspectRatio - png.aspectRatio) / svg.aspectRatio * 100;
  report.metrics.activeCoverageDeltaPercentagePoints = Math.abs(svg.coveragePercent - png.coveragePercent);
  if (svg.bounds && png.bounds) {
    report.metrics.meanAbsoluteRgbDifference = meanAbsoluteRgbDifference(svg, png);
    const local = tileActiveMaskMismatchPercent(svg, png);
    report.metrics.localActiveMaskMismatchPercent = local.score;
    report.metrics.localActiveMaskMismatchByScalePercent = local.scores;
    report.metrics.localStrongMismatchPercent = local.strongScore;
  }

  if (!svg.bounds || !png.bounds) report.errorCodes.push("E_PARITY_EMPTY");
  if (report.metrics.aspectDeltaPercent > ASPECT_THRESHOLD_PERCENT) report.errorCodes.push("E_PARITY_ASPECT");
  if (report.metrics.visibleBoundsAlignmentDeltaPercent !== null && report.metrics.visibleBoundsAlignmentDeltaPercent > VISIBLE_BOUNDS_THRESHOLD_PERCENT) report.errorCodes.push("E_PARITY_BOUNDS");
  if (report.metrics.activeCoverageDeltaPercentagePoints > ACTIVE_COVERAGE_THRESHOLD_PERCENTAGE_POINTS) report.errorCodes.push("E_PARITY_ACTIVE");
  if (report.metrics.meanAbsoluteRgbDifference !== null && report.metrics.meanAbsoluteRgbDifference > MEAN_ABSOLUTE_RGB_DIFFERENCE_THRESHOLD) report.errorCodes.push("E_PARITY_DIFF");
  if (report.metrics.localActiveMaskMismatchPercent !== null && report.metrics.localActiveMaskMismatchPercent > LOCAL_ACTIVE_MASK_MISMATCH_THRESHOLD_PERCENT) report.errorCodes.push("E_PARITY_LOCAL");
  if (report.metrics.localStrongMismatchPercent !== null && report.metrics.localStrongMismatchPercent > LOCAL_STRONG_MISMATCH_THRESHOLD_PERCENT && !report.errorCodes.includes("E_PARITY_LOCAL")) report.errorCodes.push("E_PARITY_LOCAL");
  report.pass = report.errorCodes.length === 0;
}

function writeJsonAtomically(reportPath, report) {
  const directory = path.dirname(reportPath);
  const temporaryPath = path.join(directory, `.${path.basename(reportPath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, reportPath);
}

async function main() {
  let inputs;
  let report;
  try {
    inputs = parseArguments(process.argv.slice(2));
    report = baseReport(inputs);
    validateInputs(inputs);
    const [svg, png] = await Promise.all([normalize(inputs.svgPath), normalize(inputs.pngPath)]);
    compare(svg, png, report);
  } catch (error) {
    inputs = inputs || error.inputs;
    report = report || baseReport(inputs);
    report.errorCodes = [error instanceof ParityError ? error.code : "E_PARITY_INPUT"];
    report.error = error instanceof Error ? error.message : String(error);
  }

  const reportPath = inputs?.reportPath;
  if (reportPath) {
    try {
      writeJsonAtomically(reportPath, report);
    } catch (error) {
      report.pass = false;
      if (!report.errorCodes.includes("E_PARITY_INPUT")) report.errorCodes.push("E_PARITY_INPUT");
      report.error = `Unable to write JSON report: ${error.message}`;
    }
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.pass) process.exitCode = 1;
}

main();
