// Un-composite black ink from a white background: alpha = 1 - brightness,
// color = pure black. White interior details (the bird's eye) become clean holes.
// Requires sharp (npm i --no-save sharp):  node scripts/ink-logo.mjs
import sharp from 'sharp'

const SRC = 'C:/Users/carne/Downloads/finch.funlogo.png'

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

for (let i = 0; i < data.length; i += 4) {
  const brightness = Math.min(data[i], data[i + 1], data[i + 2])
  data[i] = 0
  data[i + 1] = 0
  data[i + 2] = 0
  data[i + 3] = 255 - brightness
}

const img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).trim()
await img.clone().resize({ width: 512 }).webp({ quality: 90 }).toFile('public/brand/mark.webp')
await img.clone().resize({ width: 64 }).png().toFile('public/brand/favicon.png')
console.log('wrote public/brand/mark.webp + favicon.png')
