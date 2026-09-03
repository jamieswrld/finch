import Link from "next/link";
import { FinchGlyph } from "@/components/birds/FinchGlyph";

const COLUMNS = [
  {
    title: "Network",
    links: [
      { href: "/app/school", label: "Flight School" },
      { href: "/app/aviary", label: "Aviary" },
      { href: "/app/nests", label: "Nests" },
      { href: "/app/network", label: "Network" },
      { href: "/app/build", label: "Finch Builder" },
    ],
  },
  {
    title: "Knowledge",
    links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/docs", label: "Documentation" },
      { href: "/docs#sdk", label: "Finch SDK" },
      { href: "/docs#flightpath", label: "Flightpath" },
      { href: "/research", label: "Research" },
    ],
  },
  {
    title: "Protocol",
    links: [
      { href: "/research#fips", label: "Improvement Proposals" },
      { href: "/research#grants", label: "Grants" },
      { href: "/#finch", label: "$FINCH" },
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
            <div className="flex items-center gap-2.5">
              <FinchGlyph size={22} className="text-ink" />
              <span className="text-[15px] font-semibold tracking-[0.22em]">FINCH</span>
            </div>
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-grey">
              A decentralized operating layer for intelligent software on Robinhood Chain. Build one finch. Coordinate
              millions.
            </p>
            <p className="mt-4 label-mono">robinhood · chain 4663 · open agent infrastructure · $finch</p>
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
            <p className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-grey-faint">
              one finch → many finches → nest → nest-to-nest → network
            </p>
            <p className="max-w-2xl text-[11px] leading-relaxed text-grey-faint md:text-right">
              $FINCH has not launched; nothing on this site is an offer or financial advice. Robinhood, MongoDB,
              Hyperbolic and Pons are referenced as ecosystem infrastructure Finch builds on; no partnership or
              endorsement is implied.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
