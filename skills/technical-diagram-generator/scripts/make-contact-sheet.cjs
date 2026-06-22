#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const [inputDirArg, outputArg] = process.argv.slice(2);
if (!inputDirArg || !outputArg) {
  console.error("Usage: node make-contact-sheet.cjs <png-dir> <output.png>");
  process.exit(2);
}

const inputDir = path.resolve(inputDirArg);
const output = path.resolve(outputArg);
const files = fs.readdirSync(inputDir).filter((file) => file.toLowerCase().endsWith(".png")).sort();
const thumbW = 420;
const thumbH = 260;
const gap = 24;
const labelH = 34;
const cols = 2;
const rows = Math.ceil(files.length / cols);
const width = cols * thumbW + (cols + 1) * gap;
const height = rows * (thumbH + labelH) + (rows + 1) * gap;

async function main() {
  const composites = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const col = index % cols;
    const row = Math.floor(index / cols);
    const left = gap + col * (thumbW + gap);
    const top = gap + row * (thumbH + labelH + gap);
    const image = await sharp(path.join(inputDir, file))
      .resize({ width: thumbW, height: thumbH, fit: "inside", background: "#ffffff" })
      .extend({ top: 0, bottom: 0, left: 0, right: 0, background: "#ffffff" })
      .png()
      .toBuffer();
    const label = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${thumbW}" height="${labelH}"><text x="8" y="23" font-size="16" fill="#334155" font-family="Arial">${file}</text></svg>`
    );
    composites.push({ input: image, left, top });
    composites.push({ input: label, left, top: top + thumbH });
  }
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: "#f8fafc",
    },
  }).composite(composites).png().toFile(output);
  console.log(`[contact-sheet] ${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
