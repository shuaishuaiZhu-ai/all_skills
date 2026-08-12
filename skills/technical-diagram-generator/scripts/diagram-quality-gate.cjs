"use strict";

const path = require("node:path");

const COMMAND_ERRORS = Object.freeze({
  svgLint: "E_SVG_LAYOUT",
  svgPreview: "E_SVG_PREVIEW_RENDERER",
  drawioLint: "E_DRAWIO_LAYOUT",
  drawioExport: "E_DRAWIO_EXPORT",
  drawioUnavailable: "E_DRAWIO_UNAVAILABLE",
  drawioHeadless: "E_DRAWIO_HEADLESS_UNAVAILABLE",
  drawioSvgLint: "E_DRAWIO_SVG_LAYOUT",
  drawioParity: "E_DRAWIO_RENDER_PARITY",
  semanticParity: "E_SEMANTIC_PARITY",
});

function errorCodes(result) {
  const text = `${result && result.stdout ? result.stdout : ""}\n${result && result.stderr ? result.stderr : ""}`;
  return [...new Set([...text.matchAll(/\bE_[A-Z0-9_]+\b/g)].map((match) => match[0]))];
}

function runQualityGate(context = {}) {
  const { artifacts = {}, runtime = {}, adapters = {} } = context;
  const runCommand = adapters.runCommand;
  const fileExists = adapters.fileExists;
  if (typeof runCommand !== "function" || typeof fileExists !== "function") throw new TypeError("runCommand and fileExists adapters are required");
  if (!new Set(["svg", "drawio", "both"]).has(context.format)) throw new TypeError("format must be svg, drawio, or both");
  const skillRoot = context.skillRoot || path.resolve(__dirname, "..");
  const checks = [];
  const errors = [];
  const scripts = (name) => path.join(skillRoot, "scripts", name);

  function checkFile(name, artifact, code) {
    const pass = Boolean(artifact && fileExists(artifact));
    checks.push({ name, pass, artifact });
    if (!pass) errors.push({ code, message: `${name} artifact is missing`, causes: ["E_ARTIFACT_MISSING"] });
    return pass;
  }
  function run(name, command, args, code) {
    let result;
    try { result = runCommand(command, args, { encoding: "utf8" }); }
    catch (error) {
      const causes = error && error.code ? [error.code] : [];
      checks.push({ name, pass: false, command, args });
      errors.push({ code, message: error.message, causes });
      return false;
    }
    const pass = Boolean(result && !result.error && result.status === 0);
    checks.push({ name, pass, command, args });
    if (!pass) {
      const causes = errorCodes(result);
      if (result && result.error && result.error.code) causes.push(result.error.code);
      const special = causes.includes("E_DRAWIO_UNAVAILABLE") ? COMMAND_ERRORS.drawioUnavailable
        : causes.includes("E_DRAWIO_HEADLESS_UNAVAILABLE") ? COMMAND_ERRORS.drawioHeadless : code;
      errors.push({ code: special, message: `${name} failed`, causes: [...new Set(causes)] });
    }
    return pass;
  }
  function svgGate() {
    if (!checkFile("svg preview", artifacts.svg, COMMAND_ERRORS.svgPreview)) return;
    run("svg lint", process.execPath, [scripts("lint-svg-text-overlap.cjs"), artifacts.svg], COMMAND_ERRORS.svgLint);
  }
  function drawioGate() {
    if (!checkFile("drawio source", artifacts.drawio, COMMAND_ERRORS.drawioLint)) return;
    run("drawio strict lint", runtime.platform === "win32" ? "python" : "python3", [scripts("lint-drawio-layout.py"), artifacts.drawio, "--strict"], COMMAND_ERRORS.drawioLint);
    if (!runtime.drawio || !runtime.drawio.path) {
      errors.push({ code: COMMAND_ERRORS.drawioUnavailable, message: "Draw.io executable is required", causes: [] });
      return;
    }
    if (runtime.platform === "linux" && !runtime.headlessWrapper) {
      errors.push({ code: COMMAND_ERRORS.drawioHeadless, message: "xvfb-run is required for Draw.io on Linux", causes: [] });
      return;
    }
    const baseName = path.basename(artifacts.drawio, ".drawio");
    run("drawio export", process.execPath, [scripts("export-drawio.cjs"), "--input", artifacts.drawio, "--output-dir", path.dirname(artifacts.drawioSvg || artifacts.drawio), "--base-name", baseName, "--drawio-executable", runtime.drawio.path], COMMAND_ERRORS.drawioExport);
    if (!checkFile("drawio exported svg", artifacts.drawioSvg, COMMAND_ERRORS.drawioSvgLint) || !checkFile("drawio exported png", artifacts.drawioPng, COMMAND_ERRORS.drawioParity)) return;
    run("drawio svg lint", process.execPath, [scripts("lint-svg-text-overlap.cjs"), artifacts.drawioSvg], COMMAND_ERRORS.drawioSvgLint);
    run("drawio render parity", process.execPath, [scripts("compare-render-parity.cjs"), artifacts.drawioSvg, artifacts.drawioPng], COMMAND_ERRORS.drawioParity);
  }

  if (context.format === "svg" || context.format === "both") svgGate();
  if (context.format === "drawio" || context.format === "both") drawioGate();
  if (context.format === "both" && artifacts.svg && artifacts.drawio) {
    run("semantic parity", process.execPath, [scripts("compare-semantic-parity.cjs"), artifacts.svg, artifacts.drawio], COMMAND_ERRORS.semanticParity);
  }
  return {
    pass: errors.length === 0,
    checks,
    errors,
    temporaryArtifacts: Array.isArray(context.temporaryArtifacts) ? [...context.temporaryArtifacts] : [],
    rendererVersions: { node: process.version, drawio: runtime.drawio && runtime.drawio.version },
  };
}

module.exports = { COMMAND_ERRORS, runQualityGate };
