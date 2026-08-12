"use strict";

const assert = require("node:assert/strict");
const { runQualityGate } = require("../../scripts/diagram-quality-gate.cjs");

function context(format, runCommand = () => ({ status: 0, stdout: "PASS", stderr: "" })) {
  const calls = [];
  return {
    calls,
    value: {
      format,
      layout: { nodes: [], connectors: [] },
      artifacts: { svg: "valid.svg", drawio: "valid.drawio", drawioSvg: "valid.drawio.svg", drawioPng: "valid.drawio.png" },
      runtime: { platform: "linux", drawio: { path: "/usr/bin/drawio", version: "30.0.4" }, headlessWrapper: "xvfb-run" },
      skillRoot: "skill",
      adapters: {
        fileExists: () => true,
        runCommand: (command, args, options) => {
          calls.push({ command, args, options });
          return runCommand(command, args, options);
        },
      },
    },
  };
}

const svg = context("svg");
const svgResult = runQualityGate(svg.value);
assert.equal(svgResult.pass, true);
assert.deepEqual(svgResult.errors, []);
assert.ok(svg.calls.some((call) => call.args.join(" ").includes("lint-svg-text-overlap.cjs")));
assert.ok(svg.calls.every((call) => !call.args.join(" ").includes("export-drawio.cjs")));
assert.deepEqual(svgResult.temporaryArtifacts, []);

const drawio = context("drawio");
const drawioResult = runQualityGate(drawio.value);
assert.equal(drawioResult.pass, true);
assert.ok(drawio.calls.some((call) => call.args.join(" ").includes("lint-drawio-layout.py") && call.args.includes("--strict")));
assert.ok(drawio.calls.some((call) => call.args.join(" ").includes("export-drawio.cjs")));
assert.ok(drawio.calls.some((call) => call.args.join(" ").includes("compare-render-parity.cjs")));
assert.ok(drawio.calls.every((call) => call.command !== "powershell.exe" && call.command !== "pwsh"));
assert.equal(drawioResult.rendererVersions.drawio, "30.0.4");

const dottedDrawio = context("drawio");
dottedDrawio.value.artifacts = {
  drawio: "artifacts/foo.drawio.drawio",
  drawioSvg: "artifacts/foo.drawio.drawio.svg",
  drawioPng: "artifacts/foo.drawio.drawio.png",
};
const dottedDrawioResult = runQualityGate(dottedDrawio.value);
assert.equal(dottedDrawioResult.pass, true);
const dottedExport = dottedDrawio.calls.find((call) => call.args.join(" ").includes("export-drawio.cjs"));
assert.equal(dottedExport.args[dottedExport.args.indexOf("--base-name") + 1], "foo.drawio");

const both = context("both");
const bothResult = runQualityGate(both.value);
assert.equal(bothResult.pass, true);
assert.ok(both.calls.some((call) => call.args.join(" ").includes("compare-semantic-parity.cjs")));

const failed = context("drawio", (_command, args) => args.join(" ").includes("lint-drawio-layout.py")
  ? { status: 1, stdout: "E_GAP_SMALL card-a,card-b", stderr: "" }
  : { status: 0, stdout: "", stderr: "" });
const failedResult = runQualityGate(failed.value);
assert.equal(failedResult.pass, false);
assert.equal(failedResult.errors[0].code, "E_DRAWIO_LAYOUT");
assert.deepEqual(failedResult.errors[0].causes, ["E_GAP_SMALL"]);

console.log("PASS test-diagram-quality-gate");
