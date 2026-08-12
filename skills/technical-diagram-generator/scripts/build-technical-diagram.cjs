"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { loadDiagramSpec, normalizeFormat } = require("./diagram-spec.cjs");
const { resolveDiagramRuntime } = require("./diagram-runtime.cjs");
const { compileLayout } = require("./diagram-layout.cjs");
const { renderSvg } = require("./render-svg-components.cjs");
const { renderDrawio } = require("./render-drawio-components.cjs");
const { runQualityGate } = require("./diagram-quality-gate.cjs");
const {
  createQualityReport,
  createStagingRoot,
  promoteArtifacts,
  resolveDeliveryPlan,
  sha256File,
  writeJsonAtomically,
} = require("./diagram-artifacts.cjs");

const REFLOWABLE_CODES = new Set(["E_SVG_LAYOUT", "E_DRAWIO_SVG_LAYOUT", "E_DRAWIO_LAYOUT"]);
const REFLOWABLE_LAYOUT_CAUSES = new Set([
  "E_PAGE_BOUNDS",
  "E_PARENT_BOUNDS",
  "E_PARENT_PADDING",
  "E_EDGE_LABEL_INLINE",
  "E_CANVAS_WHITESPACE",
  "E_GAP_SMALL",
  "E_GAP_LARGE",
  "E_OVERLAP",
  "E_EDGE_THROUGH",
]);

class BuildError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BuildError";
    this.code = code;
  }
}

function parseArguments(argv) {
  const names = new Set(["--spec", "--out", "--format", "--base-name", "--drawio-executable"]);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!names.has(name) || !value || value.startsWith("--") || values[name] !== undefined) {
      throw new BuildError("E_CLI_USAGE", "Usage: build-technical-diagram.cjs --spec <json> --out <directory> [--format svg|drawio|both] [--base-name <name>] [--drawio-executable <path>]");
    }
    values[name] = value;
    index += 1;
  }
  if (!values["--spec"] || !values["--out"]) {
    throw new BuildError("E_CLI_USAGE", "--spec and --out are required");
  }
  return {
    specPath: values["--spec"],
    outDir: values["--out"],
    format: normalizeFormat(values["--format"]),
    baseName: values["--base-name"],
    drawioExecutable: values["--drawio-executable"],
  };
}

function defaultDependencies() {
  return {
    loadDiagramSpec,
    resolveDiagramRuntime,
    compileLayout,
    renderSvg,
    renderDrawio,
    runQualityGate,
    createQualityReport,
    createStagingRoot,
    promoteArtifacts,
    resolveDeliveryPlan,
    sha256File,
    writeJsonAtomically,
  };
}

function diagnostic(error) {
  return {
    code: error && error.code ? error.code : "E_BUILD_FAILED",
    message: error && error.message ? error.message : "technical diagram build failed",
    causes: error && Array.isArray(error.causes) ? error.causes : [],
  };
}

function isReflowable(error) {
  if (!error || !REFLOWABLE_CODES.has(error.code) || !Array.isArray(error.causes) || error.causes.length === 0) return false;
  return error.causes.every((cause) => REFLOWABLE_LAYOUT_CAUSES.has(cause));
}

function promotedArtifactIdentity(filePath) {
  const stats = fs.statSync(filePath);
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    birthtimeMs: stats.birthtimeMs,
    ctimeMs: stats.ctimeMs,
    mtimeMs: stats.mtimeMs,
  };
}

function recordPromotedArtifactIdentities(promotedArtifacts) {
  for (const artifact of promotedArtifacts) artifact.identity = promotedArtifactIdentity(artifact.path);
}

function hashPromotedArtifacts(promotedArtifacts, dependencies) {
  for (const artifact of promotedArtifacts) artifact.sha256 = dependencies.sha256File(artifact.path);
}

function matchesPromotedArtifact(artifact, dependencies) {
  if (!artifact.identity) return false;
  const current = promotedArtifactIdentity(artifact.path);
  const expected = artifact.identity;
  const sameIdentity = current.dev === expected.dev &&
    current.ino === expected.ino &&
    current.size === expected.size &&
    current.birthtimeMs === expected.birthtimeMs &&
    current.ctimeMs === expected.ctimeMs &&
    current.mtimeMs === expected.mtimeMs;
  return sameIdentity && (artifact.sha256 === undefined || dependencies.sha256File(artifact.path) === artifact.sha256);
}

