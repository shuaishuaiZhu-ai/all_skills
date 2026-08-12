"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildTechnicalDiagram,
  parseArguments,
} = require("../../scripts/build-technical-diagram.cjs");

const spec = {
  id: "diagram",
  components: [{ id: "first", type: "card", title: "First" }],
  connectors: [],
};

function error(code, message = code) {
  const result = new Error(message);
  result.code = code;
  return result;
}

function dependencies(options = {}) {
  const calls = { compile: [], svg: 0, drawio: 0, runtime: [], gate: [] };
  const gateResults = [...(options.gateResults || [{ pass: true, checks: [], errors: [], temporaryArtifacts: [] }])];
  return {
    calls,
    value: {
      loadDiagramSpec: () => spec,
      resolveDiagramRuntime: (runtimeOptions) => {
        calls.runtime.push(runtimeOptions);
        if (options.runtimeError) throw options.runtimeError;
        return { platform: "win32", drawio: { path: "C:\\drawio.exe", version: "31.0.0" } };
      },
      compileLayout: (_spec, layoutOptions) => {
        calls.compile.push(layoutOptions.attempt);
        return {
          id: "diagram",
          canvas: { width: 100, height: 80 },
          nodes: [],
          connectors: [],
          semanticOrder: [],
          adjustments: layoutOptions.attempt ? ["reflow"] : [],
        };
      },
      renderSvg: () => {
        calls.svg += 1;
        if (options.svgRendererError) throw options.svgRendererError;
        return "<svg/>";
      },
      renderDrawio: () => {
        calls.drawio += 1;
        if (options.drawioRendererError) throw options.drawioRendererError;
        return "<mxfile/>";
      },
      runQualityGate: (context) => {
        calls.gate.push(context);
        if (options.gateAssertion) options.gateAssertion(context);
        return gateResults.shift() || { pass: false, checks: [], errors: [{ code: "E_SVG_LAYOUT" }], temporaryArtifacts: [] };
      },
    },
  };
}

function build(root, overrides = {}) {
  const injected = dependencies(overrides);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "diagram.json"), "{}", "utf8");
  const result = buildTechnicalDiagram({
    specPath: path.join(root, "diagram.json"),
    outDir: root,
    baseName: overrides.baseName || "diagram",
    runId: overrides.runId || "test-run",
    format: overrides.format,
    dependencies: { ...injected.value, ...(overrides.dependencyOverrides || {}) },
  });
  return { result, calls: injected.calls };
}

