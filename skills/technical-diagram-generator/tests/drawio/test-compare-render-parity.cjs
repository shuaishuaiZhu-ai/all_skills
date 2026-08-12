"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");

const testDirectory = __dirname;
const skillDirectory = path.resolve(testDirectory, "..", "..");
const exporter = path.join(skillDirectory, "scripts", "export-drawio.ps1");
const comparator = path.join(skillDirectory, "scripts", "compare-render-parity.cjs");
const validFixture = path.join(testDirectory, "valid-formal-flow.drawio");
const readOnlySample = "C:\\Users\\18355\\Documents\\learning\\diagram-work\\add1-compile-registry-tool-compare\\drawio-route-tdg.drawio";
const cropFixture = path.join(testDirectory, "parity-invalid-crop.png");
const drawioExecutable = "C:\\Program Files\\draw.io\\draw.io.exe";
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "drawio-parity-test-"));
const worktreeRoot = path.resolve(skillDirectory, "..", "..");
const worktreeStatusBefore = execFileSync("git", ["-c", `safe.directory=${worktreeRoot}`, "status", "--porcelain"], { encoding: "utf8" });
const committedCrop = {
  sha256: "E3A802C910DC093B91FFF055E70301E87C1569F5809E565718FEDE7907226B96",
  width: 2481,
  height: 1648,
};
const calibration = {
  validFormalFlowDiff: 5.483672827804107,
  externalSampleDiff: 3.961471843003413,
  generatedComponentDiff: 10.070891990291262,
  generatedAdd1Diff: 14.001623376623376,
  meanDiffThreshold: 16.81,
  validFormalFlowLocal: 21.577380952380953,
  externalSampleLocal: 18.452380952380953,
  localThreshold: 25.893,
  validFormalFlowStrongLocal: 15.922619047619047,
  externalSampleStrongLocal: 10.863095238095239,
  strongLocalThreshold: 19.108,
};

function exportDiagram(inputPath, baseName) {
  const outputDirectory = path.join(testRoot, baseName);
  const output = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      exporter,
      "-InputPath",
      inputPath,
      "-OutputDirectory",
      outputDirectory,
      "-DrawioExecutable",
      drawioExecutable,
      "-BaseName",
      baseName,
    ],
    { encoding: "utf8" },
  );
  assert.match(output, /DrawioVersion|PreviewPath/, "Task 5 exporter must report an export object");
  return {
    svg: path.join(outputDirectory, `${baseName}.drawio.svg`),
    png: path.join(outputDirectory, `${baseName}.drawio.png`),
  };
}

function runComparator(svgPath, pngPath, reportPath, extraArgs = []) {
  const result = spawnSync(
    process.execPath,
    [comparator, svgPath, pngPath, ...extraArgs, ...(reportPath ? ["--json", reportPath] : [])],
    { encoding: "utf8", env: process.env },
  );
  const text = result.stdout.trim() || result.stderr.trim();
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    report = null;
  }
  return { ...result, report, text };
}

function runComparatorArgs(args) {
  const result = spawnSync(process.execPath, [comparator, ...args], { encoding: "utf8", env: process.env });
  const text = result.stdout.trim() || result.stderr.trim();
  let report;
  try { report = JSON.parse(text); } catch { report = null; }
  return { ...result, report, text };
}

function assertPass(result, label) {
  assert.equal(result.status, 0, `${label} must pass: ${result.text}`);
  assert.ok(result.report, `${label} must print a JSON report`);
  assert.equal(result.report.pass, true, `${label} report must pass`);
  assert.deepEqual(result.report.errorCodes, [], `${label} must have no error codes`);
}

function assertContentError(result, allowedCodes, label) {
  assert.notEqual(result.status, 0, `${label} must fail`);
  assert.ok(result.report, `${label} must print a JSON report`);
  assert.equal(result.report.pass, false, `${label} report must fail`);
  assert.ok(
    result.report.errorCodes.some((code) => allowedCodes.includes(code)),
    `${label} must include one of ${allowedCodes.join(", ")}: ${result.text}`,
  );
}

async function fileSnapshot(filePath) {
  const stat = fs.statSync(filePath);
  const metadata = await sharp(filePath).metadata();
  return {
    sha256: crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").toUpperCase(),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    width: metadata.width,
    height: metadata.height,
  };
}

