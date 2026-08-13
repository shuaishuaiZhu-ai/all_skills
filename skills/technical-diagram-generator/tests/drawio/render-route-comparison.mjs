#!/usr/bin/env node
// Renders both route comparison sources to PNG and composes the side-by-side
// sheet. Run build-route-comparison.py first.
//
//   node render-route-comparison.mjs <dir> [--drawio-executable <path>]
//
// Writes <dir>/umd-six-stages-{drawio,svg,compare}.png next to <dir>/src/.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const scripts = path.resolve(import.meta.dirname, "..", "..", "scripts");
const sharp = require(path.join(scripts, "..", "node_modules", "sharp"));

const [directory, ...rest] = process.argv.slice(2);
if (!directory) {
  console.error("Usage: node render-route-comparison.mjs <dir> [--drawio-executable <path>]");
  process.exit(2);
}
const executableFlag = rest.includes("--drawio-executable")
  ? ["--drawio-executable", rest[rest.indexOf("--drawio-executable") + 1]]
  : [];

const LABEL_HEIGHT = 110;
const PAD = 60;
const TARGET_HEIGHT = 2400;

function label(text, width) {
  return Buffer.from(
    `<svg width="${width}" height="${LABEL_HEIGHT}"><text x="0" y="70" ` +
      `font-family="Noto Sans CJK SC, sans-serif" font-size="56" font-weight="700" ` +
      `fill="#0f172a">${text}</text></svg>`
  );
}

// Draw.io only produces the vector channel; the raster channels come from it.
execFileSync("node", [
  path.join(scripts, "export-drawio.cjs"),
  "--input", path.join(directory, "src", "umd-six-stages.drawio"),
  "--output-dir", directory,
  "--base-name", "umd-six-stages-drawio",
  ...executableFlag,
], { stdio: "ignore" });

execFileSync("node", [
  path.join(scripts, "render-png.mjs"),
  path.join(directory, "src", "umd-six-stages.svg"),
  directory,
], { stdio: "ignore" });

const svgPng = path.join(directory, "umd-six-stages-svg.png");
execFileSync("mv", [path.join(directory, "umd-six-stages.png"), svgPng]);

const drawioPng = path.join(directory, "umd-six-stages-drawio.png");
const [left, right] = await Promise.all(
  [drawioPng, svgPng].map((file) => sharp(file).resize({ height: TARGET_HEIGHT }).toBuffer())
);
const [leftMeta, rightMeta] = await Promise.all([sharp(left).metadata(), sharp(right).metadata()]);

await sharp({
  create: {
    width: leftMeta.width + rightMeta.width + PAD * 3,
    height: TARGET_HEIGHT + LABEL_HEIGHT + PAD * 2,
    channels: 3,
    background: "#ffffff",
  },
})
  .composite([
    { input: label("drawio 路线 · drawiokit", leftMeta.width), left: PAD, top: PAD - 10 },
    { input: label("SVG 路线 · svgkit", rightMeta.width), left: PAD * 2 + leftMeta.width, top: PAD - 10 },
    { input: left, left: PAD, top: PAD + LABEL_HEIGHT },
    { input: right, left: PAD * 2 + leftMeta.width, top: PAD + LABEL_HEIGHT },
  ])
  .png({ palette: true })
  .toFile(path.join(directory, "umd-six-stages-compare.png"));

console.log(`compare sheet written to ${path.join(directory, "umd-six-stages-compare.png")}`);