assert.equal(parseArguments(["--spec", "a.json", "--out", "out"]).format, "svg");
assert.deepEqual(parseArguments(["--spec", "a.json", "--out", "out", "--format", "both", "--base-name", "diagram", "--drawio-executable", "drawio"]).format, "both");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tdg-build-"));
try {
  const defaultSvg = build(path.join(root, "default"));
  assert.equal(defaultSvg.result.exitCode, 0);
  assert.equal(defaultSvg.result.report.status, "visual-pending");
  assert.deepEqual(defaultSvg.result.report.requestedDeliverables, ["svg"]);
  assert.equal(fs.existsSync(path.join(root, "default", "diagram.svg")), true);
  assert.equal(fs.existsSync(path.join(root, "default", "diagram.drawio")), false);
  assert.equal(defaultSvg.calls.svg, 1);
  assert.equal(defaultSvg.calls.drawio, 0);
  assert.equal(defaultSvg.calls.runtime[0].requestedFormat, "svg");
  assert.equal(defaultSvg.result.report.artifacts.authored[0].sha256.length, 64);

  const svgWithoutDrawio = build(path.join(root, "svg-without-drawio"), {
    drawioRendererError: error("E_DRAWIO_EXPORT", "Draw.io must not be invoked for SVG"),
  });
  assert.equal(svgWithoutDrawio.result.exitCode, 0);
  assert.deepEqual(svgWithoutDrawio.result.report.requestedDeliverables, ["svg"]);
  assert.equal(svgWithoutDrawio.calls.drawio, 0);

  const drawio = build(path.join(root, "drawio"), { format: "drawio" });
  assert.equal(drawio.result.exitCode, 0);
  assert.deepEqual(drawio.result.report.requestedDeliverables, ["drawio"]);
  assert.equal(fs.existsSync(path.join(root, "drawio", "diagram.drawio")), true);
  assert.equal(fs.existsSync(path.join(root, "drawio", "diagram.svg")), false);
  assert.equal(drawio.calls.svg, 0);
  assert.equal(drawio.calls.drawio, 1);

  const both = build(path.join(root, "both"), { format: "both" });
  assert.equal(both.result.exitCode, 0);
  assert.deepEqual(both.result.report.requestedDeliverables, ["svg", "drawio"]);
  assert.equal(fs.existsSync(path.join(root, "both", "diagram.svg")), true);
  assert.equal(fs.existsSync(path.join(root, "both", "diagram.drawio")), true);
  assert.equal(both.calls.svg, 1);
  assert.equal(both.calls.drawio, 1);

  const unavailable = build(path.join(root, "unavailable"), {
    format: "drawio",
    runtimeError: error("E_DRAWIO_UNAVAILABLE", "Draw.io executable is required"),
    runId: "missing-drawio",
  });
  assert.equal(unavailable.result.exitCode, 1);
  assert.equal(unavailable.result.report.requestedFormat, "drawio");
  assert.equal(unavailable.result.report.errors[0].code, "E_DRAWIO_UNAVAILABLE");
  assert.equal(unavailable.calls.svg, 0);
  assert.equal(unavailable.calls.drawio, 0);
  assert.equal(fs.existsSync(path.join(root, "unavailable", "diagram.svg")), false);
  assert.equal(fs.existsSync(path.join(root, "unavailable", "diagram.drawio")), false);
  assert.equal(fs.existsSync(path.join(root, "unavailable", "failed-missing-drawio")), true);

  const noFallback = build(path.join(root, "no-fallback"), {
    format: "drawio",
    svgRendererError: error("E_SVG_RENDER", "SVG fallback must not be invoked"),
    gateResults: [{ pass: false, checks: [], errors: [{ code: "E_DRAWIO_EXPORT" }], temporaryArtifacts: [] }],
  });
  assert.equal(noFallback.result.exitCode, 1);
  assert.equal(noFallback.result.report.requestedFormat, "drawio");
  assert.equal(noFallback.result.report.errors[0].code, "E_DRAWIO_EXPORT");
  assert.equal(noFallback.calls.svg, 0);
  assert.equal(noFallback.calls.drawio, 1);
  assert.equal(fs.existsSync(path.join(root, "no-fallback", "diagram.svg")), false);

  const reflow = build(path.join(root, "reflow"), {
    gateResults: [
      { pass: false, checks: [], errors: [{ code: "E_SVG_LAYOUT", causes: ["E_GAP_SMALL"] }], temporaryArtifacts: [] },
      { pass: false, checks: [], errors: [{ code: "E_SVG_LAYOUT", causes: ["E_GAP_SMALL"] }], temporaryArtifacts: [] },
      { pass: true, checks: [], errors: [], temporaryArtifacts: [] },
    ],
  });
  assert.equal(reflow.result.exitCode, 0);
  assert.deepEqual(reflow.calls.compile, [0, 1, 2], "a build may perform exactly two reflows after attempt 0");
  assert.equal(reflow.result.report.layoutAttempts.length, 3);

  const nonreflowableSvgLayout = build(path.join(root, "nonreflowable-svg-layout"), {
    gateResults: [{ pass: false, checks: [], errors: [{ code: "E_SVG_LAYOUT", causes: ["E_ARTIFACT_MISSING"] }], temporaryArtifacts: [] }],
  });
  assert.equal(nonreflowableSvgLayout.result.exitCode, 1);
  assert.deepEqual(nonreflowableSvgLayout.calls.compile, [0]);
  assert.equal(nonreflowableSvgLayout.calls.gate.length, 1, "a nonreflowable SVG layout diagnostic must reach the gate exactly once");

  const dottedDrawioName = build(path.join(root, "dotted-drawio-name"), {
    format: "drawio",
    baseName: "foo.drawio",
    gateAssertion: (context) => {
      assert.equal(path.basename(context.artifacts.drawio), "foo.drawio.drawio");
      assert.equal(path.basename(context.artifacts.drawioSvg), "foo.drawio.drawio.svg");
      assert.equal(path.basename(context.artifacts.drawioPng), "foo.drawio.drawio.png");
    },
  });
  assert.equal(dottedDrawioName.result.exitCode, 0);
  assert.equal(fs.existsSync(path.join(root, "dotted-drawio-name", "foo.drawio.drawio")), true);

  const reportFailureRoot = path.join(root, "report-failure-rollback");
  const reportFailure = build(reportFailureRoot, {
    runId: "report-eio",
    dependencyOverrides: {
      writeJsonAtomically: () => { throw error("EIO", "injected report write failure"); },
    },
  });
  assert.equal(reportFailure.result.exitCode, 1);
  assert.equal(fs.existsSync(path.join(reportFailureRoot, "diagram.svg")), false, "a failed report write must roll back this invocation's promoted artifact");
  assert.equal(reportFailure.result.report.errors.some((finding) => finding.code === "EIO"), true);

  const hashFailureRoot = path.join(root, "post-promotion-hash-failure");
  let hashCalls = 0;
  const hashFailure = build(hashFailureRoot, {
    runId: "post-promotion-hash-eio",
    dependencyOverrides: {
      sha256File: (filePath) => {
        hashCalls += 1;
        if (hashCalls === 2) throw error("EIO", "injected post-promotion hash failure");
        return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
      },
    },
  });
  assert.equal(hashFailure.result.exitCode, 1);
  assert.equal(fs.existsSync(path.join(hashFailureRoot, "diagram.svg")), false, "a post-promotion hash failure must roll back this invocation's promoted artifact");
  assert.equal(hashFailure.result.report.errors.some((finding) => finding.code === "EIO"), true);

  const incompleteRollbackRoot = path.join(root, "report-failure-incomplete-rollback");
  const incompleteRollback = build(incompleteRollbackRoot, {
    runId: "report-eio-modified",
    dependencyOverrides: {
      writeJsonAtomically: (_reportPath, report) => {
        fs.writeFileSync(report.artifacts.authored[0].path, "modified after promotion", "utf8");
        throw error("EIO", "injected report write failure after external modification");
      },
    },
  });
  assert.equal(incompleteRollback.result.exitCode, 1);
  assert.equal(fs.readFileSync(path.join(incompleteRollbackRoot, "diagram.svg"), "utf8"), "modified after promotion");
  assert.equal(incompleteRollback.result.report.errors.some((finding) => finding.code === "E_ARTIFACT_ROLLBACK_INCOMPLETE"), true);

  const candidatesRoot = path.join(root, "candidates");
  fs.mkdirSync(candidatesRoot, { recursive: true });
  fs.writeFileSync(path.join(candidatesRoot, "diagram.svg"), "manual source", "utf8");
  const candidate = build(candidatesRoot, { runId: "candidate" });
  assert.equal(candidate.result.exitCode, 0);
  assert.equal(fs.existsSync(path.join(candidatesRoot, "diagram.generated.svg")), true);
  assert.equal(fs.readFileSync(path.join(candidatesRoot, "diagram.svg"), "utf8"), "manual source");

  const failedRoot = path.join(root, "failed-no-promotion");
  fs.mkdirSync(failedRoot, { recursive: true });
  fs.writeFileSync(path.join(failedRoot, "diagram.svg"), "manual source", "utf8");
  const failed = build(failedRoot, {
    runId: "gate-failure",
    gateResults: [{ pass: false, checks: [], errors: [{ code: "E_DRAWIO_EXPORT" }], temporaryArtifacts: [] }],
  });
  assert.equal(failed.result.exitCode, 1);
  assert.equal(fs.readFileSync(path.join(failedRoot, "diagram.svg"), "utf8"), "manual source");
  assert.equal(fs.existsSync(path.join(failedRoot, "diagram.generated.svg")), false);
  assert.equal(fs.existsSync(path.join(failedRoot, "failed-gate-failure")), true);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("PASS test-build-technical-diagram");