async function assertCommittedCrop(snapshot) {
  assert.equal(snapshot.sha256, committedCrop.sha256, "committed crop fixture SHA changed");
  assert.equal(snapshot.width, committedCrop.width, "committed crop fixture width changed");
  assert.equal(snapshot.height, committedCrop.height, "committed crop fixture height changed");
}

async function eraseRectangle(inputPath, outputPath, rectangle) {
  await sharp(inputPath)
    .composite([{
      input: { create: { width: rectangle.width, height: rectangle.height, channels: 3, background: "white" } },
      left: rectangle.left,
      top: rectangle.top,
    }])
    .png()
    .toFile(outputPath);
}

async function translateDown(inputPath, outputPath, pixels) {
  const metadata = await sharp(inputPath).metadata();
  await sharp({ create: { width: metadata.width, height: metadata.height, channels: 3, background: "white" } })
    .composite([{ input: inputPath, left: 0, top: pixels }])
    .png()
    .toFile(outputPath);
}

function assertInputErrorJson(result, reportPath, expectedInputs, label) {
  assertContentError(result, ["E_PARITY_INPUT"], label);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, "utf8")), result.report, `${label} report must be written atomically`);
  assert.deepEqual(result.report.inputs, expectedInputs, `${label} must preserve available absolute input paths`);
}

