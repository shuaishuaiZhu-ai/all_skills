"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { exportDrawio, ExportError } = require("../../scripts/export-drawio.cjs");

function fakeOptions(overrides = {}) {
  const calls = [];
  return {
    calls,
    options: {
      inputPath: "/tmp/input.drawio",
      outputDirectory: "/tmp/out",
      baseName: "formal",
      runtime: { platform: "linux", drawio: { path: "/usr/bin/drawio", version: "30.0.4" }, headlessWrapper: "xvfb-run" },
      getuid: () => 1000,
      runCommand: (command, args, options) => {
        calls.push({ command, args, options });
        return { status: 0, stdout: "", stderr: "" };
      },
      fileExists: () => true,
      ...overrides,
    },
  };
}

const linux = fakeOptions();
const exported = exportDrawio(linux.options);
assert.equal(linux.calls.length, 3);
assert.equal(linux.calls[0].command, "xvfb-run");
assert.deepEqual(linux.calls[0].args.slice(0, 2), ["-a", "/usr/bin/drawio"]);
assert.ok(linux.calls.every((call) => call.options.env.DRAWIO_DISABLE_UPDATE === "true"));
assert.ok(linux.calls.every((call) => call.args.includes("--disable-update")));
assert.ok(linux.calls.every((call) => call.args.includes("--disable-gpu")));
assert.ok(linux.calls.every((call) => call.args.includes("--disable-gpu-sandbox")));
assert.ok(linux.calls.every((call) => call.args.some((arg) => arg === `--user-data-dir=${path.resolve("/tmp/out", ".drawio-profile")}`)));
assert.ok(linux.calls.every((call) => !call.args.includes("--no-sandbox")));
assert.match(exported.previewPng, /formal\.png$/);
assert.match(exported.embeddedPng, /formal\.drawio\.png$/);
assert.match(exported.embeddedSvg, /formal\.drawio\.svg$/);
assert.equal(exported.wrapper, "xvfb-run");
assert.ok(exported.commands.every((command) => !("options" in command)), "export metadata must not expose the process environment");
assert.ok(linux.calls.every((call) => call.args.some((arg, index) => arg === "-b" && call.args[index + 1] === "0")), "SVG and PNG parity exports must use the same zero-border policy");

const linuxRoot = fakeOptions({ getuid: () => 0 });
exportDrawio(linuxRoot.options);
assert.ok(linuxRoot.calls.every((call) => call.args.includes("--no-sandbox")));

const windows = fakeOptions({
  runtime: { platform: "win32", drawio: { path: "C:\\drawio.exe", version: "30.0.4" } },
  getuid: () => 0,
});
exportDrawio(windows.options);
assert.ok(windows.calls.every((call) => call.command === "C:\\drawio.exe"));
assert.ok(windows.calls.every((call) => call.args.includes("--no-sandbox")));
assert.ok(windows.calls.every((call) => call.args.includes("--disable-gpu")));
assert.ok(windows.calls.every((call) => call.args.includes("--disable-gpu-sandbox")));
assert.ok(windows.calls.every((call) => call.args.some((arg) => arg === `--user-data-dir=${path.resolve("/tmp/out", ".drawio-profile")}`)));
assert.ok(windows.calls.every((call) => call.command !== "powershell.exe" && call.command !== "pwsh"));

assert.throws(
  () => exportDrawio(fakeOptions({ runtime: { platform: "linux", drawio: { path: undefined } } }).options),
  (error) => error instanceof ExportError && error.code === "E_DRAWIO_UNAVAILABLE",
);
assert.throws(
  () => exportDrawio(fakeOptions({ runtime: { platform: "linux", drawio: { path: "/usr/bin/drawio" } } }).options),
  (error) => error instanceof ExportError && error.code === "E_DRAWIO_HEADLESS_UNAVAILABLE",
);
assert.throws(
  () => exportDrawio(fakeOptions({ runCommand: () => ({ status: 1, stdout: "E_DRAWIO_UNAVAILABLE", stderr: "not found" }) }).options),
  (error) => error instanceof ExportError && error.code === "E_DRAWIO_EXPORT" && error.causes.includes("E_DRAWIO_UNAVAILABLE"),
);

console.log("PASS test-export-drawio");
