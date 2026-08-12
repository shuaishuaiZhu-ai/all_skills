"use strict";

const childProcess = require("node:child_process");

class RuntimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
  }
}

function runCommand(command, args) {
  return childProcess.spawnSync(command, args, { encoding: "utf8" });
}

function defaultCommandExists(command, args = ["--version"]) {
  const result = runCommand(command, args);
  return !result.error && result.status === 0;
}

function defaultCommandVersion(command, args = ["--version"]) {
  const result = runCommand(command, args);
  if (result.error || result.status !== 0) return undefined;
  return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

function parseVersion(value) {
  const match = String(value || "").match(/(\d+)\.(\d+)/);
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : undefined;
}

function normalizeDrawioVersion(value) {
  const text = String(value || "");
  const standalone = text.split(/\r?\n/).map((line) => line.trim()).find((line) => /^\d+\.\d+(?:\.\d+)?$/.test(line));
  if (standalone) return standalone;
  const candidates = [...text.matchAll(/\b\d+\.\d+(?:\.\d+)?\b/g)].map((match) => match[0]);
  return candidates.find((candidate) => Number(candidate.split(".")[0]) < 1000);
}

function resolveDrawioExecutable(options = {}) {
  const platform = options.platform || process.platform;
  const getuid = options.getuid || process.getuid;
  const env = options.env || process.env;
  const commandExists = options.commandExists || defaultCommandExists;
  const commandVersion = options.commandVersion || defaultCommandVersion;
  const headlessWrapper = options.headlessWrapper;
  const candidates = [
    [options.drawioExecutable, "cli"],
    [env.DRAWIO_EXECUTABLE, "env"],
    ["drawio", "path"],
    ["draw.io", "path"],
  ];

  if (platform === "win32") {
    candidates.push(["C:\\Program Files\\draw.io\\draw.io.exe", "windows-default"]);
  }

  const drawioArgs = platform === "linux" && typeof getuid === "function" && getuid() === 0
    ? ["--no-sandbox", "--disable-gpu", "--version"]
    : ["--version"];

  for (const [candidate, source] of candidates) {
    if (!candidate) continue;
    const probeCommand = headlessWrapper || candidate;
    const probeArgs = headlessWrapper ? ["-a", candidate, ...drawioArgs] : drawioArgs;
    if (commandExists(probeCommand, probeArgs)) {
      return { path: candidate, source, version: normalizeDrawioVersion(commandVersion(probeCommand, probeArgs)) };
    }
  }

  return { path: undefined, source: "unavailable", version: undefined };
}

function resolveDiagramRuntime(options = {}) {
  const platform = options.platform || process.platform;
  const nodeVersion = options.nodeVersion || process.version;
  const resolveSharp = options.resolveSharp || (() => require.resolve("sharp"));
  const requestedFormat = options.requestedFormat;
  const commandExists = options.commandExists || defaultCommandExists;
  const commandVersion = options.commandVersion || defaultCommandVersion;
  const pythonCommand = platform === "win32" ? "python" : "python3";
  const pythonVersion = options.pythonVersion || commandVersion(pythonCommand);
  const node = parseVersion(nodeVersion);
  const python = parseVersion(pythonVersion);

  if (!node || node.major < 20) {
    throw new RuntimeError("E_NODE_VERSION", "Node.js 20 or later is required");
  }
  if (!python || python.major < 3 || (python.major === 3 && python.minor < 10)) {
    throw new RuntimeError("E_PYTHON_VERSION", "Python 3.10 or later is required");
  }

  let sharp;
  try {
    sharp = resolveSharp();
  } catch {
    throw new RuntimeError("E_SHARP_UNAVAILABLE", "sharp could not be resolved");
  }

  const requiresDrawio = requestedFormat === "drawio" || requestedFormat === "both";
  let headlessWrapper;
  if (requiresDrawio && platform === "linux") {
    if (!commandExists("xvfb-run", ["--help"])) {
      throw new RuntimeError("E_DRAWIO_HEADLESS_UNAVAILABLE", "xvfb-run is required for Draw.io on Linux");
    }
    headlessWrapper = "xvfb-run";
  }

  const drawio = resolveDrawioExecutable({ ...options, platform, commandExists, commandVersion, headlessWrapper });
  if (requiresDrawio && drawio.source === "unavailable") {
    throw new RuntimeError("E_DRAWIO_UNAVAILABLE", "Draw.io executable is required");
  }

  return {
    platform,
    node: { version: nodeVersion },
    python: { version: pythonVersion },
    sharp: { path: sharp },
    drawio,
    headlessWrapper,
    findings: [],
  };
}

module.exports = { resolveDiagramRuntime, resolveDrawioExecutable, RuntimeError };
