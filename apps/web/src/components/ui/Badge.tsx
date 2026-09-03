import type { ReactNode } from "react";

type Tone = "green" | "sage" | "gold" | "grey" | "red" | "ink";

const tones: Record<Tone, string> = {
  green: "text-green-deep border-green-deep/40 bg-green-wash/60",
  sage: "text-sage-deep border-sage/60 bg-sage/15",
  gold: "text-gold-deep border-gold/50 bg-gold/10",
  grey: "text-grey border-line bg-bone-sunken/50",
  red: "text-red-deep border-red-deep/40 bg-red-wash/70",
  ink: "text-ink border-ink/30 bg-transparent",
};

export function Badge({ tone = "grey", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex h-[20px] items-center rounded-xs border px-1.5 font-mono text-[10px] uppercase tracking-[0.1em] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * Labels the provenance of displayed data. Used everywhere data renders so
 * pre-launch sample content is never mistaken for live activity.
 */
export function DataBadge({ source }: { source: "live" | "db" | "builtin" | "offline" }) {
  switch (source) {
    case "live":
      return <Badge tone="green">live</Badge>;
    case "db":
      return <Badge tone="sage">registry</Badge>;
    case "builtin":
      // Not a caveat: builtins are shipped, runnable manifests.
      return <Badge tone="sage">builtin</Badge>;
    case "offline":
      return <Badge tone="grey">offline</Badge>;
  }
}

export function StatusDot({ tone = "green", pulse = false }: { tone?: "green" | "sage" | "gold" | "grey" | "red"; pulse?: boolean }) {
  const colors: Record<string, string> = {
    green: "bg-green",
    sage: "bg-sage-deep",
    gold: "bg-gold",
    grey: "bg-grey-faint",
    red: "bg-red-deep",
  };
  return (
    <span className="relative inline-flex size-[7px]">
      {pulse && <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-40 ${colors[tone]}`} />}
      <span className={`relative inline-flex size-[7px] rounded-full ${colors[tone]}`} />
    </span>
  );
}
