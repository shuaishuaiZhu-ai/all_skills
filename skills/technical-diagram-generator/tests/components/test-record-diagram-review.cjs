"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const scriptPath = path.resolve(__dirname, "../../scripts/record-diagram-review.cjs");
assert.equal(fs.existsSync(scriptPath), true, "record-diagram-review module must exist");

const { recordDiagramReview } = require(scriptPath);

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function reportFor(artifactPath, status = "visual-pending") {
  return {
    schemaVersion: 1,
    status,
    requestedFormat: "drawio",
    requestedDeliverables: ["drawio"],
    checks: [{ name: "drawio strict lint", pass: true }],
    errors: [],
    artifacts: { authored: [{ kind: "drawio", path: artifactPath, sha256: sha256File(artifactPath) }], temporary: [] },
    reviews: { pageWidth: "pending", fullSize: "pending", notes: "" },
  };
}

function writeReport(reportPath, report) {
  const text = `${JSON.stringify(report, null, 2)}\n`;
  fs.writeFileSync(reportPath, text, "utf8");
  return text;
}

function review(pageWidth, fullSize, notes = "Reviewed at both required sizes") {
  return { pageWidth, fullSize, notes };
}

function expectedReceiptPath(reportPath, reportText) {
  const extension = path.extname(reportPath);
  const stem = path.basename(reportPath, extension);
  return path.join(path.dirname(reportPath), `${stem}.review-${sha256Bytes(reportText)}.json`);
}

