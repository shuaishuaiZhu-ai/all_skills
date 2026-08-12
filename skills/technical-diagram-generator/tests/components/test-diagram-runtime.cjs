"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveDiagramRuntime, resolveDrawioExecutable, RuntimeError } = require("../../scripts/diagram-runtime.cjs");

const runtime = resolveDiagramRuntime({
  requestedFormat: "drawio",
  platform: "linux",
  drawioExecutable: "/opt/drawio/bin/drawio",
  env: {},
  commandExists: (name, args) => name === "xvfb-run" && (args?.[0] === "--help" || args?.includes("/opt/drawio/bin/drawio")),
  commandVersion: () => "30.0.4",
  resolveSharp: () => "/tmp/node_modules/sharp/lib/index.js",
  nodeVersion: "v22.16.0",
  pythonVersion: "Python 3.10.12",
});
assert.equal(runtime.drawio.path, "/opt/drawio/bin/drawio");
assert.equal(runtime.drawio.source, "cli");
assert.equal(runtime.headlessWrapper, "xvfb-run");
const rootLinuxProbeArgs = [];
const rootLinuxDrawio = resolveDrawioExecutable({
  platform: "linux",
  drawioExecutable: "/usr/bin/drawio",
  getuid: () => 0,
  headlessWrapper: "xvfb-run",
  env: {},
  commandExists: (name, args) => {
    if (name === "xvfb-run") rootLinuxProbeArgs.push(args);
    return name === "xvfb-run";
  },
  commandVersion: (name, args) => {
    if (name === "xvfb-run") rootLinuxProbeArgs.push(args);
    return "31.1.8";
  },
});
assert.equal(rootLinuxDrawio.path, "/usr/bin/drawio");
assert.deepEqual(rootLinuxProbeArgs, [
  ["-a", "/usr/bin/drawio", "--no-sandbox", "--disable-gpu", "--version"],
  ["-a", "/usr/bin/drawio", "--no-sandbox", "--disable-gpu", "--version"],
]);
const fallbackToEnv = resolveDrawioExecutable({
  platform: "linux",
  drawioExecutable: "/missing/cli-drawio",
  env: { DRAWIO_EXECUTABLE: "/opt/env-drawio" },
  commandExists: (name) => name === "/opt/env-drawio",
  commandVersion: () => "30.0.4",
});
assert.deepEqual(fallbackToEnv, { path: "/opt/env-drawio", source: "env", version: "30.0.4" });
const noisyVersion = resolveDrawioExecutable({
  platform: "win32",
  drawioExecutable: "C:\\drawio.exe",
  commandExists: () => true,
  commandVersion: () => "[3584475:0811/113146.746365:ERROR:dbus/bus.cc:405] profile warning\n31.1.8\n[3584475:0811/113146.767633:ERROR] warning",
});
assert.equal(noisyVersion.version, "31.1.8", "runtime metadata must not retain unrelated Electron stderr");
assert.throws(
  () => resolveDiagramRuntime({
    requestedFormat: "drawio",
    platform: "linux",
    drawioExecutable: "/missing/cli-drawio",
    env: { DRAWIO_EXECUTABLE: "/missing/env-drawio" },
    commandExists: (name, args) => name === "xvfb-run" && args?.[0] === "--help",
    resolveSharp: () => "/tmp/sharp",
    nodeVersion: "v22.16.0",
    pythonVersion: "Python 3.10.12",
  }),
  (error) => error instanceof RuntimeError && error.code === "E_DRAWIO_UNAVAILABLE",
);
assert.throws(
  () => resolveDiagramRuntime({ requestedFormat: "drawio", platform: "linux", commandExists: () => false, resolveSharp: () => "/tmp/sharp", nodeVersion: "v22.16.0", pythonVersion: "Python 3.10.12" }),
  (error) => error instanceof RuntimeError && error.code === "E_DRAWIO_HEADLESS_UNAVAILABLE",
);
assert.throws(
  () => resolveDiagramRuntime({ requestedFormat: "both", platform: "linux", drawioExecutable: "/opt/drawio/bin/drawio", commandExists: (name) => name === "/opt/drawio/bin/drawio", resolveSharp: () => "/tmp/sharp", nodeVersion: "v22.16.0", pythonVersion: "Python 3.10.12" }),
  (error) => error instanceof RuntimeError && error.code === "E_DRAWIO_HEADLESS_UNAVAILABLE",
);
assert.throws(
  () => resolveDiagramRuntime({ requestedFormat: "svg", platform: "linux", commandExists: () => false, resolveSharp: () => "/tmp/sharp", nodeVersion: "v18.20.0", pythonVersion: "Python 3.10.12" }),
  (error) => error instanceof RuntimeError && error.code === "E_NODE_VERSION",
);
assert.throws(
  () => resolveDiagramRuntime({ requestedFormat: "svg", platform: "linux", commandExists: () => false, resolveSharp: () => "/tmp/sharp", nodeVersion: "v22.16.0", pythonVersion: "Python 3.9.19" }),
  (error) => error instanceof RuntimeError && error.code === "E_PYTHON_VERSION",
);
assert.throws(
  () => resolveDiagramRuntime({ requestedFormat: "svg", platform: "linux", commandExists: () => false, resolveSharp: () => { throw new Error("missing"); }, nodeVersion: "v22.16.0", pythonVersion: "Python 3.10.12" }),
  (error) => error instanceof RuntimeError && error.code === "E_SHARP_UNAVAILABLE",
);
const svgOnly = resolveDiagramRuntime({ requestedFormat: "svg", platform: "linux", commandExists: () => false, resolveSharp: () => "/tmp/sharp", nodeVersion: "v22.16.0", pythonVersion: "Python 3.10.12" });
assert.equal(svgOnly.drawio.source, "unavailable");
const pythonProbes = [];
const linuxDefaultRuntime = resolveDiagramRuntime({
  requestedFormat: "svg",
  platform: "linux",
  commandExists: () => false,
  commandVersion: (command) => {
    pythonProbes.push(command);
    return command === "python3" ? "Python 3.10.12" : undefined;
  },
  resolveSharp: () => "/tmp/sharp",
  nodeVersion: "v22.16.0",
});
assert.equal(linuxDefaultRuntime.python.version, "Python 3.10.12");
assert.ok(pythonProbes.includes("python3"));
const envExecutable = resolveDrawioExecutable({
  platform: "linux",
  env: { DRAWIO_EXECUTABLE: "/env/drawio" },
  commandExists: (name) => name === "/env/drawio",
  commandVersion: () => "30.0.4",
});
assert.deepEqual(envExecutable, { path: "/env/drawio", source: "env", version: "30.0.4" });
const pathExecutable = resolveDrawioExecutable({
  platform: "linux",
  env: {},
  commandExists: (name) => name === "draw.io",
  commandVersion: () => "30.0.4",
});
assert.deepEqual(pathExecutable, { path: "draw.io", source: "path", version: "30.0.4" });
const windowsDefault = resolveDrawioExecutable({
  platform: "win32",
  commandExists: (name) => name === "C:\\Program Files\\draw.io\\draw.io.exe",
});
assert.equal(windowsDefault.path, "C:\\Program Files\\draw.io\\draw.io.exe");
assert.equal(windowsDefault.source, "windows-default");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));
assert.equal(manifest.engines.node, ">=20");
assert.equal(manifest.dependencies.sharp, "0.35.2");
console.log("PASS test-diagram-runtime");
