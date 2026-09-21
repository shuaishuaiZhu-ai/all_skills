"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
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

// Re-encode a PNG in place as an 8-bit palette image (what the SVG route
// produced). Measured on a 5616x1739 figure: 897 KB RGB -> ~185 KB, with no
// visible change. Skipped, not fatal, when sharp is unavailable.
function defaultPalettePng(pngPath) {
  let sharpPath;
  try {
    sharpPath = require.resolve("sharp");
  } catch (error) {
    return false;
  }
  const tmpPath = `${pngPath}.tmp`;
  const script =
    `const sharp=require(${JSON.stringify(sharpPath)});` +
    `sharp(${JSON.stringify(pngPath)}).png({palette:true}).toFile(${JSON.stringify(tmpPath)})` +
    `.catch((error)=>{console.error(error.message);process.exit(1);});`;
  const result = childProcess.spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  if (!result || result.error || result.status !== 0) {
    fs.rmSync(tmpPath, { force: true });
    return false;
  }
  fs.renameSync(tmpPath, pngPath);
  return true;
}

// Draw.io's direct PNG export renders the content at a scale that stops
// matching the canvas once the output gets wide: measured 2026-09-21 on 31.1.8
// with `--size page -s 2`, a 2925 px page (5852 px output) came back with the
// content shifted right and cut at the edge, while pages up to ~1500 px were
// pixel-correct; `--width N` above ~4000 even returned wrong heights. The
// failure is silent (exit 0, plausible dimensions), so the exporter proves each
// direct PNG before accepting it: the dimensions must equal page × scale, and
// the right and bottom edge bands must be background — content that overflowed
// the page always erases one of those margins. Anything else falls back to the
// SVG channel, which has no such ceiling.
const DIRECT_PNG_SCALE = 2;
const EDGE_BAND_PX = 8;
const EDGE_TOLERANCE = 60; // sum of |dR|+|dG|+|dB| against the corner pixel

function pageSizeOf(drawioPath) {
  try {
    const match = fs.readFileSync(drawioPath, "utf8").match(/pageWidth="(\d+)"[^>]*pageHeight="(\d+)"/);
    return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
  } catch (error) {
    return null;
  }
}

function defaultVerifyPng(pngPath, expected) {
  let sharpPath;
  try {
    sharpPath = require.resolve("sharp");
  } catch (error) {
    return { ok: false, reason: `cannot verify without sharp: ${error.message}` };
  }
  const script = `
    const sharp = require(${JSON.stringify(sharpPath)});
    const band = ${EDGE_BAND_PX}, tol = ${EDGE_TOLERANCE};
    (async () => {
      const image = sharp(${JSON.stringify(pngPath)});
      const meta = await image.metadata();
      const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
      const ch = info.channels;
      const px = (x, y) => { const i = (y * info.width + x) * ch; return [data[i], data[i + 1], data[i + 2]]; };
      const bg = px(0, 0);
      const differs = (p) => Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > tol;
      let rightInk = false, bottomInk = false;
      for (let x = info.width - band; x < info.width && !rightInk; x++) for (let y = 0; y < info.height; y += 2) if (differs(px(x, y))) { rightInk = true; break; }
      for (let y = info.height - band; y < info.height && !bottomInk; y++) for (let x = 0; x < info.width; x += 2) if (differs(px(x, y))) { bottomInk = true; break; }
      process.stdout.write(JSON.stringify({ width: meta.width, height: meta.height, rightInk, bottomInk }));
    })().catch((error) => { console.error(error.message); process.exit(1); });`;
  const result = childProcess.spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  if (!result || result.error || result.status !== 0) {
    return { ok: false, reason: `verification failed to run: ${(result && (result.stderr || result.error?.message)) || "unknown"}`.trim() };
  }
  const probe = JSON.parse(result.stdout);
  if (expected && (Math.abs(probe.width - expected.width) > 3 || Math.abs(probe.height - expected.height) > 3)) {
    return { ok: false, reason: `size ${probe.width}x${probe.height} != page*scale ${expected.width}x${expected.height}` };
  }
  if (probe.rightInk || probe.bottomInk) {
    return { ok: false, reason: `content reaches the ${probe.rightInk ? "right" : "bottom"} edge: overflowed the page` };
  }
  return { ok: true };
}

function pngSizeOf(pngPath) {
  try {
    const header = Buffer.alloc(24);
    const fd = fs.openSync(pngPath, "r");
    fs.readSync(fd, header, 0, 24, 0);
    fs.closeSync(fd);
    return `${header.readUInt32BE(16)}x${header.readUInt32BE(20)}`;
  } catch (error) {
    return "?x?";
  }
}

