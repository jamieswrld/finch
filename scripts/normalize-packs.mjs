// Put every pack render on one shared canvas.
//
//   node scripts/normalize-packs.mjs [--check]
//
// The four packs were generated separately, so each file is cropped tight to
// its own artwork at a slightly different aspect ratio. Rendered side by side
// they end up different sizes even inside equal boxes.
//
// This never redraws anything — each pack is scaled so its HEIGHT matches the
// others (preserving its own proportions, so nothing distorts) and then centred
// on a transparent canvas of one common size. Same pixels, same shapes, one
// footprint. Re-runnable: normalising an already-normalised file is a no-op
// beyond re-encoding, because the trim step restores the original bounds first.

import { statSync } from 'node:fs'
import sharp from 'sharp'

const PACKS = ['starter', 'bluechip', 'ai', 'whale']
const SRC = (n) => `public/packs/${n}.webp`
const TARGET_H = 1220 // tallest source, so nothing is upscaled beyond its native size
const MARGIN = 0.02 // breathing room on the widest pack, as a share of canvas width

const check = process.argv.includes('--check')

// Measure first: trim each pack's own transparent bounds, then work out how wide
// the canvas has to be once every pack is scaled to a common height.
const measured = []
for (const name of PACKS) {
  const trimmed = await sharp(SRC(name)).trim({ threshold: 1 }).toBuffer()
  const { width, height } = await sharp(trimmed).metadata()
  const scaledW = Math.round((width / height) * TARGET_H)
  measured.push({ name, trimmed, width, height, scaledW })
}

const widest = Math.max(...measured.map((m) => m.scaledW))
const CANVAS_W = Math.ceil((widest * (1 + MARGIN * 2)) / 2) * 2 // keep it even

if (check) {
  for (const m of measured) {
    const cur = await sharp(SRC(m.name)).metadata()
    console.log(
      `${m.name.padEnd(9)} now ${cur.width}x${cur.height}  ->  ${CANVAS_W}x${TARGET_H}` +
        `  (pack drawn at ${m.scaledW}px wide)`,
    )
  }
  process.exit(0)
}

for (const m of measured) {
  const scaled = await sharp(m.trimmed)
    .resize({ height: TARGET_H, fit: 'inside', kernel: 'lanczos3' })
    .toBuffer()
  const { width: w = m.scaledW, height: h = TARGET_H } = await sharp(scaled).metadata()

  await sharp({
    create: {
      width: CANVAS_W,
      height: TARGET_H,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: scaled, left: Math.round((CANVAS_W - w) / 2), top: Math.round((TARGET_H - h) / 2) }])
    .webp({ quality: 92, alphaQuality: 100 })
    .toFile(`${SRC(m.name)}.tmp`)

  const { renameSync } = await import('node:fs')
  renameSync(`${SRC(m.name)}.tmp`, SRC(m.name))
  console.log(`${m.name.padEnd(9)} ${CANVAS_W}x${TARGET_H}  ${(statSync(SRC(m.name)).size / 1024).toFixed(0)} KB`)
}