function rollbackPromotedArtifacts(promotedArtifacts, dependencies) {
  const protectedPaths = [];
  for (const artifact of [...promotedArtifacts].reverse()) {
    try {
      if (matchesPromotedArtifact(artifact, dependencies)) fs.unlinkSync(artifact.path);
      else protectedPaths.push(artifact.path);
    } catch (error) {
      if (error.code !== "ENOENT") protectedPaths.push(artifact.path);
    }
  }
  return protectedPaths;
}

function requestedKinds(plan) {
  return plan.authored.map((artifact) => artifact.kind);
}

function inputFingerprint(specPath, hash) {
  return { path: path.resolve(specPath || ""), sha256: hash };
}

function renderRequestedFormats(layout, format, stagingRoot, plan, dependencies) {
  const byKind = new Map(plan.authored.map((artifact) => [artifact.kind, artifact]));
  const artifacts = {};
  if (format === "svg" || format === "both") {
    const svgPath = path.join(stagingRoot, byKind.get("svg").stagingName);
    fs.writeFileSync(svgPath, dependencies.renderSvg(layout), "utf8");
    artifacts.svg = svgPath;
  }
  if (format === "drawio" || format === "both") {
    const drawioPath = path.join(stagingRoot, byKind.get("drawio").stagingName);
    fs.writeFileSync(drawioPath, dependencies.renderDrawio(layout), "utf8");
    artifacts.drawio = drawioPath;
    artifacts.drawioSvg = `${drawioPath}.svg`;
    artifacts.drawioPng = `${drawioPath}.png`;
  }
  return artifacts;
}

function renderersFor(format, runtime) {
  const renderers = {};
  if (format === "svg" || format === "both") renderers.svg = { engine: "render-svg-components.cjs" };
  if (format === "drawio" || format === "both") {
    renderers.drawio = { engine: "render-drawio-components.cjs", version: runtime.drawio && runtime.drawio.version };
  }
  return renderers;
}

function failedStagingPath(stagingRoot, runId) {
  return path.join(path.dirname(stagingRoot), `failed-${runId}`);
}

function retainFailedStaging(stagingRoot, runId) {
  if (!stagingRoot || !fs.existsSync(stagingRoot)) return undefined;
  const failedPath = failedStagingPath(stagingRoot, runId);
  try {
    fs.renameSync(stagingRoot, failedPath);
    return failedPath;
  } catch (error) {
    return { error: diagnostic(error), path: stagingRoot };
  }
}

