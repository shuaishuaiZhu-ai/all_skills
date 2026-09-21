"use strict";
// Unit test for export-drawio.cjs with Draw.io and sharp stubbed out, so it runs
// anywhere node runs. Covers the three --final-only paths (direct PNG, --lint-svg,
// empty-PNG fallback to the SVG channel) and the legacy three-file layout.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { exportDrawio, parseArguments, ExportError } = require("../../scripts/export-drawio.cjs");

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "test-export-drawio-"));
}
function listing(dir) {
  return fs.readdirSync(dir).sort();
}
// Pretends to be Draw.io: writes a non-empty file at the `-o` path unless the
// test asked for the "Empty export data" behaviour on PNG.
function fakeDrawio({ emptyPng = false } = {}) {
  const calls = [];
  const runCommand = (command, args) => {
    const format = args[args.indexOf("-f") + 1];
    const output = args[args.indexOf("-o") + 1];
    calls.push({ command, format, args });
    fs.writeFileSync(output, format === "png" && emptyPng ? "" : `${format}-bytes`);
    return { status: 0, stdout: "", stderr: "" };
  };
  return { calls, runCommand };
}
const runtime = { platform: "linux", drawio: { path: "/fake/drawio" }, headlessWrapper: "xvfb-run" };
const stubs = {
  renderPng: (svg, png) => fs.writeFileSync(png, "rasterised-from-svg"),
  palettePng: () => true,
  verifyPng: () => ({ ok: true }),
  getuid: () => 1000,
};
const input = path.join(__dirname, "valid-formal-flow.drawio");

// 1. --final-only: direct PNG, nothing else in the output directory.
{
  const out = scratch();
  const drawio = fakeDrawio();
  const result = exportDrawio({ inputPath: input, outputDirectory: out, baseName: "fig", finalOnly: true, runtime, runCommand: drawio.runCommand, ...stubs });
  assert.deepEqual(listing(out), ["fig.drawio.png"]);
  assert.equal(result.renderer, "drawio-png");
  assert.equal(result.paletted, true);
  assert.equal(result.svgLint, undefined);
  assert.equal(result.embeddedSvg, null);
  assert.equal(result.previewPng, null);
  assert.deepEqual(drawio.calls.map((c) => c.format), ["png"]);
  assert.ok(drawio.calls[0].args.includes("--use-angle=swiftshader"), "swiftshader flag is what makes direct PNG work");
  assert.ok(drawio.calls[0].args.join(" ").includes("--size page"), "final-only exports the full page so margins exist for the overflow check");
  assert.equal(drawio.calls[0].command, "xvfb-run");
  assert.equal(result.directPngRejected, undefined);
}

// 1b. Direct PNG that fails verification (overflowed page): rejected, SVG fallback, one file delivered.
{
  const out = scratch();
  const drawio = fakeDrawio();
  const result = exportDrawio({ inputPath: input, outputDirectory: out, baseName: "fig", finalOnly: true, runtime, runCommand: drawio.runCommand, ...stubs,
    verifyPng: () => ({ ok: false, reason: "content reaches the right edge: overflowed the page" }), lintSvgFn: () => "[ok] stub" });
  assert.deepEqual(listing(out), ["fig.drawio.png"]);
  assert.equal(result.renderer, "svg");
  assert.match(result.directPngRejected, /overflowed/);
  assert.equal(fs.readFileSync(path.join(out, "fig.drawio.png"), "utf8"), "rasterised-from-svg", "the rejected direct PNG must be replaced, not kept");
  assert.deepEqual(drawio.calls.map((c) => c.format), ["png", "svg"]);
  assert.ok(drawio.calls[1].args.join(" ").includes("--size page"), "fallback SVG uses the same page framing");
}

