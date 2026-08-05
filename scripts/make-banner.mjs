// Build the DexScreener banner (1500x500) from the finch key art.
//
//   node scripts/make-banner.mjs [source.png]
//
// Produces, in public/brand/:
//   banner.png          static 1500x500 (always accepted)
//   banner.webp         animated, looping
//   banner.mp4          same motion, for socials
//
// The source artwork is never regenerated — frames are composited from the
// original pixels, so the logotype, tagline and ticker labels stay exact. Motion
// is a slow breathing zoom, drifting bubbles, and a light sweep across the packs.

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import ffmpeg from 'ffmpeg-static'
import sharp from 'sharp'

const SRC = process.argv[2] ?? 'C:/Users/carne/Downloads/finch.funbanner.png'
const OUT = 'public/brand'
const TMP = '.banner-frames'
const W = 1500
const H = 500
const FRAMES = 72 // ~3s at 24fps, loops seamlessly
const FPS = 24

mkdirSync(OUT, { recursive: true })
rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })

// Bubbles that drift upward and wrap, echoing the ones already in the art.
const BUBBLES = Array.from({ length: 18 }, (_, i) => ({
  x: (i * 83) % W,
  y: (i * 137) % H,
  r: 4 + ((i * 7) % 14),
  speed: 0.25 + ((i % 5) * 0.12),
  alpha: 0.10 + ((i % 4) * 0.045),
}))

function overlaySvg(t) {
  const bubbles = BUBBLES.map((b) => {
    const y = (((b.y - t * FRAMES * b.speed * 2.2) % (H + 60)) + H + 60) % (H + 60) - 30
    return `<circle cx="${b.x}" cy="${y.toFixed(1)}" r="${b.r}" fill="none" stroke="rgba(120,130,180,${b.alpha})" stroke-width="1.2"/>
            <circle cx="${(b.x - b.r * 0.3).toFixed(1)}" cy="${(y - b.r * 0.3).toFixed(1)}" r="${(b.r * 0.28).toFixed(1)}" fill="rgba(255,255,255,${(b.alpha * 2.4).toFixed(3)})"/>`
  }).join('')

  // light sweep travelling left to right across the packs
  const sweepX = -400 + t * (W + 800)
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stop-color="rgba(255,255,255,0)"/>
        <stop offset="45%"  stop-color="rgba(255,255,255,0.30)"/>
        <stop offset="55%"  stop-color="rgba(255,255,255,0.30)"/>
        <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
      </linearGradient>
    </defs>
    ${bubbles}
    <rect x="${sweepX.toFixed(1)}" y="-120" width="260" height="${H + 240}"
          fill="url(#sweep)" transform="rotate(14 ${(sweepX + 130).toFixed(1)} ${H / 2})"/>
  </svg>`
}

const base = sharp(SRC).resize(W, H, { fit: 'cover' })
const baseBuf = await base.png().toBuffer()

console.log(`rendering ${FRAMES} frames…`)
for (let f = 0; f < FRAMES; f++) {
  const t = f / FRAMES
  // breathing zoom: 1.000 -> 1.018 -> 1.000, smooth and seamless at the loop point
  const zoom = 1 + 0.018 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2))
  const zw = Math.round(W * zoom)
  const zh = Math.round(H * zoom)

  const frame = await sharp(baseBuf)
    .resize(zw, zh)
    .extract({
      left: Math.round((zw - W) / 2),
      top: Math.round((zh - H) / 2),
      width: W,
      height: H,
    })
    .composite([{ input: Buffer.from(overlaySvg(t)), blend: 'over' }])
    .png()
    .toBuffer()

  writeFileSync(`${TMP}/f${String(f).padStart(3, '0')}.png`, frame)
}

// static version — the safe upload everywhere
await sharp(baseBuf).png({ quality: 95 }).toFile(`${OUT}/banner.png`)

const run = (args) => execFileSync(ffmpeg, args, { stdio: 'pipe' })

// q:v 62 keeps the gradients clean while landing well under upload limits
run(['-y', '-framerate', String(FPS), '-i', `${TMP}/f%03d.png`,
  '-vcodec', 'libwebp', '-lossless', '0', '-q:v', '62', '-loop', '0',
  '-compression_level', '6', '-preset', 'picture', '-an', '-vsync', '0', `${OUT}/banner.webp`])

// GIF fallback — half-size and half-rate, since GIF has no modern compression
run(['-y', '-framerate', String(FPS), '-i', `${TMP}/f%03d.png`,
  '-vf', `fps=12,scale=${W / 2}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`,
  '-loop', '0', `${OUT}/banner.gif`])

run(['-y', '-framerate', String(FPS), '-i', `${TMP}/f%03d.png`,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18',
  '-movflags', '+faststart', `${OUT}/banner.mp4`])

rmSync(TMP, { recursive: true, force: true })

for (const f of ['banner.png', 'banner.webp', 'banner.gif', 'banner.mp4']) {
  const { size } = await import('node:fs').then((m) => m.statSync(`${OUT}/${f}`))
  console.log(`${OUT}/${f}  ${(size / 1024).toFixed(0)} KB`)
}
