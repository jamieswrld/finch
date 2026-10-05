import type { ComponentProps } from "react";

/**
 * One agent: a core node inside the boundary it works within, with a single
 * satellite on that boundary — the memory, tools and wallet it carries.
 * Abstract on purpose; it is a node in a swarm, not a creature.
 */
export function AgentGlyph({
  size = 20,
  className = "",
  title,
  ...props
}: ComponentProps<"svg"> & { size?: number; title?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      className={className}
      {...props}
    >
      {title && <title>{title}</title>}
      <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3.6" />
      <circle cx="18.08" cy="5.92" r="2.5" />
    </svg>
  );
}

/** Small directional pointer used in task pipelines and swarm plots. */
export function DartGlyph({ size = 10, className = "", angle = 0 }: { size?: number; className?: string; angle?: number }) {
  return (
    <svg viewBox="-6 -5 12 10" width={size} height={(size * 10) / 12} fill="currentColor" aria-hidden className={className}>
      <path d={`M5 0 L-4 3.2 L-1.6 0 L-4 -3.2 Z`} transform={`rotate(${angle})`} />
    </svg>
  );
}
