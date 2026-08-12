"use strict";

// Threat model: cooperative offline build/review processes. The immutable,
// exclusive receipt prevents accidental overwrites and detects changes during
// this operation; it does not claim to defeat a malicious writer that keeps
// replacing files at the instant the function returns.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

class ReviewError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReviewError";
    this.code = code;
  }
}

function parseArguments(argv) {
  const names = new Set(["--report", "--page-width", "--full-size", "--notes"]);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!names.has(name) || value === undefined || values[name] !== undefined) {
      throw new ReviewError("E_CLI_USAGE", "Usage: record-diagram-review.cjs --report <json> --page-width pass|fail --full-size pass|fail --notes <text>");
    }
    values[name] = value;
    index += 1;
  }
  if (!values["--report"] || !values["--page-width"] || !values["--full-size"] || values["--notes"] === undefined) {
    throw new ReviewError("E_CLI_USAGE", "--report, --page-width, --full-size, and --notes are required");
  }
  return {
    reportPath: values["--report"],
    pageWidth: values["--page-width"],
    fullSize: values["--full-size"],
    notes: values["--notes"],
  };
}

function validateReview(review) {
  if (!review || !new Set(["pass", "fail"]).has(review.pageWidth) || !new Set(["pass", "fail"]).has(review.fullSize)) {
    throw new ReviewError("E_REVIEW_VALUE", "pageWidth and fullSize must be pass or fail");
  }
  if (typeof review.notes !== "string" || review.notes.trim() === "") {
    throw new ReviewError("E_REVIEW_NOTES_REQUIRED", "Review notes must be non-blank");
  }
}

function validateAutomatedReport(report) {
  const expectedByFormat = {
    svg: ["svg"],
    drawio: ["drawio"],
    both: ["svg", "drawio"],
  };
  const expectedKinds = expectedByFormat[report && report.requestedFormat];
  const deliverables = report && report.requestedDeliverables;
  const checks = report && report.checks;
  const errors = report && report.errors;
  const authored = report && report.artifacts && report.artifacts.authored;
  const authoredKinds = Array.isArray(authored) ? authored.map((artifact) => artifact && artifact.kind) : [];
  const sameList = (left, right) => Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);

  if (!expectedKinds ||
      !sameList(deliverables, expectedKinds) ||
      !Array.isArray(checks) || checks.length === 0 || checks.some((check) => !check || check.pass !== true) ||
      !Array.isArray(errors) || errors.length !== 0 ||
      !sameList(authoredKinds, expectedKinds)) {
    throw new ReviewError("E_REVIEW_QUALITY_GATE", "The automated quality report is not a successful, internally consistent release candidate");
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function identityFor(stats) {
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs,
  };
}

function sameIdentity(left, right) {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertNoLinkedComponent(filePath, code, label) {
  const resolved = path.resolve(filePath);
  const parsed = path.parse(resolved);
  const relative = resolved.slice(parsed.root.length);
  let current = parsed.root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stats;
    try {
      stats = fs.lstatSync(current);
    } catch {
      throw new ReviewError(code, `${label} is unavailable: ${filePath}`);
    }
    if (stats.isSymbolicLink()) {
      throw new ReviewError(code, `${label} must not traverse a symlink or junction: ${filePath}`);
    }
  }
}