function fallbackBaseName(specPath) {
  const name = path.basename(specPath || "diagram", path.extname(specPath || "diagram"));
  return name && !/[<>:"/\\|?*\x00-\x1f]/.test(name) ? name : "diagram";
}

function buildTechnicalDiagram(options = {}) {
  const dependencies = { ...defaultDependencies(), ...(options.dependencies || {}) };
  const runId = options.runId || crypto.randomUUID();
  let format;
  let plan;
  let stagingRoot;
  let report;
  let inputHash = "";
  let promotedArtifacts = [];
  let reportCommitted = false;

  try {
    if (!options.specPath || !options.outDir) throw new BuildError("E_CLI_USAGE", "specPath and outDir are required");
    format = normalizeFormat(options.format);
    const spec = dependencies.loadDiagramSpec(options.specPath);
    inputHash = dependencies.sha256File(options.specPath);
    plan = dependencies.resolveDeliveryPlan(options.outDir, options.baseName || spec.id, format);
    stagingRoot = dependencies.createStagingRoot(plan.outDir, runId);
    report = dependencies.createQualityReport({
      requestedFormat: format,
      requestedDeliverables: requestedKinds(plan),
      input: inputFingerprint(options.specPath, inputHash),
    });

    const runtimeOptions = { ...(options.runtimeOptions || {}) };
    if (format === "svg" && !runtimeOptions.commandExists) {
      // Task 0 only needs commandExists to discover Draw.io.  Suppress that
      // probe for the SVG-only contract, which has no Draw.io dependency.
      runtimeOptions.commandExists = () => false;
    }
    const runtime = dependencies.resolveDiagramRuntime({
      ...runtimeOptions,
      requestedFormat: format,
      drawioExecutable: format === "svg" ? undefined : options.drawioExecutable || runtimeOptions.drawioExecutable,
    });
    report.renderers = renderersFor(format, runtime);

    for (let attempt = 0; attempt <= 2; attempt += 1) {
      const layout = dependencies.compileLayout(spec, { attempt });
      const artifacts = renderRequestedFormats(layout, format, stagingRoot, plan, dependencies);
      const gate = dependencies.runQualityGate({
        format,
        layout,
        artifacts,
        runtime,
        skillRoot: options.skillRoot,
        adapters: options.gateAdapters || {
          runCommand: (command, args, commandOptions) => childProcess.spawnSync(command, args, commandOptions),
          fileExists: fs.existsSync,
        },
      });
      report.layoutAttempts.push({ attempt, pass: gate.pass, adjustments: layout.adjustments, errors: gate.errors });
      report.checks = gate.checks;
      if (gate.pass) {
        const promotion = dependencies.promoteArtifacts(stagingRoot, plan);
        if (promotion.code !== "OK") {
          report.errors = [diagnostic(promotion.error || { code: promotion.code, message: promotion.code })];
          break;
        }
        promotedArtifacts = plan.authored.map((artifact) => ({ path: artifact.path }));
        recordPromotedArtifactIdentities(promotedArtifacts);
        hashPromotedArtifacts(promotedArtifacts, dependencies);
        report.status = "visual-pending";
        report.errors = [];
        report.artifacts.authored = plan.authored.map((artifact, index) => ({ ...artifact, sha256: promotedArtifacts[index].sha256 }));
        report.artifacts.temporary = [];
        dependencies.writeJsonAtomically(plan.reportPath, report);
        reportCommitted = true;
        try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch {}
        return { exitCode: 0, reportPath: plan.reportPath, report };
      }
      report.errors = gate.errors || [];
      if (!report.errors.length || !report.errors.every(isReflowable)) break;
    }
  } catch (error) {
    if (!format) {
      try { format = normalizeFormat(options.format); } catch { format = "svg"; }
    }
    if (!plan && options.outDir) {
      try {
        plan = dependencies.resolveDeliveryPlan(options.outDir, options.baseName || fallbackBaseName(options.specPath), format);
      } catch (planError) {
        error = planError;
      }
    }
    if (!report) {
      report = dependencies.createQualityReport({
        requestedFormat: format,
        requestedDeliverables: plan ? requestedKinds(plan) : [],
        input: inputFingerprint(options.specPath, inputHash),
      });
    }
    report.errors = [diagnostic(error)];
  }

  if (!report) {
    report = dependencies.createQualityReport({ requestedFormat: format || "svg", requestedDeliverables: plan ? requestedKinds(plan) : [] });
  }
  report.status = "failed";
  if (promotedArtifacts.length > 0 && !reportCommitted) {
    const protectedPaths = rollbackPromotedArtifacts(promotedArtifacts, dependencies);
    if (protectedPaths.length > 0) {
      report.errors.push({
        code: "E_ARTIFACT_ROLLBACK_INCOMPLETE",
        message: "Unable to safely roll back every promoted artifact",
        causes: [],
        paths: protectedPaths,
      });
    }
  }
  const retained = retainFailedStaging(stagingRoot, runId);
  if (typeof retained === "string") report.artifacts.temporary = [{ path: retained, retained: true }];
  if (retained && retained.error) report.errors.push(retained.error);
  if (plan) {
    try { dependencies.writeJsonAtomically(plan.reportPath, report); } catch {}
  }
  return { exitCode: 1, reportPath: plan && plan.reportPath, report };
}

function main() {
  try {
    const result = buildTechnicalDiagram(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${error.code || "E_BUILD_FAILED"}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { BuildError, buildTechnicalDiagram, parseArguments };