function receiptFiles(root) {
  return fs.readdirSync(root).filter((name) => /\.review-[a-f0-9]{64}\.json$/u.test(name));
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tdg-review-"));
try {
  const artifactPath = path.join(root, "diagram.drawio.png");
  const reportPath = path.join(root, "diagram.quality.json");
  fs.writeFileSync(artifactPath, "first render", "utf8");

  const rejectedReports = [
    { ...reportFor(artifactPath), checks: [{ name: "drawio strict lint", pass: false }], errors: [{ code: "E_DRAWIO_LAYOUT" }] },
    { ...reportFor(artifactPath), requestedDeliverables: ["svg"] },
    { ...reportFor(artifactPath), artifacts: { authored: [{ kind: "svg", path: artifactPath, sha256: sha256File(artifactPath) }], temporary: [] } },
  ];
  rejectedReports.forEach((invalidReport, index) => {
    const invalidPath = path.join(root, `invalid-${index}.quality.json`);
    writeReport(invalidPath, invalidReport);
    assert.throws(
      () => recordDiagramReview({ reportPath: invalidPath, ...review("pass", "pass") }),
      (error) => error && error.code === "E_REVIEW_QUALITY_GATE",
      `invalid automated report ${index} must not receive a review receipt`,
    );
  });

  const reportText = writeReport(reportPath, reportFor(artifactPath));
  const reportHash = sha256Bytes(reportText);
  const result = recordDiagramReview({ reportPath, ...review("pass", "pass", "Visual inspection completed") });
  const receiptPath = expectedReceiptPath(reportPath, reportText);
  assert.equal(result.receiptPath, receiptPath, "return value must expose the content-addressed receipt path");
  assert.equal(fs.readFileSync(reportPath, "utf8"), reportText, "successful review must not rewrite the quality report");
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.status, "ready");
  assert.deepEqual(receipt.reviews, review("pass", "pass", "Visual inspection completed"));
  assert.deepEqual(receipt.qualityReport, { path: reportPath, sha256: reportHash });
  assert.deepEqual(receipt.artifacts.authored, [{ path: artifactPath, sha256: sha256File(artifactPath) }]);

  const idempotent = recordDiagramReview({ reportPath, ...review("pass", "pass", "Visual inspection completed") });
  assert.equal(idempotent.receiptPath, receiptPath, "an identical review may reuse the same immutable receipt");
  assert.equal(receiptFiles(root).length, 1, "idempotent review must not create extra receipts");

  fs.unlinkSync(receiptPath);
  const failedReportText = writeReport(reportPath, reportFor(artifactPath));
  const failedResult = recordDiagramReview({ reportPath, ...review("fail", "pass", "Page-width labels overlap") });
  assert.equal(fs.readFileSync(reportPath, "utf8"), failedReportText, "failed review must also leave the quality report immutable");
  const failedReceipt = JSON.parse(fs.readFileSync(failedResult.receiptPath, "utf8"));
  assert.equal(failedReceipt.status, "failed");
  assert.equal(failedReceipt.errors[0].code, "E_REVIEW_AUTOMATION_FAILED");
  fs.unlinkSync(failedResult.receiptPath);

  assert.throws(
    () => recordDiagramReview({ reportPath, ...review("pass", "pass", "   ") }),
    (error) => error && error.code === "E_REVIEW_NOTES_REQUIRED",
  );
  writeReport(reportPath, reportFor(artifactPath, "ready"));
  assert.throws(
    () => recordDiagramReview({ reportPath, ...review("pass", "pass") }),
    (error) => error && error.code === "E_REVIEW_STATUS",
  );

  fs.writeFileSync(artifactPath, "changed artifact", "utf8");
  const changedReportText = writeReport(reportPath, reportFor(artifactPath));
  fs.writeFileSync(artifactPath, "changed after report", "utf8");
  assert.throws(
    () => recordDiagramReview({ reportPath, ...review("pass", "pass") }),
    (error) => error && error.code === "E_REVIEW_ARTIFACT_CHANGED",
  );
  assert.equal(fs.readFileSync(reportPath, "utf8"), changedReportText);
  assert.equal(receiptFiles(root).length, 0);

  fs.writeFileSync(artifactPath, "conflict render", "utf8");
  const conflictReportText = writeReport(reportPath, reportFor(artifactPath));
  const conflictReceiptPath = expectedReceiptPath(reportPath, conflictReportText);
  fs.writeFileSync(conflictReceiptPath, "foreign receipt\n", "utf8");
  assert.throws(
    () => recordDiagramReview({ reportPath, ...review("pass", "pass") }),
    (error) => error && error.code === "E_REVIEW_CONFLICT",
    "exclusive creation must reject an existing receipt with different content",
  );
  assert.equal(fs.readFileSync(conflictReceiptPath, "utf8"), "foreign receipt\n", "conflicting receipt must not be overwritten");
  fs.unlinkSync(conflictReceiptPath);

  fs.writeFileSync(artifactPath, "post-write race render", "utf8");
  const raceReportText = writeReport(reportPath, reportFor(artifactPath));
  const raceReceiptPath = expectedReceiptPath(reportPath, raceReportText);
  const originalReadFileSync = fs.readFileSync;
  let artifactSwapped = false;
  fs.readFileSync = function readReceiptThenSwapArtifact(filePath, ...args) {
    const value = originalReadFileSync.call(this, filePath, ...args);
    if (!artifactSwapped && path.resolve(filePath) === path.resolve(raceReceiptPath)) {
      artifactSwapped = true;
      fs.writeFileSync(artifactPath, "swapped after receipt write", "utf8");
    }
    return value;
  };
  try {
    assert.throws(
      () => recordDiagramReview({ reportPath, ...review("pass", "pass") }),
      (error) => error && error.code === "E_REVIEW_ARTIFACT_CHANGED",
      "an artifact change found by post-write verification must block ready",
    );
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
  assert.equal(artifactSwapped, true, "test must replace the artifact after receipt creation");
  assert.equal(fs.existsSync(raceReceiptPath), false, "a still-owned receipt must be removed after post-write failure");
  assert.equal(fs.readFileSync(reportPath, "utf8"), raceReportText);

  fs.writeFileSync(artifactPath, "post-write report race render", "utf8");
  const reportRaceText = writeReport(reportPath, reportFor(artifactPath));
  const reportRaceReceiptPath = expectedReceiptPath(reportPath, reportRaceText);
  let reportSwapped = false;
  fs.readFileSync = function readReportThenSwap(filePath, ...args) {
    const value = originalReadFileSync.call(this, filePath, ...args);
    if (!reportSwapped && path.resolve(filePath) === path.resolve(reportPath) && fs.existsSync(reportRaceReceiptPath)) {
      reportSwapped = true;
      fs.writeFileSync(reportPath, `${reportRaceText} `, "utf8");
    }
    return value;
  };
  try {
    assert.throws(
      () => recordDiagramReview({ reportPath, ...review("pass", "pass") }),
      (error) => error && error.code === "E_REVIEW_REPORT_CHANGED",
      "a quality-report change found after receipt creation must block ready",
    );
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
  assert.equal(reportSwapped, true, "test must replace the quality report after receipt creation");
  assert.equal(fs.existsSync(reportRaceReceiptPath), false, "a still-owned receipt must be removed after report revalidation fails");

  fs.writeFileSync(artifactPath, "receipt replacement render", "utf8");
  const replacedReportText = writeReport(reportPath, reportFor(artifactPath));
  const replacedReceiptPath = expectedReceiptPath(reportPath, replacedReportText);
  const foreignReceipt = "replacement from another process\n";
  let receiptReplaced = false;
  fs.readFileSync = function readThenReplaceReceipt(filePath, ...args) {
    const value = originalReadFileSync.call(this, filePath, ...args);
    if (!receiptReplaced && path.resolve(filePath) === path.resolve(replacedReceiptPath)) {
      receiptReplaced = true;
      fs.unlinkSync(replacedReceiptPath);
      fs.writeFileSync(replacedReceiptPath, foreignReceipt, "utf8");
    }
    return value;
  };
  try {
    assert.throws(
      () => recordDiagramReview({ reportPath, ...review("pass", "pass") }),
      (error) => error && error.code === "E_REVIEW_CONFLICT",
      "a receipt replaced during post-write verification must not be accepted",
    );
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
  assert.equal(receiptReplaced, true);
  assert.equal(fs.readFileSync(replacedReceiptPath, "utf8"), foreignReceipt, "cleanup must preserve a receipt no longer owned by this invocation");
  fs.unlinkSync(replacedReceiptPath);

  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tdg-review-external-"));
  const linkedArtifactDir = path.join(root, "linked-artifacts");
  try {
    const externalArtifactPath = path.join(externalRoot, "external.png");
    fs.writeFileSync(externalArtifactPath, "external artifact", "utf8");
    fs.symlinkSync(externalRoot, linkedArtifactDir, "junction");
    const escapedArtifactPath = path.join(linkedArtifactDir, "external.png");
    const escapedReport = reportFor(artifactPath);
    escapedReport.artifacts.authored[0] = { kind: "drawio", path: escapedArtifactPath, sha256: sha256File(externalArtifactPath) };
    const escapedReportText = writeReport(reportPath, escapedReport);
    assert.throws(
      () => recordDiagramReview({ reportPath, ...review("pass", "pass") }),
      (error) => error && error.code === "E_REVIEW_ARTIFACT_UNSAFE",
      "artifact realpaths outside the report directory must be rejected",
    );
    assert.equal(fs.readFileSync(reportPath, "utf8"), escapedReportText);
  } finally {
    fs.rmSync(linkedArtifactDir, { recursive: true, force: true });
    fs.rmSync(externalRoot, { recursive: true, force: true });
  }

  const externalReportRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tdg-review-report-external-"));
  const linkedReportDir = path.join(root, "linked-reports");
  try {
    fs.writeFileSync(artifactPath, "external report artifact", "utf8");
    const externalReportPath = path.join(externalReportRoot, "external.quality.json");
    writeReport(externalReportPath, reportFor(artifactPath));
    fs.symlinkSync(externalReportRoot, linkedReportDir, "junction");
    assert.throws(
      () => recordDiagramReview({ reportPath: path.join(linkedReportDir, "external.quality.json"), ...review("pass", "pass") }),
      (error) => error && error.code === "E_REVIEW_REPORT_UNSAFE",
      "a report reached through a symlink or junction parent must be rejected",
    );
  } finally {
    fs.rmSync(linkedReportDir, { recursive: true, force: true });
    fs.rmSync(externalReportRoot, { recursive: true, force: true });
  }

  fs.writeFileSync(artifactPath, "cli render", "utf8");
  const cliReportText = writeReport(reportPath, reportFor(artifactPath));
  const cli = childProcess.spawnSync(process.execPath, [
    scriptPath,
    "--report", reportPath,
    "--page-width", "pass",
    "--full-size", "pass",
    "--notes", "CLI visual inspection completed",
  ], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  const cliResult = JSON.parse(cli.stdout);
  assert.equal(cliResult.receiptPath, expectedReceiptPath(reportPath, cliReportText));
  assert.equal(fs.readFileSync(reportPath, "utf8"), cliReportText, "CLI must preserve the immutable report");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("PASS test-record-diagram-review");
