# FINCH brand assets

## The mark

An origami finch that doubles as a forward arrow: the beak is the arrowhead,
the forked tail is the fletching, one raised wing gives it flight. One closed
polygon — no gradients, no outlines, no effects, ever.

| File | What it is |
| --- | --- |
| `finch-mark.svg` | **The production mark** (hand-vectorized, use this everywhere) |
| `finch-mark-source.png` | The generated concept the vector was hand-drawn from (2048px), kept as provenance |

In-app, the same path ships as `FINCH_MARK_PATH` in
`apps/web/src/components/birds/FinchGlyph.tsx`. The browser/app icon is the
rendered origami bird at `apps/web/src/app/icon.png` (bone-backed rounded
square — a transparent black bird is invisible on dark tab bars).

## Usage rules

- **Colors:** ink `#191b14` on bone `#f4f2ea` / white — or reversed (bone on ink).
  Monochrome only; the mark never takes green, gold, or gradients.
- **Clearspace:** keep at least half the mark's height clear on all sides.
- **Minimum size:** 16px wide. Below that, use no mark at all.
- **Lockup:** mark + `FINCH` in Geist semibold, ~0.22em tracking, mark ≈ 1.2×
  the cap height, optically aligned to the wordmark's baseline block.
- Never rotate arbitrarily (the hero uses a deliberate −14° flight angle),
  never outline, never add shadows or glow.

## Provenance

Concepts generated 2026-09-02 with SpriteCook (`gpt-image-2`, 2K, medium),
project "FINCH Brand" (`7790adbe-5286-4e4c-b569-76173b2f7c76`):

- single-bird job `4c728d89-8b71-4d3b-aeb9-78b15996a805` → winner asset
  `b38ace9c-9299-4c1b-b898-221e1dab6fab` (`finch-mark-source.png`)
- murmuration job `82f43e20-6a3c-4131-b086-b294a93aeb61`

The production SVG was drawn by hand against the winning concept (overlay-
checked at 20/32/64px, reversed, and in lockup) — the raster is reference,
the vector is the brand.