async function main() {
  assert.ok(fs.existsSync(validFixture), `missing valid fixture: ${validFixture}`);
  assert.ok(fs.existsSync(readOnlySample), `missing external read-only sample: ${readOnlySample}`);
  assert.ok(fs.existsSync(cropFixture), `missing committed crop fixture: ${cropFixture}`);
  const cropBefore = await fileSnapshot(cropFixture);
  await assertCommittedCrop(cropBefore);
  const valid = exportDiagram(validFixture, "valid-formal-flow");
  const external = exportDiagram(readOnlySample, "drawio-route-tdg");

  const validReportPath = path.join(testRoot, "valid-report.json");
  const validResult = runComparator(valid.svg, valid.png, validReportPath);
  assertPass(validResult, "valid formal flow");
  assert.deepEqual(JSON.parse(fs.readFileSync(validReportPath, "utf8")), validResult.report, "JSON report must be atomically written and match stdout");
  assert.equal(validResult.report.inputs.svg, path.resolve(valid.svg), "report must resolve SVG input");
  assert.equal(validResult.report.inputs.png, path.resolve(valid.png), "report must resolve PNG input");
  assert.equal(validResult.report.versions.sharp, sharp.versions.sharp, "report must record exact Sharp version");
  assert.match(validResult.report.versions.drawio, /^31\./, "report must record Draw.io 31.x export version");
  for (const key of ["aspectDeltaPercent", "visibleBoundsDeltaPercent", "visibleBoundsAlignmentDeltaPercent", "activeCoverageDeltaPercentagePoints", "meanAbsoluteRgbDifference", "localActiveMaskMismatchPercent"]) {
    assert.equal(typeof validResult.report.metrics[key], "number", `report is missing numeric ${key}`);
  }
  for (const key of ["aspectDeltaPercent", "visibleBoundsDeltaPercent", "visibleBoundsAlignmentDeltaPercent", "activeCoverageDeltaPercentagePoints", "meanAbsoluteRgbDifference", "localActiveMaskMismatchPercent"]) {
    assert.equal(typeof validResult.report.thresholds[key], "number", `report is missing numeric ${key} threshold`);
  }
  assert.ok(validResult.report.metrics.visibleBoundsAlignmentDeltaPercent > 0, "valid bounds alignment must retain non-zero shared-coordinate information");
  assert.ok(Math.abs(validResult.report.metrics.meanAbsoluteRgbDifference - calibration.validFormalFlowDiff) < 0.001, "valid-formal-flow raw mean diff drifted; recalibrate with fresh real exports");
  assert.equal(validResult.report.thresholds.meanAbsoluteRgbDifference, calibration.meanDiffThreshold, "mean-diff threshold must stay at the recorded calibration value");
  assert.equal(validResult.report.thresholds.aspectDeltaPercent, 0.5, "aspect threshold must remain locked");
  assert.equal(validResult.report.thresholds.visibleBoundsAlignmentDeltaPercent, 0.5, "bounds threshold must remain locked");
  assert.equal(validResult.report.thresholds.activeCoverageDeltaPercentagePoints, 1.5, "coverage threshold must remain locked");
  assert.ok(Math.abs(validResult.report.metrics.visibleBoundsAlignmentDeltaPercent - 0.031486) < 0.001, "formal bounds alignment drifted");
  assert.ok(Math.abs(validResult.report.metrics.localActiveMaskMismatchPercent - calibration.validFormalFlowLocal) < 0.001, "valid-formal-flow local mismatch drifted; recalibrate with fresh real exports");
  assert.equal(validResult.report.thresholds.localActiveMaskMismatchPercent, calibration.localThreshold, "local threshold must stay at the recorded calibration value");
  assert.equal(typeof validResult.report.metrics.localStrongMismatchPercent, "number", "report must include strong local metric");
  assert.equal(validResult.report.thresholds.localStrongMismatchPercent, calibration.strongLocalThreshold, "strong local threshold must stay locked");
  assert.ok(Math.abs(validResult.report.metrics.localStrongMismatchPercent - calibration.validFormalFlowStrongLocal) < 0.001, "formal strong local calibration drifted");

  const externalResult = runComparator(external.svg, external.png, path.join(testRoot, "external-report.json"));
  assertPass(externalResult, "external real sample");
  assert.ok(Math.abs(externalResult.report.metrics.meanAbsoluteRgbDifference - calibration.externalSampleDiff) < 0.001, "external sample raw mean diff drifted; recalibrate with fresh real exports");
  assert.ok(Math.abs(externalResult.report.metrics.localActiveMaskMismatchPercent - calibration.externalSampleLocal) < 0.001, "external sample local mismatch drifted; recalibrate with fresh real exports");
  assert.ok(Math.abs(externalResult.report.metrics.localStrongMismatchPercent - calibration.externalSampleStrongLocal) < 0.001, "add1 strong local calibration drifted");
  assert.ok(Math.abs(externalResult.report.metrics.visibleBoundsAlignmentDeltaPercent - 0.125278) < 0.001, "add1 bounds alignment drifted");
  assert.ok(
    calibration.meanDiffThreshold >= Math.max(calibration.validFormalFlowDiff, calibration.externalSampleDiff, calibration.generatedComponentDiff, calibration.generatedAdd1Diff) * 1.2,
    "calibrated mean-diff threshold must retain at least a 20% margin over all valid real exports",
  );
  assert.ok(calibration.localThreshold >= Math.max(calibration.validFormalFlowLocal, calibration.externalSampleLocal) * 1.2, "local threshold must retain at least a 20% margin over both valid real exports");
  assert.ok(calibration.strongLocalThreshold >= Math.max(calibration.validFormalFlowStrongLocal, calibration.externalSampleStrongLocal) * 1.2, "strong local threshold must retain at least a 20% margin over both valid real exports");

  const cropped = runComparator(valid.svg, cropFixture, path.join(testRoot, "crop-report.json"));
  assertContentError(cropped, ["E_PARITY_ASPECT", "E_PARITY_BOUNDS"], "visible-side crop");
  const renamedCrop = path.join(testRoot, "different-name.png");
  fs.copyFileSync(cropFixture, renamedCrop);
  const renamed = runComparator(valid.svg, renamedCrop, path.join(testRoot, "renamed-crop-report.json"));
  assert.deepEqual(renamed.report.errorCodes, cropped.report.errorCodes, "content errors must not depend on the filename");

  const translated = path.join(testRoot, "translated-content.png");
  await translateDown(valid.png, translated, 20);
  const translatedResult = runComparator(valid.svg, translated, path.join(testRoot, "translated-report.json"));
  assertContentError(translatedResult, ["E_PARITY_BOUNDS"], "translated content");
  assert.ok(Math.abs(translatedResult.report.metrics.visibleBoundsAlignmentDeltaPercent - 0.724181) < 0.001, "20px translation bounds alignment drifted");

  const missingStatus = path.join(testRoot, "missing-status-label.png");
  await eraseRectangle(valid.png, missingStatus, { left: 170, top: 825, width: 400, height: 90 });
  assertContentError(runComparator(valid.svg, missingStatus, path.join(testRoot, "missing-status-report.json")), ["E_PARITY_LOCAL"], "missing status label");
  const missingConnector = path.join(testRoot, "missing-connector-segment.png");
  await eraseRectangle(valid.png, missingConnector, { left: 850, top: 640, width: 130, height: 35 });
  const connectorResult = runComparator(valid.svg, missingConnector, path.join(testRoot, "missing-connector-report.json"));
  assertContentError(connectorResult, ["E_PARITY_LOCAL"], "missing connector segment");
  assert.ok(Math.abs(connectorResult.report.metrics.localStrongMismatchPercent - 27.529762) < 0.001, `connector strong score drifted: ${connectorResult.report.metrics.localStrongMismatchPercent}`);
  const oldTileCenter = path.join(testRoot, "missing-old-tile-center.png");
  const oldTileIntersection = path.join(testRoot, "missing-old-tile-intersection.png");
  await eraseRectangle(valid.png, oldTileCenter, { left: 100, top: 430, width: 80, height: 20 });
  await eraseRectangle(valid.png, oldTileIntersection, { left: 180, top: 430, width: 80, height: 20 });
  const centerResult = runComparator(valid.svg, oldTileCenter, path.join(testRoot, "old-tile-center-report.json"));
  const intersectionResult = runComparator(valid.svg, oldTileIntersection, path.join(testRoot, "old-tile-intersection-report.json"));
  assertContentError(centerResult, ["E_PARITY_LOCAL"], "80x20 missing block at old tile center");
  assertContentError(intersectionResult, ["E_PARITY_LOCAL"], "80x20 missing block at old tile intersection");
  assert.ok(Math.abs(centerResult.report.metrics.localActiveMaskMismatchPercent - intersectionResult.report.metrics.localActiveMaskMismatchPercent) < 1, "sliding local score must not depend on old tile boundaries");

  const blank = path.join(testRoot, "blank.png");
  await sharp({ create: { width: 160, height: 100, channels: 3, background: "white" } }).png().toFile(blank);
  assertContentError(runComparator(valid.svg, blank, null), ["E_PARITY_EMPTY"], "blank input");
  const samePathReport = path.join(testRoot, "same-path-report.json");
  assertInputErrorJson(runComparator(valid.svg, valid.svg, samePathReport), samePathReport, { svg: path.resolve(valid.svg), png: path.resolve(valid.svg) }, "same-path input");
  const missingPath = path.join(testRoot, "missing.svg");
  const missingReport = path.join(testRoot, "missing-report.json");
  assertInputErrorJson(runComparator(missingPath, valid.png, missingReport), missingReport, { svg: path.resolve(missingPath), png: path.resolve(valid.png) }, "missing input");
  const unknownReport = path.join(testRoot, "unknown-report.json");
  assertInputErrorJson(runComparator(valid.svg, valid.png, unknownReport, ["--unknown"]), unknownReport, { svg: path.resolve(valid.svg), png: path.resolve(valid.png) }, "unknown flag");
  const oneInputReport = path.join(testRoot, "one-input-report.json");
  assertInputErrorJson(runComparatorArgs([valid.svg, "--json", oneInputReport]), oneInputReport, { svg: path.resolve(valid.svg), png: null }, "one input with later json");
  const orderedReport = path.join(testRoot, "ordered-report.json");
  assertPass(runComparatorArgs(["--json", orderedReport, valid.svg, valid.png]), "json-first valid order");
  assert.ok(fs.existsSync(orderedReport), "json-first order must write report");
  const invalidJsonPath = path.join(testRoot, "not-json.svg");
  assertContentError(runComparatorArgs([valid.svg, valid.png, "--json", invalidJsonPath]), ["E_PARITY_INPUT"], "non-json report destination");
  assert.equal(fs.existsSync(invalidJsonPath), false, "non-json destination must not be written");
  assertContentError(runComparatorArgs([valid.svg, valid.png, "--json", "--unknown"]), ["E_PARITY_INPUT"], "json followed by flag");
  assertContentError(runComparatorArgs([valid.svg, valid.png, "--json"]), ["E_PARITY_INPUT"], "json missing value");
  assertContentError(runComparatorArgs([valid.svg, valid.png, "--json", valid.svg]), ["E_PARITY_INPUT"], "report/input collision");

  const cropAfter = await fileSnapshot(cropFixture);
  assert.deepEqual(cropAfter, cropBefore, "tests must not rewrite the committed crop fixture");

  console.log(`PASS sharp=${sharp.versions.sharp} validDiff=${validResult.report.metrics.meanAbsoluteRgbDifference} externalDiff=${externalResult.report.metrics.meanAbsoluteRgbDifference}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  const worktreeStatusAfter = execFileSync("git", ["-c", `safe.directory=${worktreeRoot}`, "status", "--porcelain"], { encoding: "utf8" });
  assert.equal(worktreeStatusAfter, worktreeStatusBefore, "tests must leave the worktree status unchanged");
});
