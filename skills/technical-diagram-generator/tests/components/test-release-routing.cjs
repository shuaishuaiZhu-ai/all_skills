"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const skillRoot = path.join(__dirname, "..", "..");
const skill = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
const metadata = fs.readFileSync(path.join(skillRoot, "agents", "openai.yaml"), "utf8");
const toolSelection = fs.readFileSync(path.join(skillRoot, "references", "tool-selection.md"), "utf8");
const componentReference = fs.readFileSync(path.join(skillRoot, "references", "standard-component-generator.md"), "utf8");
const brief = fs.readFileSync(path.join(skillRoot, "assets", "diagram-brief-template.md"), "utf8");
const releaseContractLiterals = [
  "Default SVG delivery: .svg only.",
  "Explicit Draw.io delivery: .drawio only.",
  "Both-channel delivery: .svg + .drawio.",
  "SVG/PNG validation exports are temporary unless explicitly requested.",
];

for (const [name, text] of [
  ["SKILL.md", skill],
  ["tool-selection.md", toolSelection],
  ["standard-component-generator.md", componentReference],
  ["diagram-brief-template.md", brief],
]) {
  for (const literal of releaseContractLiterals) {
    assert.ok(text.includes(literal), `${name} must contain release contract literal: ${literal}`);
  }
}

assert.match(skill, /default(?:s)? to SVG|默认(?:只)?生成 SVG/i);
assert.match(skill, /--format both/);
assert.match(skill, /explicit.*Draw\.io|明确要求.*Draw\.io/i);
assert.match(skill, /never overwrite|不得覆盖/i);
assert.match(skill, /Ubuntu 22\.04|Ubuntu/);
assert.match(skill, /npm ci/);
assert.match(skill, /DRAWIO_EXECUTABLE/);
assert.doesNotMatch(skill, /formal[^\n]*Draw\.io by default/i);
assert.doesNotMatch(metadata, /Draw\.io by default/i);
console.log("PASS test-release-routing");