function assertRegularFile(filePath, code, label) {
  let stats;
  try {
    stats = fs.lstatSync(filePath);
  } catch {
    throw new ReviewError(code, `${label} is unavailable: ${filePath}`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new ReviewError(code, `${label} must be a regular file: ${filePath}`);
  }
  return stats;
}

function readStableFile(filePath, unsafeCode, changedCode, label) {
  const before = assertRegularFile(filePath, unsafeCode, label);
  let bytes;
  try {
    bytes = fs.readFileSync(filePath);
  } catch {
    throw new ReviewError(changedCode, `${label} changed or is unavailable: ${filePath}`);
  }
  const after = assertRegularFile(filePath, unsafeCode, label);
  if (!sameIdentity(identityFor(before), identityFor(after))) {
    throw new ReviewError(changedCode, `${label} changed while being read: ${filePath}`);
  }
  return { bytes, identity: identityFor(after), sha256: sha256(bytes) };
}

function reportContext(reportPath) {
  const resolved = path.resolve(reportPath);
  assertNoLinkedComponent(resolved, "E_REVIEW_REPORT_UNSAFE", "Review report");
  const reportDirectory = path.dirname(resolved);
  const realDirectory = fs.realpathSync(reportDirectory);
  const realReport = fs.realpathSync(resolved);
  if (path.dirname(realReport) !== realDirectory) {
    throw new ReviewError("E_REVIEW_REPORT_UNSAFE", `Review report escaped its directory: ${resolved}`);
  }
  return { reportPath: resolved, reportDirectory, realDirectory };
}

function readReportSnapshot(context) {
  const snapshot = readStableFile(
    context.reportPath,
    "E_REVIEW_REPORT_UNSAFE",
    "E_REVIEW_REPORT_CHANGED",
    "Review report",
  );
  let report;
  try {
    report = JSON.parse(snapshot.bytes.toString("utf8"));
  } catch {
    throw new ReviewError("E_REVIEW_REPORT_INVALID", `Review report is not valid JSON: ${context.reportPath}`);
  }
  return { report, snapshot };
}

function artifactSnapshots(report, context) {
  const authored = report && report.artifacts && report.artifacts.authored;
  if (!Array.isArray(authored) || authored.length === 0) {
    throw new ReviewError("E_REVIEW_ARTIFACT_CHANGED", "No authored artifacts are available for review");
  }
  return authored.map((artifact) => {
    if (!artifact || typeof artifact.path !== "string" || artifact.path.trim() === "" || typeof artifact.sha256 !== "string" || artifact.sha256 === "") {
      throw new ReviewError("E_REVIEW_ARTIFACT_CHANGED", "An authored artifact is missing its path or hash");
    }
    const artifactPath = path.resolve(context.reportDirectory, artifact.path);
    assertNoLinkedComponent(artifactPath, "E_REVIEW_ARTIFACT_UNSAFE", "Authored artifact");
    let realArtifact;
    try {
      realArtifact = fs.realpathSync(artifactPath);
    } catch {
      throw new ReviewError("E_REVIEW_ARTIFACT_CHANGED", `Authored artifact is unavailable: ${artifact.path}`);
    }
    if (!isWithin(context.realDirectory, realArtifact)) {
      throw new ReviewError("E_REVIEW_ARTIFACT_UNSAFE", `Authored artifact escaped the review report directory: ${artifact.path}`);
    }
    const snapshot = readStableFile(
      artifactPath,
      "E_REVIEW_ARTIFACT_UNSAFE",
      "E_REVIEW_ARTIFACT_CHANGED",
      "Authored artifact",
    );
    if (snapshot.sha256 !== artifact.sha256) {
      throw new ReviewError("E_REVIEW_ARTIFACT_CHANGED", `Authored artifact changed: ${artifact.path}`);
    }
    return { path: artifact.path, resolvedPath: artifactPath, sha256: snapshot.sha256, identity: snapshot.identity };
  });
}

function revalidateReport(context, expected) {
  const current = readStableFile(
    context.reportPath,
    "E_REVIEW_REPORT_UNSAFE",
    "E_REVIEW_REPORT_CHANGED",
    "Review report",
  );
  if (current.sha256 !== expected.sha256 || !sameIdentity(current.identity, expected.identity)) {
    throw new ReviewError("E_REVIEW_REPORT_CHANGED", `Review report changed during review: ${context.reportPath}`);
  }
}

function revalidateArtifacts(report, context, expected) {
  const current = artifactSnapshots(report, context);
  if (current.length !== expected.length) {
    throw new ReviewError("E_REVIEW_ARTIFACT_CHANGED", "The authored artifact set changed during review");
  }
  for (let index = 0; index < current.length; index += 1) {
    if (current[index].sha256 !== expected[index].sha256 || !sameIdentity(current[index].identity, expected[index].identity)) {
      throw new ReviewError("E_REVIEW_ARTIFACT_CHANGED", `Authored artifact changed during review: ${expected[index].path}`);
    }
  }
}

function applyReview(report, review, snapshots = [], qualityReport = {}) {
  if (!report || report.status !== "visual-pending") {
    throw new ReviewError("E_REVIEW_STATUS", "Only visual-pending reports can be reviewed");
  }
  validateAutomatedReport(report);
  validateReview(review);
  const passed = review.pageWidth === "pass" && review.fullSize === "pass";
  return {
    schemaVersion: 1,
    status: passed ? "ready" : "failed",
    qualityReport: { path: qualityReport.path || "", sha256: qualityReport.sha256 || "" },
    artifacts: {
      authored: snapshots.map((artifact) => ({ path: artifact.path, sha256: artifact.sha256 })),
    },
    reviews: { pageWidth: review.pageWidth, fullSize: review.fullSize, notes: review.notes },
    errors: passed ? [] : [{ code: "E_REVIEW_AUTOMATION_FAILED", message: "Visual review did not pass", causes: [] }],
  };
}

function receiptPathFor(reportPath, reportHash) {
  const extension = path.extname(reportPath);
  const stem = path.basename(reportPath, extension);
  return path.join(path.dirname(reportPath), `${stem}.review-${reportHash}.json`);
}

function exclusiveWriteReceipt(receiptPath, text) {
  let descriptor;
  try {
    descriptor = fs.openSync(receiptPath, "wx", 0o600);
    fs.writeFileSync(descriptor, text, "utf8");
    fs.fsyncSync(descriptor);
    const identity = identityFor(fs.fstatSync(descriptor));
    fs.closeSync(descriptor);
    return { created: true, identity, sha256: sha256(text) };
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
    if (error.code !== "EEXIST") throw error;
    const existing = readStableFile(receiptPath, "E_REVIEW_CONFLICT", "E_REVIEW_CONFLICT", "Review receipt");
    if (existing.bytes.toString("utf8") !== text) {
      throw new ReviewError("E_REVIEW_CONFLICT", `A different review receipt already exists: ${receiptPath}`);
    }
    return { created: false, identity: existing.identity, sha256: existing.sha256 };
  }
}

function revalidateReceipt(receiptPath, expectedText, ownership) {
  const current = readStableFile(receiptPath, "E_REVIEW_CONFLICT", "E_REVIEW_CONFLICT", "Review receipt");
  if (current.bytes.toString("utf8") !== expectedText || current.sha256 !== ownership.sha256 || !sameIdentity(current.identity, ownership.identity)) {
    throw new ReviewError("E_REVIEW_CONFLICT", `Review receipt changed during verification: ${receiptPath}`);
  }
}

function cleanupOwnedReceipt(receiptPath, ownership) {
  if (!ownership.created) return;
  try {
    const current = readStableFile(receiptPath, "E_REVIEW_CONFLICT", "E_REVIEW_CONFLICT", "Review receipt");
    if (current.sha256 === ownership.sha256 && sameIdentity(current.identity, ownership.identity)) {
      fs.unlinkSync(receiptPath);
    }
  } catch {
    // Preserve anything that cannot still be proven to be this invocation's receipt.
  }
}

function recordDiagramReview(options) {
  const context = reportContext(options.reportPath);
  const { report, snapshot: reportSnapshot } = readReportSnapshot(context);
  if (!report || report.status !== "visual-pending") {
    throw new ReviewError("E_REVIEW_STATUS", "Only visual-pending reports can be reviewed");
  }
  validateReview(options);
  validateAutomatedReport(report);
  const artifacts = artifactSnapshots(report, context);
  const receipt = applyReview(report, options, artifacts, {
    path: context.reportPath,
    sha256: reportSnapshot.sha256,
  });
  const receiptPath = receiptPathFor(context.reportPath, reportSnapshot.sha256);
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;

  revalidateReport(context, reportSnapshot);
  revalidateArtifacts(report, context, artifacts);
  const ownership = exclusiveWriteReceipt(receiptPath, receiptText);
  try {
    revalidateReceipt(receiptPath, receiptText, ownership);
    revalidateReport(context, reportSnapshot);
    revalidateArtifacts(report, context, artifacts);
    revalidateReceipt(receiptPath, receiptText, ownership);
  } catch (error) {
    cleanupOwnedReceipt(receiptPath, ownership);
    throw error;
  }
  return { receiptPath, receipt };
}

function main() {
  try {
    const result = recordDiagramReview(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.code || "E_REVIEW_FAILED"}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { ReviewError, applyReview, parseArguments, receiptPathFor, recordDiagramReview };
