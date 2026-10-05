# Yinsi brand assets

## Name

**Yinsi** — sentence case in prose and in the wordmark ("Yinsi", never
"YINSI"); lowercase "yinsi" only inside mono labels that are lowercase
throughout. The product's words are plain: agents, swarms, the directory, the
playground, the execution layer, shared memory.

## The mark

Seven nodes on a sheared hex lattice: one core, four neighbours, two smaller
outliers on the diagonal. Small, it reads as a cluster; large, as a swarm
drifting corner to corner around the node that holds it together. Circles
only — no paths, gradients, outlines or effects.

| File | What it is |
| --- | --- |
| `yinsi-mark.svg` | **The production mark** (ink nodes, green core) |
| `../apps/web/public/brand/yinsi-mark.svg` | The same file, served at `/brand/yinsi-mark.svg` |

In-app, the node list ships as `YINSI_MARK_NODES` in
`apps/web/src/components/brand/YinsiMark.tsx`, which also exports `YinsiMark`
(the mark) and `YinsiLogo` (mark + wordmark). A single agent is drawn with
`AgentGlyph` (`components/brand/AgentGlyph.tsx`): a core node inside its
boundary, with one satellite on it.

The browser icon, home-screen icon and share cards are generated from the same
node list at build time — `apps/web/src/app/{icon,apple-icon,opengraph-image,twitter-image}.tsx`
via `components/brand/share-image.tsx`. There are no raster brand files to
keep in sync.

## Colours

| Token | Hex | Use |
| --- | --- | --- |
| bone | `#f4f2ea` | ground; icon tile |
| ink | `#191b14` | the mark's nodes, the wordmark |
| signal green | `#00c805` | the core node only — marks, lines and dots, never text or washes |
| green deep | `#0a7227` | text-safe green |

The mark is ink on bone, or bone on ink. The core node may take signal green;
nothing else in the mark does. Monochrome (all nodes in one colour) is always
allowed.

## Typography

- Wordmark: Geist semibold, tight tracking (about −0.03em), sentence case.
  Mark height ≈ 1.4× the wordmark's cap height, centred on it, gap ≈ 0.4× the
  mark.
- Labels: Geist Mono, sentence case. No letterspaced capitals, no `uppercase`
  with positive tracking, no italic serif.
- The share-card fonts in `apps/web/src/components/brand/fonts/` are Geist and
  Geist Mono (SIL Open Font License 1.1; copyright and licence URL are in each
  file's name table).

## Usage rules

- **Clearspace:** at least half the mark's height on all sides.
- **Minimum size:** 14px. The favicon uses slightly heavier nodes for 16px tabs.
- Never rotate, stretch, re-space or recolour individual satellite nodes; never
  add outlines, shadows or glow.
