"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

class ExportError extends Error {
  constructor(code, message, causes = []) {
    super(message);
    this.name = "ExportError";
    this.code = code;
    this.causes = causes;
  }
}

function defaultRunCommand(command, args, options) {
  return childProcess.spawnSync(command, args, { encoding: "utf8", ...options });
}

function outputPaths(options) {
  const inputPath = options.inputPath;
  const outputDirectory = options.outputDirectory;
  const baseName = options.baseName || path.basename(inputPath || "", path.extname(inputPath || ""));
  if (!inputPath || !outputDirectory || !baseName || path.basename(baseName) !== baseName) {
    throw new ExportError("E_DRAWIO_EXPORT", "inputPath, outputDirectory, and a simple baseName are required");
  }
  return {
    previewPng: path.resolve(outputDirectory, `${baseName}.png`),
    embeddedPng: path.resolve(outputDirectory, `${baseName}.drawio.png`),
    embeddedSvg: path.resolve(outputDirectory, `${baseName}.drawio.svg`),
  };
}

function commandCauses(result) {
  const text = `${result && result.stdout ? result.stdout : ""}\n${result && result.stderr ? result.stderr : ""}`;
  return [...new Set([...text.matchAll(/\bE_[A-Z0-9_]+\b/g)].map((match) => match[0]))];
}

function runExportJob(runCommand, command, args, options, name) {
  let result;
  try {
    result = runCommand(command, args, options);
  } catch (error) {
    const causes = error && error.code ? [error.code] : [];
    throw new ExportError("E_DRAWIO_EXPORT", `${name} could not start: ${error.message}`, causes);
  }
  if (!result || result.error || result.status !== 0) {
    const causes = commandCauses(result);
    if (result && result.error && result.error.code) causes.push(result.error.code);
    throw new ExportError("E_DRAWIO_EXPORT", `${name} failed`, [...new Set(causes)]);
  }
}

function exportDrawio(options = {}) {
  const runtime = options.runtime || {};
  const platform = runtime.platform || options.platform || process.platform;
  const executable = runtime.drawio && runtime.drawio.path;
  if (!executable) throw new ExportError("E_DRAWIO_UNAVAILABLE", "Draw.io executable is required");
  const wrapper = platform === "linux" ? runtime.headlessWrapper : undefined;
  if (platform === "linux" && !wrapper) {
    throw new ExportError("E_DRAWIO_HEADLESS_UNAVAILABLE", "xvfb-run is required for Draw.io on Linux");
  }

  const paths = outputPaths(options);
  const runCommand = options.runCommand || defaultRunCommand;
  const fileExists = options.fileExists || fs.existsSync;
  const getuid = options.getuid || (typeof process.getuid === "function" ? () => process.getuid() : () => undefined);
  const env = { ...process.env, ...(options.env || {}), DRAWIO_DISABLE_UPDATE: "true" };
  const common = [
    "--disable-update",
    `--user-data-dir=${path.resolve(options.outputDirectory, ".drawio-profile")}`,
    "--disable-gpu",
    "--disable-gpu-sandbox",
  ];
  if (platform === "win32") {
    common.push("--no-sandbox");
  }
  if (platform === "linux" && getuid() === 0) common.push("--no-sandbox");
  common.push("-b", "0");
  const jobs = [
    { name: "preview PNG", output: paths.previewPng, args: [...common, "-x", "-f", "png", "--width", "3000", "-o", paths.previewPng, options.inputPath] },
    { name: "embedded PNG", output: paths.embeddedPng, args: [...common, "-x", "-f", "png", "-e", "-s", "2", "-o", paths.embeddedPng, options.inputPath] },
    { name: "embedded SVG", output: paths.embeddedSvg, args: [...common, "-x", "-f", "svg", "-e", "-o", paths.embeddedSvg, options.inputPath] },
  ];
  const commands = [];
  for (const job of jobs) {
    const command = platform === "linux" ? wrapper : executable;
    const args = platform === "linux" ? ["-a", executable, ...job.args] : job.args;
    const commandOptions = { env };
    commands.push({ command, args });
    runExportJob(runCommand, command, args, commandOptions, job.name);
    if (!fileExists(job.output)) {
      throw new ExportError("E_DRAWIO_EXPORT", `${job.name} did not create ${job.output}`);
    }
  }

  return {
    ...paths,
    executable,
    version: runtime.drawio && runtime.drawio.version,
    wrapper,
    commands,
  };
}

function parseArguments(argv) {
  const values = {};
  const names = new Set(["--input", "--output-dir", "--base-name", "--drawio-executable"]);
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!names.has(name) || !value || value.startsWith("--")) {
      throw new ExportError("E_DRAWIO_EXPORT", "Usage: export-drawio.cjs --input <drawio> --output-dir <dir> --base-name <name> --drawio-executable <path>");
    }
    values[name] = value;
    index += 1;
  }
  return values;
}

function main() {
  try {
    const values = parseArguments(process.argv.slice(2));
    const platform = process.platform;
    const result = exportDrawio({
      inputPath: values["--input"],
      outputDirectory: values["--output-dir"],
      baseName: values["--base-name"],
      runtime: {
        platform,
        drawio: { path: values["--drawio-executable"] || process.env.DRAWIO_EXECUTABLE },
        headlessWrapper: platform === "linux" ? "xvfb-run" : undefined,
      },
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.code || "E_DRAWIO_EXPORT"}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { ExportError, exportDrawio, parseArguments };
