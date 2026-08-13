#!/usr/bin/env node
// SVG -> PNG，固化两条实测结论：
//   1) 一律 2x 渲染（sharp density 144 / resvg zoom 2）。1x 下 21–25px 正文发虚，
//      同一篇文章里混用 1x/2x 会明显不一致（2026-08-12 在 19 张图上踩过）。
//   2) 输出走调色板量化。这类纯平色图实测 29.8MB -> 11.1MB（-63%），
//      平均单通道误差 0.013/255，最大误差只出现在 0.0084% 的抗锯齿边缘像素上。
// 用法：node render-png.mjs <in.svg|目录> [outDir]
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'node:fs'
import { basename, extname, join, dirname } from 'node:path'

const SCALE = 2
const DENSITY = 72 * SCALE

async function withResvg(svg) {
  const { Resvg } = await import('@resvg/resvg-js')
  const r = new Resvg(svg, { fitTo: { mode: 'zoom', value: SCALE }, font: { loadSystemFonts: true } })
  return r.render().asPng()
}

async function withSharp(svg) {
  const sharp = (await import('sharp')).default
  return await sharp(svg, { density: DENSITY }).png({ palette: true, compressionLevel: 9, effort: 8 }).toBuffer()
}

async function optimize(png) {
  try {
    const sharp = (await import('sharp')).default
    return await sharp(png).png({ palette: true, compressionLevel: 9, effort: 8 }).toBuffer()
  } catch {
    return png // 没有 sharp 就交付未优化的 PNG，别为了省体积丢产物
  }
}

async function renderOne(svgPath, outPath) {
  const svg = readFileSync(svgPath)
  let png, engine
  // sharp 优先：它与既有 wiki 图系的字体解析一致，且自带调色板优化。
  // resvg 只作兜底 —— 实测它对同一份 SVG 会把 Latin 解析成衬线体，且遇到
  // 字体缺字时会把紧随其后的 CJK 一起渲成方块（2026-08-12 探针实测）。
  try { png = await withSharp(svg); engine = 'sharp' }
  catch (e) {
    try { png = await withResvg(svg); engine = 'resvg(兜底，字体可能与基线不一致)'; png = await optimize(png) }
    catch (e2) {
      console.error(`[失败] ${basename(svgPath)}: sharp=${e.message} resvg=${e2.message}`)
      console.error('  装一个渲染器：npm i @resvg/resvg-js  或  npm i sharp')
      process.exitCode = 1
      return
    }
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, png)
  const kb = (png.length / 1024).toFixed(0)
  console.log(`[png] ${outPath}  ${SCALE}x  ${kb} KB  (${engine})`)
}

const input = process.argv[2]
if (!input || !existsSync(input)) {
  console.error('用法：node render-png.mjs <in.svg|目录> [outDir]')
  process.exit(2)
}
const outDir = process.argv[3]
const targets = statSync(input).isDirectory()
  ? readdirSync(input).filter((f) => extname(f) === '.svg').sort().map((f) => join(input, f))
  : [input]
if (targets.length === 0) { console.error(`${input} 里没有 .svg`); process.exit(2) }

for (const svgPath of targets) {
  const name = basename(svgPath, '.svg') + '.png'
  await renderOne(svgPath, outDir ? join(outDir, name) : join(dirname(svgPath), name))
}
