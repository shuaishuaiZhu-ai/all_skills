const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createQualityReport,
  createStagingRoot,
  promoteArtifacts,
  resolveDeliveryPlan,
  sha256File,
  writeJsonAtomically,
} = require("../../scripts/diagram-artifacts.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tdg-artifacts-"));

function inside(rootPath, childPath) {
  const relative = path.relative(rootPath, childPath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function writeStagedArtifacts(stagingRoot, plan) {
  for (const artifact of plan.authored) {
    fs.writeFileSync(path.join(stagingRoot, artifact.stagingName || path.basename(artifact.path)), `${artifact.kind} output`, "utf8");
  }
}

function assertNoTemporaryFiles(directory) {
  assert.equal(
    fs.readdirSync(directory).some((name) => name.includes(".tmp-")),
    false,
    "failed operation must not leave temporary files",
  );
}

try {
  const first = resolveDeliveryPlan(root, "first-diagram", "both");
  assert.deepEqual(first.authored.map((item) => path.basename(item.path)), ["first-diagram.svg", "first-diagram.drawio"]);
  assert.ok(first.authored.every((item) => inside(root, item.path)));
  assert.ok(inside(root, first.reportPath));

  fs.writeFileSync(path.join(root, "diagram.svg"), "manual svg", "utf8");
  fs.writeFileSync(path.join(root, "diagram.drawio"), "manual drawio", "utf8");
  const svgBefore = sha256File(path.join(root, "diagram.svg"));
  const drawioBefore = sha256File(path.join(root, "diagram.drawio"));
  const candidate = resolveDeliveryPlan(root, "diagram", "both");
  assert.deepEqual(candidate.authored.map((item) => path.basename(item.path)), [
    "diagram.generated.svg",
    "diagram.generated.drawio",
  ]);
  assert.equal(sha256File(path.join(root, "diagram.svg")), svgBefore);
  assert.equal(sha256File(path.join(root, "diagram.drawio")), drawioBefore);

  for (const [baseName, expectedName] of [
    ["stable-base", "stable-base.svg"],
    ["stable-generated", "stable-generated.generated.svg"],
    ["stable-generated-v2", "stable-generated-v2.generated-v2.svg"],
  ]) {
    if (baseName !== "stable-base") fs.writeFileSync(path.join(root, `${baseName}.svg`), "manual", "utf8");
    if (baseName === "stable-generated-v2") fs.writeFileSync(path.join(root, `${baseName}.generated.svg`), "candidate", "utf8");
    const stablePlan = resolveDeliveryPlan(root, baseName, "svg");
    const stableStaging = createStagingRoot(root, `${baseName}-run`);
    assert.equal(path.basename(stablePlan.authored[0].path), expectedName);
    assert.equal(stablePlan.authored[0].stagingName, `${baseName}.svg`);
    writeStagedArtifacts(stableStaging, stablePlan);
    assert.equal(promoteArtifacts(stableStaging, stablePlan).code, "OK");
    assert.equal(fs.readFileSync(stablePlan.authored[0].path, "utf8"), "svg output");
  }

  fs.writeFileSync(path.join(root, "preserve.svg"), "manual source", "utf8");
  const preserveBefore = sha256File(path.join(root, "preserve.svg"));
  const preservePlan = resolveDeliveryPlan(root, "preserve", "svg");
  const preserveStaging = createStagingRoot(root, "preserve-run");
  assert.ok(inside(root, preserveStaging));
  writeStagedArtifacts(preserveStaging, preservePlan);
  assert.equal(promoteArtifacts(preserveStaging, preservePlan).code, "OK");
  assert.equal(sha256File(path.join(root, "preserve.svg")), preserveBefore);
  assert.equal(fs.readFileSync(preservePlan.authored[0].path, "utf8"), "svg output");

  for (const suffix of [".generated", ".generated-v2", ".generated-v3"]) {
    for (const kind of ["svg", "drawio"]) {
      fs.writeFileSync(path.join(root, `diagram${suffix}.${kind}`), `${suffix} ${kind}`, "utf8");
    }
  }
  const v4 = resolveDeliveryPlan(root, "diagram", "both");
  assert.deepEqual(v4.authored.map((item) => path.basename(item.path)), [
    "diagram.generated-v4.svg",
    "diagram.generated-v4.drawio",
  ]);

  fs.writeFileSync(path.join(root, "candidate-only.generated.svg"), "candidate", "utf8");
  const candidateOnly = resolveDeliveryPlan(root, "candidate-only", "svg");
  assert.equal(path.basename(candidateOnly.authored[0].path), "candidate-only.generated-v2.svg");

  for (const unsafeName of [null, "", "   ", ".", "..", "../escape", "nested/file", "nested\\file", "/absolute", "C:\\absolute", "C:relative", "bad\0name"]) {
    assert.throws(() => resolveDeliveryPlan(root, unsafeName, "svg"), /baseName/i, `must reject unsafe baseName ${String(unsafeName)}`);
    assert.throws(() => createStagingRoot(root, unsafeName), /runId/i, `must reject unsafe runId ${String(unsafeName)}`);
  }

  const staleStaging = createStagingRoot(root, "stale-run");
  assert.throws(
    () => createStagingRoot(root, "stale-run"),
    (error) => error && error.code === "E_STAGING_EXISTS" && error.path === staleStaging,
    "must reject reused runId rather than reusing its staging directory",
  );

  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tdg-artifacts-external-"));
  const linkedStaging = path.join(root, ".diagram-build-linked-run");
  try {
    fs.symlinkSync(externalRoot, linkedStaging, "junction");
    assert.throws(
      () => createStagingRoot(root, "linked-run"),
      (error) => error && error.code === "E_STAGING_UNSAFE" && error.path === linkedStaging,
      "must reject a staging symlink/junction before mkdir can follow it",
    );
    assert.equal(fs.readdirSync(externalRoot).length, 0, "staging setup must not create files through the link");
  } finally {
    fs.rmSync(linkedStaging, { recursive: true, force: true });
    fs.rmSync(externalRoot, { recursive: true, force: true });
  }

  const collisionPlan = resolveDeliveryPlan(root, "collision", "svg");
  const collisionStaging = createStagingRoot(root, "collision-run");
  writeStagedArtifacts(collisionStaging, collisionPlan);
  fs.writeFileSync(collisionPlan.authored[0].path, "appeared after planning", "utf8");
  const collisionBefore = sha256File(collisionPlan.authored[0].path);
  const collisionResult = promoteArtifacts(collisionStaging, collisionPlan);
  assert.equal(collisionResult.code, "E_ARTIFACT_EXISTS");
  assert.equal(sha256File(collisionPlan.authored[0].path), collisionBefore);
  assertNoTemporaryFiles(root);

  const promotionCollisionPlan = resolveDeliveryPlan(root, "promotion-collision", "svg");
  const promotionCollisionStaging = createStagingRoot(root, "promotion-collision-run");
  writeStagedArtifacts(promotionCollisionStaging, promotionCollisionPlan);
  const originalPromotionLink = fs.linkSync;
  fs.linkSync = (source, destination, ...rest) => {
    if (destination === promotionCollisionPlan.authored[0].path) {
      fs.writeFileSync(destination, "appeared during promotion", "utf8");
    }
    return originalPromotionLink(source, destination, ...rest);
  };
  try {
    const promotionCollision = promoteArtifacts(promotionCollisionStaging, promotionCollisionPlan);
    assert.equal(promotionCollision.code, "E_ARTIFACT_EXISTS");
    assert.equal(promotionCollision.path, promotionCollisionPlan.authored[0].path);
  } finally {
    fs.linkSync = originalPromotionLink;
  }
  assert.equal(fs.readFileSync(promotionCollisionPlan.authored[0].path, "utf8"), "appeared during promotion");
  assertNoTemporaryFiles(root);

  const copyFailurePlan = resolveDeliveryPlan(root, "copy-failure", "svg");
  const copyFailureStaging = createStagingRoot(root, "copy-failure-run");
  writeStagedArtifacts(copyFailureStaging, copyFailurePlan);
  const originalCopyFile = fs.copyFileSync;
  fs.copyFileSync = (source, destination, ...rest) => {
    fs.writeFileSync(destination, "partial", "utf8");
    const error = new Error("copy wrote partial output");
    error.code = "EIO";
    throw error;
  };
  try {
    assert.equal(promoteArtifacts(copyFailureStaging, copyFailurePlan).code, "E_ARTIFACT_PROMOTE");
  } finally {
    fs.copyFileSync = originalCopyFile;
  }
  assert.equal(fs.existsSync(copyFailurePlan.authored[0].path), false);
  assertNoTemporaryFiles(root);

  const rollbackPlan = resolveDeliveryPlan(root, "rollback", "both");
  const rollbackStaging = createStagingRoot(root, "rollback-run");
  writeStagedArtifacts(rollbackStaging, rollbackPlan);
  const originalLink = fs.linkSync;
  fs.linkSync = (source, destination, ...rest) => {
    if (destination === rollbackPlan.authored[1].path) {
      fs.unlinkSync(rollbackPlan.authored[0].path);
      fs.writeFileSync(rollbackPlan.authored[0].path, "user replacement", "utf8");
      const error = new Error("second promotion failed");
      error.code = "EIO";
      throw error;
    }
    return originalLink(source, destination, ...rest);
  };
  try {
    const rollbackResult = promoteArtifacts(rollbackStaging, rollbackPlan);
    assert.equal(rollbackResult.code, "E_ARTIFACT_ROLLBACK_INCOMPLETE");
    assert.deepEqual(rollbackResult.paths, [rollbackPlan.authored[0].path]);
  } finally {
    fs.linkSync = originalLink;
  }
  assert.equal(fs.readFileSync(rollbackPlan.authored[0].path, "utf8"), "user replacement", "concurrent replacement must survive rollback");
  assert.equal(fs.existsSync(rollbackPlan.authored[1].path), false);
  assertNoTemporaryFiles(root);

  const protectedPlan = resolveDeliveryPlan(root, "missing", "svg");
  const missingStaging = createStagingRoot(root, "missing-run");
  const missingResult = promoteArtifacts(missingStaging, protectedPlan);
  assert.equal(missingResult.code, "E_ARTIFACT_MISSING");
  assertNoTemporaryFiles(root);

  const report = createQualityReport({ requestedFormat: "both", input: { path: "source.md", sha256: "abc" } });
  assert.deepEqual(report, {
    schemaVersion: 1,
    status: "draft",
    requestedFormat: "both",
    requestedDeliverables: [],
    input: { path: "source.md", sha256: "abc" },
    renderers: {},
    layoutAttempts: [],
    checks: {},
    artifacts: { authored: [], temporary: [] },
    errors: [],
    reviews: { pageWidth: "pending", fullSize: "pending", notes: "" },
  });
  const reportPath = path.join(root, "quality-report.json");
  writeJsonAtomically(reportPath, report);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, "utf8")), report);
  assert.equal(sha256File(reportPath), crypto.createHash("sha256").update(JSON.stringify(report, null, 2) + "\n").digest("hex"));

  const reportBefore = sha256File(reportPath);
  const originalReportRename = fs.renameSync;
  fs.renameSync = (source, destination, ...rest) => {
    if (destination === reportPath) {
      const error = new Error("report promotion failed");
      error.code = "EIO";
      throw error;
    }
    return originalReportRename(source, destination, ...rest);
  };
  try {
    assert.throws(() => writeJsonAtomically(reportPath, { changed: true }), /report promotion failed/);
  } finally {
    fs.renameSync = originalReportRename;
  }
  assert.equal(sha256File(reportPath), reportBefore);
  assertNoTemporaryFiles(root);

  const originalWriteFile = fs.writeFileSync;
  fs.writeFileSync = (filePath, data, options) => {
    if (path.basename(filePath).startsWith(".partial-report.json.tmp-")) {
      originalWriteFile(filePath, "partial", "utf8");
      const error = new Error("report write partially failed");
      error.code = "EIO";
      throw error;
    }
    return originalWriteFile(filePath, data, options);
  };
  try {
    assert.throws(() => writeJsonAtomically(path.join(root, "partial-report.json"), report), /report write partially failed/);
  } finally {
    fs.writeFileSync = originalWriteFile;
  }
  assert.equal(fs.existsSync(path.join(root, "partial-report.json")), false);
  assertNoTemporaryFiles(root);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("PASS test-diagram-artifacts");
