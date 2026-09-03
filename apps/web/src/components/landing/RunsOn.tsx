import { BrandMark } from "@/components/brand/BrandMark";

/**
 * Infrastructure Finch runs on.
 *
 * Deliberately short. An exhaustive rail of every provider in the catalog read
 * as noise at the bottom of the hero; five names that matter reads as a fact.
 *
 * The heading is "infrastructure", not "partners" — and that word is doing the
 * work. Every name here is software or a network Finch actually uses, which is
 * a checkable claim. Calling any of them a partner would assert a relationship
 * none of them agreed to, so the heading must never drift to that.
 */

interface Entry {
  name: string;
  role: string;
  /** Simple Icons slug where a monochrome mark exists. */
  slug?: string;
  /** Typographic fallback for brands with no mark in the set. */
  wordmark?: string;
  href: string | null;
}

const INFRASTRUCTURE: Entry[] = [
  { name: "Robinhood Chain", role: "network · 4663", slug: "robinhood", href: "https://robinhood.com" },
  { name: "MongoDB", role: "registry", slug: "mongodb", href: "https://www.mongodb.com" },
  { name: "Groq", role: "compute", wordmark: "groq", href: "https://groq.com" },
  { name: "OpenRouter", role: "compute", slug: "openrouter", href: "https://openrouter.ai" },
  { name: "Pons", role: "launch", wordmark: "PONS", href: null },
];

function Entry({ entry }: { entry: Entry }) {
  const glyph = entry.slug ? (
    <BrandMark slug={entry.slug} size={18} />
  ) : (
    <span className="font-mono text-[12.5px] font-medium">{entry.wordmark}</span>
  );

  const label = (
    <>
      <span className="flex h-5 items-center justify-center">{glyph}</span>
      <span className="mt-1.5 block font-mono text-[8.5px] text-grey-faint">
        {entry.role}
      </span>
    </>
  );

  if (!entry.href) {
    return (
      <span
        className="cursor-default text-grey-faint"
        title={`${entry.name} — no official link published yet`}
      >
        {label}
      </span>
    );
  }

  return (
    <a
      href={entry.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${entry.name} — opens their official site`}
      title={entry.name}
      className="block text-grey transition-colors hover:text-ink"
    >
      {label}
    </a>
  );
}

export function RunsOn() {
  return (
    <div className="relative z-10">
      <p className="text-center font-mono text-[9px] text-grey-faint">infrastructure</p>

      <ul className="mt-3.5 flex flex-wrap items-start justify-center gap-x-10 gap-y-5">
        {INFRASTRUCTURE.map((entry) => (
          <li key={entry.name} className="text-center">
            <Entry entry={entry} />
          </li>
        ))}
      </ul>
    </div>
  );
}
