// Compress pack artwork: public/packs/*.png → .webp (display size, q82).
// Originals are moved to art-src/ so they aren't shipped with the site.
//   node scripts/compress-packs.mjs
import { mkdirSync, readdirSync, renameSync } from 'node:fs'
import sharp from 'sharp'

const SRC = 'public/packs'
const ORIGINALS = 'art-src'
mkdirSync(ORIGINALS, { recursive: true })

for (const file of readdirSync(SRC).filter((f) => f.endsWith('.png'))) {
  const name = file.replace(/\.png$/, '')
  const input = `${SRC}/${file}`
  const output = `${SRC}/${name}.webp`
  const info = await sharp(input)
    .resize({ width: 800, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(output)
  console.log(`${output}: ${(info.size / 1024).toFixed(0)} KB`)
  renameSync(input, `${ORIGINALS}/${file}`)
}