function outputPaths(options) {
  const inputPath = options.inputPath;
  const outputDirectory = options.outputDirectory;
  const baseName = options.baseName || path.basename(inputPath || "", path.extname(inputPath || ""));
  if (!inputPath || !outputDirectory || !baseName || path.basename(baseName) !== baseName) {
    throw new ExportError("E_DRAWIO_EXPORT", "inputPath, outputDirectory, and a simple baseName are required");
  }
  // --final-only: Draw.io writes the embedded PNG directly (`-f png -s 2`);
  // the Chromium profile, and the SVG when it is needed for --lint-svg or the
  // fallback, live in a scratch directory that is deleted at the end. The
  // 3000 px preview is skipped. The delivery is then exactly
  // `<base>.drawio` + `<base>.drawio.png`.
  const workDirectory = options.finalOnly
    ? fs.mkdtempSync(path.join(os.tmpdir(), "export-drawio-"))
    : path.resolve(outputDirectory);
  return {
    workDirectory,
    previewPng: options.finalOnly ? null : path.resolve(outputDirectory, `${baseName}.png`),
    embeddedPng: path.resolve(outputDirectory, `${baseName}.drawio.png`),
    embeddedSvg: path.resolve(workDirectory, `${baseName}.drawio.svg`),
  };
}

function lintSvgTextOverlap(svgPath) {
  const lint = path.join(__dirname, "lint-svg-text-overlap.cjs");
  const result = childProcess.spawnSync(process.execPath, [lint, svgPath], { encoding: "utf8" });
  if (!result || result.error || result.status !== 0) {
    const detail = (result && ((result.stdout || "") + (result.stderr || ""))) || "unknown error";
    throw new ExportError("E_SVG_TEXT_OVERLAP", `text-overlap lint failed on the exported SVG:\n${detail.trim()}`);
  }
  return result.stdout.trim();
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
  // Draw.io writes nothing (and exits non-zero) when the output directory is
  // missing, and the palette pass and PNG checks assume it exists too.
  fs.mkdirSync(path.resolve(options.outputDirectory), { recursive: true });
  const runCommand = options.runCommand || defaultRunCommand;
  const fileExists = options.fileExists || fs.existsSync;
  const getuid = options.getuid || (typeof process.getuid === "function" ? () => process.getuid() : () => undefined);
  const env = { ...process.env, ...(options.env || {}), DRAWIO_DISABLE_UPDATE: "true" };
  const common = [
    "--disable-update",
    `--user-data-dir=${path.resolve(paths.workDirectory, ".drawio-profile")}`,
    // Draw.io renders PNG by screenshotting a hidden BrowserWindow that this
    // build creates with `offscreen: { deviceScaleFactor: 2 }`. Under plain
    // --disable-gpu that offscreen surface never produces a frame for a scaled
    // export, so capturePage() hands back an empty image. Routing GL through
    // ANGLE's software backend keeps the render CPU-only and fixes it:
    // `-f png -s 2` went from 0 B to a real image across repeated runs.
    "--use-angle=swiftshader",
    "--disable-gpu-sandbox",
    // Containers default /dev/shm to 64 MB. Chromium's font service fills that
    // on a figure of any size and dies with "No space left on device (28)" even
    // though the disk has hundreds of gigabytes free.
    "--disable-dev-shm-usage",
  ];
  if (platform === "win32") {
    common.push("--no-sandbox");
  }
  if (platform === "linux" && getuid() === 0) common.push("--no-sandbox");
  common.push("-b", "0");
  // Even with ANGLE the screenshot path has a size ceiling: on Draw.io 31.1.8 /
  // Ubuntu 22.04 / xvfb, `-f png` still returns "Empty export data" (exit 1)
  // past roughly 1500 px of output — `--width 1800` and `-s 4` fail where
  // `--width 1500` and `-s 2` succeed, and a bigger xvfb screen does not move
  // the line. A 3000 px preview is therefore unreachable through Draw.io's own
  // rasteriser. The SVG export has no ceiling, so Draw.io produces the vector
  // channel and both PNGs are rasterised from it here, which also gives them the
  // same renderer and palette as the SVG route.
  // Re-measured 2026-09-21 on Draw.io 31.1.8 / xvfb with the flags above:
  // `-f png` succeeds at -s 1..3 and --width up to 4000 (8423 px output), so
  // the ceiling described above no longer applies here. --final-only therefore
  // asks Draw.io for the PNG directly and only falls back to the SVG channel if
  // the PNG comes back missing or empty (the "Empty export data" class).
  const commands = [];
  const runJob = (job) => {
    const command = platform === "linux" ? wrapper : executable;
    const args = platform === "linux" ? ["-a", executable, ...job.args] : job.args;
    commands.push({ command, args });
    runExportJob(runCommand, command, args, { env }, job.name);
  };
  // --final-only exports the full page (`--size page`) on both channels so the
  // direct PNG and the SVG fallback frame the figure identically and the page
  // margins exist for the overflow check. Legacy mode keeps Draw.io's default
  // crop-to-diagram framing that earlier pages were built with.
  const sizeArgs = options.finalOnly ? ["--size", "page"] : [];
  const svgJob = { name: "embedded SVG", output: paths.embeddedSvg, args: [...common, "-x", "-f", "svg", "-e", ...sizeArgs, "-o", paths.embeddedSvg, options.inputPath] };
  const pngJob = { name: "direct PNG", output: paths.embeddedPng, args: [...common, "-x", "-f", "png", "-s", String(DIRECT_PNG_SCALE), "--theme", "light", ...sizeArgs, "-o", paths.embeddedPng, options.inputPath] };
  const verifyPng = options.verifyPng || defaultVerifyPng;
  const pageSize = pageSizeOf(options.inputPath);
  const expectedPng = pageSize ? { width: Math.round(pageSize.width * DIRECT_PNG_SCALE), height: Math.round(pageSize.height * DIRECT_PNG_SCALE) } : null;
  const fileSize = options.fileSize || ((file) => (fs.existsSync(file) ? fs.statSync(file).size : 0));
  const renderPng = options.renderPng || defaultRenderPng;
  const palettePng = options.palettePng || defaultPalettePng;

  let renderer = "svg";
  let svgLint;
  let paletted = false;
  let directPngRejected;
  try {
    if (options.finalOnly) {
      runJob(pngJob);
      const verdict = fileSize(paths.embeddedPng) > 0 ? verifyPng(paths.embeddedPng, expectedPng) : { ok: false, reason: "empty file" };
      if (verdict.ok) {
        renderer = "drawio-png";
        paletted = palettePng(paths.embeddedPng);
      } else {
        directPngRejected = verdict.reason;
        fs.rmSync(paths.embeddedPng, { force: true });
      }
    }
    if (renderer === "svg" || options.lintSvg) {
      runJob(svgJob);
      if (!fileExists(svgJob.output)) {
        throw new ExportError("E_DRAWIO_EXPORT", `${svgJob.name} did not create ${svgJob.output}`);
      }
    }
    if (renderer === "svg") {
      if (paths.previewPng) renderPng(paths.embeddedSvg, paths.previewPng, { width: PREVIEW_WIDTH });
      renderPng(paths.embeddedSvg, paths.embeddedPng, { scale: 2 });
      for (const output of [paths.previewPng, paths.embeddedPng].filter(Boolean)) {
        if (!fileExists(output)) {
          throw new ExportError("E_DRAWIO_EXPORT", `PNG rasterisation did not create ${output}`);
        }
      }
    }
    if (options.finalOnly && (options.lintSvg || renderer === "svg")) {
      // The vector channel exists (asked for, or produced by the fallback):
      // lint it while it is still on disk.
      svgLint = (options.lintSvgFn || lintSvgTextOverlap)(paths.embeddedSvg);
    }
  } finally {
    if (options.finalOnly) {
      fs.rmSync(paths.workDirectory, { recursive: true, force: true });
    } else {
      fs.rmSync(path.resolve(paths.workDirectory, ".drawio-profile"), { recursive: true, force: true });
    }
  }
  if (options.finalOnly) {
    paths.embeddedSvg = null;
    paths.workDirectory = null;
  } else {
    delete paths.workDirectory;
  }

  return {
    ...paths,
    renderer,
    directPngRejected,
    paletted,
    svgLint,
    executable,
    version: runtime.drawio && runtime.drawio.version,
    wrapper,
    commands,
  };
}

