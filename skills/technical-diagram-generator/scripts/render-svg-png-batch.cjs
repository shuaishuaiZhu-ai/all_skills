#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const [inputDirArg, outputDirArg] = process.argv.slice(2);
if (!inputDirArg || !outputDirArg) {
  console.error("Usage: node render-svg-png-batch.cjs <input-svg-dir> <output-png-dir>");
  process.exit(2);
}

const inputDir = path.resolve(inputDirArg);
const outputDir = path.resolve(outputDirArg);
fs.mkdirSync(outputDir, { recursive: true });

async function main() {
  const files = fs.readdirSync(inputDir).filter((file) => file.toLowerCase().endsWith(".svg")).sort();
  for (const file of files) {
    const input = path.join(inputDir, file);
    const output = path.join(outputDir, file.replace(/\.svg$/i, ".png"));
    await sharp(input, { density: 144 }).png().toFile(output);
    console.log(`[png] ${output}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
