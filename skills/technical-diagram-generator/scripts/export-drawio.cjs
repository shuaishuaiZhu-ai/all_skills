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

const PREVIEW_WIDTH = 3000;
// Draw.io's SVG export has no background. A wiki page rendered in dark mode
// would put this figure's dark text on a dark plate, so the raster channels are
// flattened onto white.
const CANVAS_WHITE = { r: 255, g: 255, b: 255 };

function defaultRenderPng(svgPath, pngPath, { width, scale } = {}) {
  let sharpPath;
  try {
    sharpPath = require.resolve("sharp");
  } catch (error) {
    throw new ExportError("E_SHARP_UNAVAILABLE", `PNG rasterisation needs sharp: ${error.message}`);
  }
  // density rasterises the SVG at size instead of upscaling a 72 dpi bitmap,
  // which is the difference between crisp glyphs and soft ones.
  const readOptions = { density: 72 * (width ? width / 1000 : scale || 2) };
  const script =
    `const sharp=require(${JSON.stringify(sharpPath)});` +
    `sharp(${JSON.stringify(svgPath)},${JSON.stringify(readOptions)})` +
    (width ? `.resize({width:${width}})` : "") +
    `.flatten({background:${JSON.stringify(CANVAS_WHITE)}})` +
    `.png({palette:true})` +
    `.toFile(${JSON.stringify(pngPath)})` +
    `.catch((error)=>{console.error(error.message);process.exit(1);});`;
  // sharp is async-only and this function's callers are synchronous, so the
  // pipeline runs in a child process rather than leaving a floating promise.
  const result = childProcess.spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  if (!result || result.error || result.status !== 0) {
    const detail = (result && (result.stderr || result.error?.message)) || "unknown error";
    throw new ExportError("E_DRAWIO_EXPORT", `PNG rasterisation failed: ${detail.trim()}`);
  }
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
  // Draw.io's own PNG export refuses any scaling flag on some builds: `-f png`
  // with `-s 2` or `--width 3000` exits 0 after printing "Empty export data" and
  // writes nothing (reproduced on Draw.io 28.2.5 / Ubuntu 22.04 / xvfb). The SVG
  // export has no such problem, so Draw.io produces the vector channel and the
  // raster channels are rasterised from it here — which also gives both PNGs the
  // same renderer and palette as the SVG route.
  const jobs = [
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

  const renderPng = options.renderPng || defaultRenderPng;
  renderPng(paths.embeddedSvg, paths.previewPng, { width: PREVIEW_WIDTH });
  renderPng(paths.embeddedSvg, paths.embeddedPng, { scale: 2 });
  for (const output of [paths.previewPng, paths.embeddedPng]) {
    if (!fileExists(output)) {
      throw new ExportError("E_DRAWIO_EXPORT", `PNG rasterisation did not create ${output}`);
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
