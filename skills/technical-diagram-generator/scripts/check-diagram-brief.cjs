#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const fileArg = process.argv[2];
if (!fileArg) {
  console.error("Usage: node check-diagram-brief.cjs <brief.md>");
  process.exit(2);
}

const file = path.resolve(fileArg);
let text;
try {
  text = fs.readFileSync(file, "utf8");
} catch (error) {
  console.error(`[error] cannot read ${file}: ${error.message}`);
  process.exit(2);
}

const required = [
  "audience_knows",
  "reader_gap",
  "learning_question",
  "source_evidence",
  "unverified_or_inferred",
  "must_keep",
  "main_symbols",
  "omit_details",
  "reading_order",
  "arrow_semantics",
  "output_assets",
  "pilot_gate",
  "approval_baseline",
  "acceptance_checks",
];

const fields = new Map();
for (const line of text.split(/\r?\n/)) {
  const match = line.match(/^\s*-\s*([a-z_]+)\s*:\s*(.*?)\s*$/);
  if (match) fields.set(match[1], match[2]);
}

const placeholder = /^(?:|tbd|todo|待填写|待确认|<.*>|\[.*\])$/i;
const missing = required.filter((key) => !fields.has(key));
const incomplete = required.filter((key) => fields.has(key) && placeholder.test(fields.get(key)));

if (missing.length || incomplete.length) {
  if (missing.length) console.error(`[error] missing fields: ${missing.join(", ")}`);
  if (incomplete.length) console.error(`[error] incomplete fields: ${incomplete.join(", ")}`);
  process.exit(1);
}

console.log(`[ok] diagram brief complete: ${file}`);
console.log(`[ok] learning question: ${fields.get("learning_question")}`);
console.log(`[ok] pilot gate: ${fields.get("pilot_gate")}`);
