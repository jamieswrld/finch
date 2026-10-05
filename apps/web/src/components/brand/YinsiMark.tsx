import type { ComponentProps } from "react";

/**
 * The Yinsi mark — seven nodes on a sheared hex lattice: one core, four
 * neighbours, two outliers on the diagonal. Read small it is a cluster; read
 * large it is a swarm drifting corner to corner around the node that holds it
 * together. Circles only, so it stays crisp at any size and never needs a
 * hand-tuned path.
 *
 * The core is the one place the mark may take the green accent (`accent`);
 * everything else renders in currentColor.
 */
export interface MarkNode {
  x: number;
  y: number;
  r: number;
  core?: boolean;
}

export const YINSI_MARK_VIEWBOX = "0 0 24 24";

export const YINSI_MARK_NODES: readonly MarkNode[] = [
  { x: 12, y: 12, r: 3.2, core: true },
  { x: 12, y: 4.5, r: 2.2 },
  { x: 4.5, y: 12, r: 2.2 },
  { x: 19.5, y: 12, r: 2.2 },
  { x: 12, y: 19.5, r: 2.2 },
  { x: 4.5, y: 4.5, r: 1.6 },
  { x: 19.5, y: 19.5, r: 1.6 },
];

/** The signal green from the theme, for the core node when `accent` is set. */
export const MARK_ACCENT = "#00c805";

export function YinsiMark({
  size = 20,
  accent = false,
  className = "",
  title,
  ...props
}: ComponentProps<"svg"> & { size?: number; accent?: boolean; title?: string }) {
  return (
    <svg
      viewBox={YINSI_MARK_VIEWBOX}
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      className={className}
      {...props}
    >
      {title && <title>{title}</title>}
      {YINSI_MARK_NODES.map((node) => (
        <circle
          key={`${node.x}-${node.y}`}
          cx={node.x}
          cy={node.y}
          r={node.r}
          fill={node.core && accent ? MARK_ACCENT : undefined}
        />
      ))}
    </svg>
  );
}

/**
 * Mark + wordmark lockup. The wordmark is plain text in the site sans,
 * semibold and tight — sentence case, never letterspaced.
 */
export function YinsiLogo({
  size = 22,
  accent = true,
  className = "",
  textClassName = "text-[15px]",
}: {
  size?: number;
  accent?: boolean;
  className?: string;
  textClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <YinsiMark size={size} accent={accent} />
      <span className={`font-sans font-semibold leading-none tracking-[-0.03em] ${textClassName}`}>Yinsi</span>
    </span>
  );
}
