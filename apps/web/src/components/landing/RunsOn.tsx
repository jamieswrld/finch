import { BrandMark } from "@/components/brand/BrandMark";

/**
 * What Finch runs on.
 *
 * Deliberate wording: "runs on", not "partners". Every name here is software
 * or a network Finch actually uses — that is a factual, checkable claim.
 * Calling any of them a partner would assert a relationship none of them have
 * agreed to, and would be the fastest way to make everything else on this page
 * look unserious.
 *
 * Each entry is either a real link to the vendor's own site, or visibly marked
 * as having no published link. Nothing here is a decoy.
 */

interface Entry {
  name: string;
  /** Simple Icons slug, when a real mark exists for it. */
  slug?: string;
  /** Typographic fallback for brands with no monochrome mark available. */
  wordmark?: string;
  href: string | null;
}

interface Group {
  role: string;
  note: string;
  entries: Entry[];
}

const GROUPS: Group[] = [
  {
    role: "network",
    note: "Where execution settles — chain 4663",
    entries: [{ name: "Robinhood Chain", slug: "robinhood", href: "https://robinhood.com" }],
  },
  {
    role: "compute",
    note: "Model providers Finch can route to — free tiers preferred",
    entries: [
      { name: "Groq", wordmark: "groq", href: "https://groq.com" },
      { name: "Cerebras", wordmark: "cerebras", href: "https://cerebras.ai" },
      { name: "Google Gemini", slug: "googlegemini", href: "https://ai.google.dev" },
      { name: "OpenRouter", slug: "openrouter", href: "https://openrouter.ai" },
      { name: "Ollama", slug: "ollama", href: "https://ollama.com" },
    ],
  },
  {
    role: "data",
    note: "The registry store",
    entries: [{ name: "MongoDB", slug: "mongodb", href: "https://www.mongodb.com" }],
  },
  {
    role: "delivery",
    note: "Where this app is served from",
    entries: [
      { name: "Vercel", slug: "vercel", href: "https://vercel.com" },
      { name: "Next.js", slug: "nextdotjs", href: "https://nextjs.org" },
    ],
  },
  {
    role: "launch",
    note: "Planned venue for the $FINCH launch",
    entries: [{ name: "Pons", wordmark: "PONS", href: null }],
  },
];

function Mark({ entry }: { entry: Entry }) {
  const inner = entry.slug ? (
    <BrandMark slug={entry.slug} size={17} />
  ) : (
    <span className="font-mono text-[12px] font-medium tracking-[0.06em]">{entry.wordmark}</span>
  );

  if (!entry.href) {
    return (
      <span
        className="flex items-center gap-1.5 text-grey-faint"
        title={`${entry.name} — no official link published yet`}
      >
        {inner}
        <span className="font-mono text-[8px] uppercase tracking-[0.14em]">link pending</span>
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
      className="flex items-center gap-1.5 text-grey transition-colors hover:text-ink"
    >
      {inner}
    </a>
  );
}

export function RunsOn() {
  return (
    <div className="relative z-10">
      <p className="text-center font-mono text-[9px] uppercase tracking-[0.2em] text-grey-faint">runs on</p>

      <ul className="mt-3.5 flex flex-wrap items-start justify-center gap-x-9 gap-y-5">
        {GROUPS.map((group) => (
          <li key={group.role} className="text-center" title={group.note}>
            <div className="flex items-center justify-center gap-3.5">
              {group.entries.map((entry) => (
                <Mark key={entry.name} entry={entry} />
              ))}
            </div>
            <p className="mt-1.5 font-mono text-[8.5px] uppercase tracking-[0.18em] text-grey-faint">{group.role}</p>
          </li>
        ))}
      </ul>

      {/* Saying this plainly costs one line and prevents every reasonable
          misreading of the row above it. */}
      <p className="mt-4 text-center font-mono text-[8px] uppercase tracking-[0.14em] text-grey-faint/70">
        third-party names and marks identify software Finch uses · not endorsements or partnerships
      </p>
    </div>
  );
}
