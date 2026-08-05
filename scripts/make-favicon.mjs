// Build the finch favicons on a solid white tile.
//
//   node scripts/make-favicon.mjs [source.png]
//
// The source mark is transparent, which renders as a floating black bird on
// whatever the browser's tab strip happens to be. Flattening onto white keeps
// the mark legible in dark tab bars and matches the site itself.

import { mkdirSync } from 'node:fs'
import { statSync } from 'node:fs'
import sharp from 'sharp'

const SRC = process.argv[2] ?? 'public/brand/mark.webp'
const OUT = 'public/brand'
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }
const PAD = 0.07 // vertical margin; the mark is narrow, so height is what fills the tile

mkdirSync(OUT, { recursive: true })

// Trim the transparent margin so padding is measured off the mark itself.
const mark = await sharp(SRC).trim().png().toBuffer()

async function tile(size, file) {
  const inner = Math.round(size * (1 - PAD * 2))
  const glyph = await sharp(mark).resize({ height: inner }).toBuffer()
  const { width = inner, height = inner } = await sharp(glyph).metadata()

  await sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: glyph, left: Math.round((size - width) / 2), top: Math.round((size - height) / 2) }])
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}/${file}`)
}

await tile(512, 'favicon.png')
await tile(180, 'apple-touch-icon.png')

for (const f of ['favicon.png', 'apple-touch-icon.png']) {
  console.log(`${OUT}/${f}  ${(statSync(`${OUT}/${f}`).size / 1024).toFixed(1)} KB`)
}
