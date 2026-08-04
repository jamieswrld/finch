// One-off: download the background-removed pack art, trim transparent borders,
// and write display-size WebP (with alpha) into public/packs/.
import sharp from 'sharp'

const CUTOUTS = {
  starter:
    'https://api.spritecook.ai/v1/assets/c0d8a216-626a-535d-9b31-2ae12d7fe54b/signed-content/raw?sig=y7fLZ_gq81RGTh9EbNkfnZTvdWcKgORD4Ry2ExBI1zA&exp=1785782663',
  bluechip:
    'https://api.spritecook.ai/v1/assets/cef7f5c6-e1e0-54ce-ab29-be814e6e1dd2/signed-content/raw?sig=Vr9ch93F9IvKpbBqMH4RfXTWFeFaMjoT6S3inrB2gmY&exp=1785782669',
  ai:
    'https://api.spritecook.ai/v1/assets/af2dc288-9b71-537e-b8c0-3d0029b5b82c/signed-content/raw?sig=gwqETwZiFn8j8xay7Wi0wFneSCDina6eapGQFdoTIlI&exp=1785782676',
  whale:
    'https://api.spritecook.ai/v1/assets/28510ed5-2933-5eba-8ecd-a122997cfece/signed-content/raw?sig=hZ-ERhuNxfQ_EVvisXdtdAbER0P7IWvsAJUwLBJnH8s&exp=1785782684',
}

for (const [name, url] of Object.entries(CUTOUTS)) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const img = sharp(buf).trim().resize({ width: 800, withoutEnlargement: true }).webp({ quality: 84 })
  const info = await img.toFile(`public/packs/${name}.webp`)
  console.log(`${name}.webp: ${(info.size / 1024).toFixed(0)} KB, alpha=${info.channels === 4}`)
}
