import Link from "next/link";
import { YinsiLogo } from "@/components/brand/YinsiMark";

const COLUMNS = [
  {
    title: "Network",
    links: [
      { href: "/app/playground", label: "Playground" },
      { href: "/app/directory", label: "Directory" },
      { href: "/app/swarms", label: "Swarms" },
      { href: "/app/network", label: "Network" },
      { href: "/app/build", label: "Agent builder" },
    ],
  },
  {
    title: "Knowledge",
    links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/docs", label: "Documentation" },
      { href: "/docs#sdk", label: "SDK" },
      { href: "/docs#execution", label: "Execution layer" },
      { href: "/research", label: "Research" },
    ],
  },
  {
    title: "Protocol",
    links: [
      { href: "/research#proposals", label: "Improvement Proposals" },
      { href: "/research#grants", label: "Grants" },
      { href: "/docs#security", label: "Security model" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line bg-bone-raised">
      <div className="container-page py-12">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <YinsiLogo size={20} textClassName="text-[15px]" className="text-ink" />
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-grey">
              A decentralized operating layer for intelligent software on Solana. Build one agent. Coordinate
              millions.
            </p>
            <p className="mt-4 label-mono">solana · open agent infrastructure</p>
            <div className="mt-3 flex items-center gap-4 font-mono text-[11px]">
              <a
                href="https://x.com/finchnests"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink-soft transition-colors hover:text-green-deep"
              >
                X ↗
              </a>
              <a
                href="https://github.com/jamieswrld/finch"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink-soft transition-colors hover:text-green-deep"
              >
                GitHub ↗
              </a>
            </div>
          </div>
          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <p className="label-mono">{column.title}</p>
              <ul className="mt-3 space-y-2">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className="text-[13px] text-ink-soft transition-colors hover:text-green-deep">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 border-t border-line pt-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <p className="font-mono text-[10.5px] text-grey-faint">
              one agent → many agents → swarm → swarm-to-swarm → network
            </p>
            <p className="max-w-2xl text-[11px] leading-relaxed text-grey-faint md:text-right">
              Nothing on this site is an offer or financial advice. Solana, Jupiter, DexScreener, Solscan, MongoDB,
              Hyperbolic, Groq and OpenRouter are referenced as infrastructure Yinsi builds on or reads from; no
              endorsement or affiliation is implied.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
