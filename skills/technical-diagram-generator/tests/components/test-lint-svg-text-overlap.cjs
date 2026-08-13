"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const linter = path.join(__dirname, "..", "..", "scripts", "lint-svg-text-overlap.cjs");
const fixtures = path.join(__dirname, "..", "fixtures");

function lint(...files) {
  const result = spawnSync(process.execPath, [linter, ...files], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tdg-lint-"));
function write(name, body) {
  const file = path.join(root, name);
  fs.writeFileSync(file, body, "utf8");
  return file;
}

try {
  // A CJK label and a Latin label rendered two pixels apart in baseline with
  // overlapping x ranges. Measuring every glyph at 0.58 em puts the CJK label's
  // right edge at x=155.68 — left of the Latin label — so the old model saw no
  // overlap at all and passed the figure; full-width glyphs must count as 1 em,
  // which puts the real overlap at 32.6 px.
  const collision = lint(path.join(fixtures, "connector-label-collision.svg"));
  assert.equal(collision.status, 1, "colliding connector labels must fail the lint");
  assert.match(collision.output, /text collides with text: "submit_bio" \/ "完成中断回调"/);
  assert.match(collision.output, /overlap 32\.6 x 14\.0 px/);

  // Same figure, also too wide to read once embedded at page width.
  assert.match(collision.output, /canvas too wide to read at page width: 2591 x 303 px, ratio 8\.55/);

  const wide = write("wide.svg", [
    '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="400" viewBox="0 0 2000 400">',
    '<text x="40" y="40" font-size="16">only the aspect ratio is wrong here</text>',
    "</svg>",
  ].join(""));
  const wideResult = lint(wide);
  assert.equal(wideResult.status, 1, "an over-wide canvas must fail on its own");
  assert.match(wideResult.output, /ratio 5\.00 exceeds 4/);
  assert.doesNotMatch(wideResult.output, /text collides with text/);

  // A deliberately tight but legible stack: 1.2 em baseline gaps, mixed CJK and
  // Latin, plus a small gray source anchor under a larger code line. This is the
  // shape the approved hand-authored figures use, so it must not be reported.
  const tightStack = write("tight-stack.svg", [
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600">',
    '<text x="60" y="120" font-size="23">① aicaLaunchKernel(function_address, grid, block)</text>',
    '<text x="60" y="139" font-size="18">aica_runtime.cpp:560 function_address = host 桩变量的地址</text>',
    '<text x="60" y="161" font-size="18">失败: stream 非法 → aicaErrorInvalidValue</text>',
    '<text x="60" y="200" font-size="31">六跳详解（含每跳的失败出口）</text>',
    "</svg>",
  ].join(""));
  const tightResult = lint(tightStack);
  assert.equal(tightResult.status, 0, `tight but legible stacks must pass: ${tightResult.output}`);

  // Empty semantic placeholders are rendered at font-size 1 and carry no ink.
  const placeholders = write("placeholders.svg", [
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">',
    '<text x="40" y="40" font-size="1" aria-hidden="true"></text>',
    '<text x="40" y="40" font-size="1" aria-hidden="true"></text>',
    '<text x="40" y="120" font-size="18">真实文本</text>',
    "</svg>",
  ].join(""));
  assert.equal(lint(placeholders).status, 0, "empty placeholders must not collide with each other");

  // Thresholds stay tunable for callers with a different page width.
  const relaxed = spawnSync(process.execPath, [linter, wide], {
    encoding: "utf8",
    env: { ...process.env, MAX_ASPECT_RATIO: "6" },
  });
  assert.equal(relaxed.status, 0, "MAX_ASPECT_RATIO must relax the canvas-shape check");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("PASS test-lint-svg-text-overlap");
