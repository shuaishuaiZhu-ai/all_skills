#!/usr/bin/env node
// Render one SVG to PNG. Usage: node render.mjs <in.svg> [out.png] [zoom]
// Tries @resvg/resvg-js first (no browser, offline once installed), falls back to sharp.
import { readFileSync, writeFileSync } from 'node:fs'

const [, , input, outArg, zoomArg] = process.argv
if (!input) {
  console.error('usage: node render.mjs <in.svg> [out.png] [zoom]')
  process.exit(2)
}
const out = outArg || input.replace(/\.svg$/i, '.png')
const zoom = Number(zoomArg || 2)
const svg = readFileSync(input)

async function withResvg() {
  const { Resvg } = await import('@resvg/resvg-js')
  const r = new Resvg(svg, { fitTo: { mode: 'zoom', value: zoom }, font: { loadSystemFonts: true } })
  return r.render().asPng()
}
async function withSharp() {
  const sharp = (await import('sharp')).default
  return await sharp(svg, { density: 96 * zoom }).png().toBuffer()
}

try {
  let png
  try { png = await withResvg() }
  catch (e) { console.error('[resvg unavailable, trying sharp]', e.message); png = await withSharp() }
  writeFileSync(out, png)
  console.log('OK', out, png.length, 'bytes')
} catch (e) {
  console.error('RENDER FAILED:', e.message)
  console.error('Install a renderer:  (cd ~/.claude/skills/svg-diagrams && npm i @resvg/resvg-js)')
  process.exit(1)
}
