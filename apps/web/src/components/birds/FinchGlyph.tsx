import type { ComponentProps } from "react";

/**
 * The Finch mark — an origami finch whose beak reads as an arrowhead and
 * whose forked tail reads as fletching. Vectorized by hand from the
 * SpriteCook brand concept (brand/finch-mark-source.png); single closed
 * polygon so it stays crisp at any size.
 */
export const FINCH_MARK_PATH =
  "M 13.5 1 L 35 20 L 39 18.5 L 54.5 26.5 L 43.5 29 L 33.5 42 L 17 41.5 L 1.5 43.5 L 12.5 33.5 L 1 26.5 L 21.5 24.5 Z";

export const FINCH_MARK_VIEWBOX = "0 0 56 45";

export function FinchGlyph({
  size = 20,
  className = "",
  title,
  ...props
}: ComponentProps<"svg"> & { size?: number; title?: string }) {
  return (
    <svg
      viewBox={FINCH_MARK_VIEWBOX}
      width={size}
      height={(size * 45) / 56}
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      className={className}
      {...props}
    >
      {title && <title>{title}</title>}
      <path d={FINCH_MARK_PATH} />
    </svg>
  );
}

/** Small directional dart used for nest/swarm plots. */
export function DartGlyph({ size = 10, className = "", angle = 0 }: { size?: number; className?: string; angle?: number }) {
  return (
    <svg viewBox="-6 -5 12 10" width={size} height={(size * 10) / 12} fill="currentColor" aria-hidden className={className}>
      <path d={`M5 0 L-4 3.2 L-1.6 0 L-4 -3.2 Z`} transform={`rotate(${angle})`} />
    </svg>
  );
}