function parseArguments(argv) {
  const values = {};
  const names = new Set(["--input", "--output-dir", "--base-name", "--drawio-executable"]);
  const flags = new Set(["--final-only", "--lint-svg", "--json"]);
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (flags.has(name)) {
      values[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!names.has(name) || !value || value.startsWith("--")) {
      throw new ExportError("E_DRAWIO_EXPORT", "Usage: export-drawio.cjs --input <drawio> --output-dir <dir> --base-name <name> [--drawio-executable <path>] [--final-only] [--lint-svg] [--json]");
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
      finalOnly: Boolean(values["--final-only"]),
      lintSvg: Boolean(values["--lint-svg"]),
      runtime: {
        platform,
        drawio: { path: values["--drawio-executable"] || process.env.DRAWIO_EXECUTABLE },
        headlessWrapper: platform === "linux" ? "xvfb-run" : undefined,
      },
    });
    if (values["--json"]) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      // One line is what an agent needs to read back; the full record costs
      // hundreds of tokens per figure and is only useful when something failed.
      const size = pngSizeOf(result.embeddedPng);
      const extra = [
        `renderer=${result.renderer}`,
        result.directPngRejected ? `direct-png-rejected="${result.directPngRejected}"` : null,
        result.svgLint ? "svg-lint=ok" : null,
        result.previewPng ? `preview=${path.basename(result.previewPng)}` : null,
        result.embeddedSvg ? `svg=${path.basename(result.embeddedSvg)}` : null,
      ].filter(Boolean).join(" ");
      process.stdout.write(`[ok] ${result.embeddedPng} ${size} ${extra}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.code || "E_DRAWIO_EXPORT"}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { ExportError, exportDrawio, parseArguments };
