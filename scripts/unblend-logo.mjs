// Un-composite the finch mark from its black background: for glow-on-black art,
// alpha = max(r,g,b) and color = color/alpha exactly reverses additive blending,
// keeping the glow as soft semi-transparency.
// Requires sharp (npm i --no-save sharp):  node scripts/unblend-logo.mjs
import sharp from 'sharp'

const SRC = 'C:/Users/carne/Downloads/finch.fun.png'

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

for (let i = 0; i < data.length; i += 4) {
  const a = Math.max(data[i], data[i + 1], data[i + 2])
  if (a === 0) {
    data[i + 3] = 0
    continue
  }
  data[i] = Math.min(255, Math.round((data[i] * 255) / a))
  data[i + 1] = Math.min(255, Math.round((data[i + 1] * 255) / a))
  data[i + 2] = Math.min(255, Math.round((data[i + 2] * 255) / a))
  data[i + 3] = a
}

const img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).trim()
await img.clone().resize({ width: 512 }).webp({ quality: 90 }).toFile('public/brand/mark.webp')
await img.clone().resize({ width: 64 }).png().toFile('public/brand/favicon.png')
console.log('wrote public/brand/mark.webp + favicon.png')
