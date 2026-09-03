import Link from "next/link";
import { FinchGlyph } from "@/components/birds/FinchGlyph";
import { WorldBackground } from "./WorldBackground";
import { RunsOn } from "./RunsOn";
import { LiveWork } from "./LiveWork";

const SYSTEM_ICONS: Array<{ href: string; label: string; icon: React.ReactNode }> = [
  {
    href: "/app/school",
    label: "flight school",
    icon: <path d="M3 10 L15 4 L10.5 10 L15 16 Z M10.5 10 H3.5" fill="none" stroke="currentColor" strokeWidth="1.1" />,
  },
  {
    href: "/app/aviary",
    label: "aviary",
    icon: (
      <g fill="currentColor">
        <circle cx="6.5" cy="6.5" r="1.4" />
        <circle cx="12.5" cy="6.5" r="1.4" />
        <circle cx="6.5" cy="12.5" r="1.4" />
        <circle cx="12.5" cy="12.5" r="1.4" />
      </g>
    ),
  },
  {
    href: "/app/nests",
    label: "nests",
    icon: (
      <g stroke="currentColor" strokeWidth="1.1" fill="none">
        <circle cx="9.5" cy="5.5" r="1.6" />
        <circle cx="5.5" cy="13" r="1.6" />
        <circle cx="13.5" cy="13" r="1.6" />
        <path d="M8.6 7 L6.2 11.6 M10.4 7 L12.8 11.6 M7.1 13 H11.9" />
      </g>
    ),
  },
  {
    href: "/app/network",
    label: "network",
    icon: (
      <g stroke="currentColor" strokeWidth="1.1" fill="none">
        <circle cx="9.5" cy="9.5" r="6.2" />
        <path d="M3.3 9.5 H15.7 M9.5 3.3 C6.8 6.6 6.8 12.4 9.5 15.7 C12.2 12.4 12.2 6.6 9.5 3.3 Z" />
      </g>
    ),
  },
  {
    href: "/docs",
    label: "docs",
    icon: (
      <g stroke="currentColor" strokeWidth="1.1" fill="none">
        <path d="M5.5 4 H13.5 V15 H5.5 Z M7.5 7 H11.5 M7.5 9.5 H11.5 M7.5 12 H10" />
      </g>
    ),
  },
];

function SystemIcons() {
  return (
    <div className="flex items-center gap-2">
      {SYSTEM_ICONS.map((entry) => (
        <Link
          key={entry.label}
          href={entry.href}
          aria-label={entry.label}
          className="group relative flex size-8 items-center justify-center rounded-full border border-line-strong text-ink-soft transition-colors hover:border-ink hover:text-ink"
        >
          <svg viewBox="0 0 19 19" className="size-[17px]">
            {entry.icon}
          </svg>
          <span className="pointer-events-none absolute top-9 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-xs border border-line bg-bone px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ink opacity-0 transition-opacity group-hover:opacity-100">
            {entry.label}
          </span>
        </Link>
      ))}
      <Link
        href="/app"
        className="ml-1 inline-flex h-8 items-center rounded-full border border-ink bg-ink px-3.5 font-mono text-[10px] uppercase tracking-[0.14em] text-bone transition-colors hover:border-green-deep hover:bg-green-deep"
      >
        connect
      </Link>
    </div>
  );
}

const ACTIONS = [
  { href: "/app/school", label: "flight school", primary: true, arrow: "→" },
  { href: "/how-it-works", label: "how it works", arrow: "→" },
  { href: "/app/nests", label: "run a nest", arrow: "→" },
  { href: "/app/aviary", label: "aviary", arrow: "→" },
];

function ActionMatrix() {
  return (
    <div className="mx-auto grid w-full max-w-[430px] grid-cols-2 gap-2">
      {ACTIONS.map((action) => (
        <Link
          key={action.label}
          href={action.href}
          className={`group flex h-11 items-center justify-between rounded-xs border px-3.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-all hover:-translate-y-[1px] ${
            action.primary
              ? "border-green-deep bg-green-deep text-bone hover:bg-ink hover:border-ink"
              : "border-ink/50 bg-bone-raised/60 text-ink hover:border-ink"
          }`}
        >
          {action.label}
          <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>
            {action.arrow}
          </span>
        </Link>
      ))}
    </div>
  );
}

function BottomBar() {
  return (
    <div className="relative z-10 border-t border-line/70">
      <div className="mx-auto flex h-11 max-w-[1500px] items-center justify-between px-4">
        <a
          href="#one"
          className="flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-grey transition-colors hover:text-ink"
        >
          <FinchGlyph size={14} className="rotate-[-90deg]" />
          descend
        </a>
        <div className="flex items-center gap-4 font-mono text-[9.5px] uppercase tracking-[0.14em]">
          <a
            href="https://x.com/finchnests"
            target="_blank"
            rel="noopener noreferrer"
            className="text-grey transition-colors hover:text-ink"
          >
            x ↗
          </a>
          <a
            href="https://github.com/jamieswrld/finch"
            target="_blank"
            rel="noopener noreferrer"
            className="text-grey transition-colors hover:text-ink"
          >
            github ↗
          </a>
          <Link href="/docs" className="text-grey transition-colors hover:text-green-deep">
            docs →
          </Link>
        </div>
      </div>
    </div>
  );
}

/** The first viewport — one artwork: status, systems, hero, actions, ecosystem, socials. */
export function World() {
  return (
    <section className="grain relative flex min-h-[100dvh] flex-col overflow-hidden border-b border-line bg-bone">
      <WorldBackground />

      <header className="relative z-10 mx-auto flex h-14 w-full max-w-[1500px] items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2.5 text-ink" aria-label="Finch">
          <FinchGlyph size={22} />
          <span className="text-[13px] font-semibold tracking-[0.24em]">FINCH</span>
        </Link>
        <SystemIcons />
      </header>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
        <h1 className="reveal text-[56px] leading-none font-semibold tracking-[0.16em] text-ink sm:text-[76px] md:text-[88px]">
          FINCH
        </h1>
        <p className="reveal reveal-2 serif-note mt-4 text-[20px] leading-snug sm:text-[24px]">
          build one nest. coordinate millions.
        </p>
        <p className="reveal reveal-3 mt-3 text-balance font-mono text-[9.5px] uppercase tracking-[0.12em] text-grey sm:text-[10.5px] sm:tracking-[0.16em]">
          permissionless agents · interoperable nests · robinhood native
        </p>

        <div className="reveal reveal-3 mt-8 w-full">
          <ActionMatrix />
        </div>

        <div className="reveal reveal-4 mt-9">
          <LiveWork />
        </div>
      </div>

      <div className="relative z-10 pb-5">
        <RunsOn />
      </div>

      <BottomBar />
    </section>
  );
}
