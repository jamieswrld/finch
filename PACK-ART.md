# finch — Pack Artwork Direction

Prompts and specs for the four pack images. Written to get **premium product-photo quality**
out of any serious image model (Midjourney, Imagen, Firefly, SDXL). Copy the shared base,
append the per-pack block, and always include the negative prompt.

## Specs (non-negotiable)

- **Aspect ratio:** 3:4 vertical (site renders at 158px wide; export at least 1200×1600)
- **Format:** PNG. Transparent background if the model supports it; otherwise pure white `#FFFFFF` seamless — the site background is white, it must blend invisibly
- **File names:** `public/packs/starter.png`, `bluechip.png`, `ai.png`, `whale.png`
- **No text in the image.** Image models mangle lettering — leave the wrapper textless (or an abstract embossed mark only). The site overlays the pack name in HTML, always crisp
- **Same camera + lighting across all four.** Shoot them as a set, not four unrelated renders

To wire a finished image in: set `image: '/packs/starter.png'` on the pack in
[src/data.ts](src/data.ts). The site falls back to the CSS placeholder until then.

## Base prompt (prepend to every pack)

> Professional studio product photograph of a single sealed premium trading-card booster
> pack, standing upright, front-facing with a subtle 5-degree tilt. Matte foil wrapper with
> crimped seals at top and bottom, soft embossed texture, one restrained blind-debossed
> emblem centered. Luxury fintech aesthetic — minimal, expensive, restrained. Softbox
> daylight from upper left, gentle natural falloff shadow beneath the pack, seamless pure
> white background, high-end e-commerce photography, shallow depth of field on the
> background only, pack tack-sharp. Shot on medium format, 85mm, f/8.

## Negative prompt (append to every pack — this is the anti-slop filter)

> no text, no letters, no logos, no words, no gibberish typography, no neon glow, no lens
> flare, no sparkles, no floating particles, no holographic rainbow clutter, no fantasy
> ornamentation, no dragons or mascots, no hands, no people, no reflections of a room, no
> busy background, no dark background, no oversaturation, no HDR look, no plastic 3D-render
> feel, no beveled cartoon edges, no watermark, no vignette

## Per-pack blocks

### 1. Starter Pack — `starter.png`

> Wrapper in soft sage green (#dfe9db range) fading to warm white at the top. The debossed
> emblem is a single small finch feather, barely catching the light. The most understated
> pack of the set — quiet, approachable, entry-level elegance, like the house brand of a
> private bank.

### 2. Blue Chip Pack — `bluechip.png`

> Wrapper in pale porcelain blue (#dbe6f6 range) with a faint vertical pinstripe texture in
> the foil, visible only at grazing light. Debossed emblem: a minimal laurel wreath. It
> should read as old money — banking-hall marble, heavy stock, engraved stationery energy.

### 3. AI Pack — `ai.png`

> Wrapper in pale lavender-violet (#eae2f5 range) with an ultra-fine etched circuit-trace
> pattern in the foil, tone-on-tone, visible only where light rakes across it. Debossed
> emblem: a small abstract node — a dot with three thin radiating lines. Precision-machined
> feel, like anodized aerospace hardware, still soft and white overall.

### 4. Whale Pack — `whale.png`

> Wrapper in warm champagne (#f3ead6 range) with a hairline deep-navy accent stripe along
> the bottom crimp. Debossed emblem: a single-line whale tail, one continuous engraved
> stroke. The flagship — heavier-looking foil, slightly deeper emboss, the one that looks
> like it costs $100.

## Consistency workflow

1. Generate the **Whale Pack first** — it has the most character. Iterate until the
   lighting, wrapper material, and camera feel right.
2. Reuse that exact result as a style reference (`--sref` in Midjourney, style/reference
   image elsewhere) for the other three, changing only the color and emblem lines.
3. Reject any candidate where: the crimp looks melted, the emblem became a logo with
   letters, the background isn't pure white, or the foil turned glossy-plastic.
4. Cut out the background (any of the packs' tools, or send them to me — I can run
   background removal) and export PNGs at 1200×1600+.

## What I animate once the images land

Already wired, activates the moment `image` is set on a pack:

- **3D pointer tilt** on every pack card (Magic Eden-style perspective follow)
- **Hover lift + soft shadow bloom** on the card
- **Idle float** in the hero fan
- **Shake-and-rip** during opening in the modal

Planned once real art exists (say the word):

- Sheen sweep masked to the actual wrapper shape instead of the placeholder rectangle
- Tear-open animation: top crimp separates and the reveal card slides out of the wrapper
- Parallax between wrapper and emblem on tilt (needs the emblem on a separate transparent
  layer — export one PNG of the bare wrapper + one of the emblem if you want this)