// 2. --final-only --lint-svg: SVG goes to scratch, is linted, and is gone afterwards.
{
  const out = scratch();
  const drawio = fakeDrawio();
  const linted = [];
  const result = exportDrawio({ inputPath: input, outputDirectory: out, baseName: "fig", finalOnly: true, lintSvg: true, runtime, runCommand: drawio.runCommand, ...stubs,
    lintSvgFn: (svg) => { linted.push(svg); assert.ok(fs.existsSync(svg), "SVG must exist while being linted"); return "[ok] stub"; } });
  assert.deepEqual(listing(out), ["fig.drawio.png"]);
  assert.equal(result.renderer, "drawio-png");
  assert.equal(result.svgLint, "[ok] stub");
  assert.equal(linted.length, 1);
  assert.ok(!fs.existsSync(linted[0]), "scratch SVG is deleted after the export");
  assert.ok(!fs.existsSync(path.dirname(linted[0])), "scratch directory is deleted after the export");
  assert.deepEqual(drawio.calls.map((c) => c.format), ["png", "svg"]);
}

// 3. Empty PNG from Draw.io: fall back to the SVG channel, still only one file delivered.
{
  const out = scratch();
  const drawio = fakeDrawio({ emptyPng: true });
  const result = exportDrawio({ inputPath: input, outputDirectory: out, baseName: "fig", finalOnly: true, runtime, runCommand: drawio.runCommand, ...stubs, lintSvgFn: () => "[ok] stub" });
  assert.deepEqual(listing(out), ["fig.drawio.png"]);
  assert.equal(result.renderer, "svg");
  assert.equal(fs.readFileSync(path.join(out, "fig.drawio.png"), "utf8"), "rasterised-from-svg");
  assert.deepEqual(drawio.calls.map((c) => c.format), ["png", "svg"]);
}

// 4. Legacy mode keeps the three-file layout and leaves no Chromium profile behind.
{
  const out = scratch();
  const drawio = fakeDrawio();
  const result = exportDrawio({ inputPath: input, outputDirectory: out, baseName: "fig", runtime, runCommand: drawio.runCommand, ...stubs });
  assert.deepEqual(listing(out), ["fig.drawio.png", "fig.drawio.svg", "fig.png"]);
  assert.equal(result.renderer, "svg");
  assert.deepEqual(drawio.calls.map((c) => c.format), ["svg"]);
  assert.ok(!drawio.calls[0].args.includes("--size"), "legacy mode keeps Draw.io's crop-to-diagram framing");
}

// 5. Windows: Draw.io is invoked directly, no xvfb wrapper.
{
  const out = scratch();
  const drawio = fakeDrawio();
  exportDrawio({ inputPath: input, outputDirectory: out, baseName: "fig", finalOnly: true, runtime: { platform: "win32", drawio: { path: "C:\\draw.io.exe" } }, runCommand: drawio.runCommand, ...stubs });
  assert.equal(drawio.calls[0].command, "C:\\draw.io.exe");
  assert.ok(!drawio.calls[0].args.includes("-a"));
}

// 5b. Output directory is created when missing.
{
  const out = path.join(scratch(), "nested", "figures");
  const drawio = fakeDrawio();
  exportDrawio({ inputPath: input, outputDirectory: out, baseName: "fig", finalOnly: true, runtime, runCommand: drawio.runCommand, ...stubs });
  assert.deepEqual(listing(out), ["fig.drawio.png"]);
}

// 6. Argument parsing: flags mixed with valued options; missing executable is an error.
{
  assert.deepEqual(parseArguments(["--input", "a.drawio", "--final-only", "--output-dir", "o", "--lint-svg"]), { "--input": "a.drawio", "--final-only": true, "--output-dir": "o", "--lint-svg": true });
  assert.throws(() => exportDrawio({ inputPath: input, outputDirectory: scratch(), baseName: "fig", runtime: { platform: "linux" } }), (e) => e instanceof ExportError && e.code === "E_DRAWIO_UNAVAILABLE");
}

console.log("PASS test-export-drawio");
