#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node verify-wiki-diagrams.cjs <markdown-file> [more-files...]");
  process.exit(2);
}

const mojibakeMarkers = [
  "?".repeat(4),
  "\uFFFD",
  "\u951f",
  "\u9428",
  "\u941c",
  "\u6769",
  "\u8dfa",
  "\u701b",
  "\u93c2",
  "\u59af",
  "\u9286",
  "\u951b",
];

function isExternal(target) {
  return /^(https?:|mailto:|#|data:)/i.test(target);
}

function stripAnchor(target) {
  return target.replace(/#.*/, "");
}

function normalizeTarget(target) {
  return target.trim().replace(/^<|>$/g, "");
}

function nearestVaultRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, ".obsidian"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function escapesVault(dir, target, vaultRoot) {
  if (!vaultRoot || isExternal(target)) return false;
  const resolved = path.resolve(dir, stripAnchor(target));
  const rel = path.relative(vaultRoot, resolved);
  return rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

const rows = [];
let failed = false;

for (const file of files) {
  const abs = path.resolve(file);
  let text;
  try {
    text = fs.readFileSync(abs, "utf8");
  } catch (error) {
    failed = true;
    rows.push({ file, error: error.message });
    continue;
  }

  const dir = path.dirname(abs);
  const vaultRoot = nearestVaultRoot(dir);
  const images = [...text.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)].map((match) => normalizeTarget(match[1]));
  const missingImages = images
    .filter((target) => !isExternal(target))
    .filter((target) => !fs.existsSync(path.resolve(dir, stripAnchor(target))));

  const mdLinks = [...text.matchAll(/\[[^\]]+]\((<?[^)]+\.md(?:#[^)]+)?>?)\)/g)].map((match) => normalizeTarget(match[1]));
  const missingMarkdownLinks = mdLinks
    .filter((target) => !isExternal(target))
    .filter((target) => !fs.existsSync(path.resolve(dir, stripAnchor(target))));

  const vaultEscapingImages = images.filter((target) => escapesVault(dir, target, vaultRoot));

  const badMarkers = mojibakeMarkers.filter((marker) => text.includes(marker));
  const qmarkRuns = text.match(/\?{2,}/g) || [];
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const mermaidCount = (text.match(/```mermaid/g) || []).length;

  if (missingImages.length || missingMarkdownLinks.length || vaultEscapingImages.length || badMarkers.length || qmarkRuns.length) {
    failed = true;
  }

  rows.push({
    file: abs,
    bytes: Buffer.byteLength(text),
    cjk: cjkCount,
    images: images.length,
    missingImages: missingImages.length,
    vaultEscapingImages: vaultEscapingImages.length,
    markdownLinks: mdLinks.length,
    missingMarkdownLinks: missingMarkdownLinks.length,
    mermaid: mermaidCount,
    badMarkers: badMarkers.join("|"),
    qmarkRuns: qmarkRuns.length,
  });

  for (const target of missingImages) {
    console.error(`[missing image] ${abs} -> ${target}`);
  }
  for (const target of missingMarkdownLinks) {
    console.error(`[missing markdown link] ${abs} -> ${target}`);
  }
  for (const target of vaultEscapingImages) {
    console.error(`[vault escape image] ${abs} -> ${target} escapes ${vaultRoot}`);
  }
}

console.table(rows);
process.exit(failed ? 1 : 0);
