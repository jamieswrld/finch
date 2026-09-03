"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FinchGlyph } from "@/components/birds/FinchGlyph";
import { ConnectButton } from "@/components/site/ConnectButton";
import { useFetch } from "@/lib/use-fetch";

const TABS = [
  { href: "/app", label: "Overview", exact: true },
  { href: "/app/school", label: "Flight School" },
  { href: "/app/aviary", label: "Aviary" },
  { href: "/app/nests", label: "Nests" },
  { href: "/app/network", label: "Network" },
  { href: "/app/build", label: "Build" },
];

interface ActivityResponse {
  counts: { finches: number; nests: number; runs: number; tasks: number; proofs: number };
  provenance?: "live" | "builtin";
  registryProvenance?: "live" | "builtin";
}

/**
 * Work, not plumbing.
 *
 * The header used to carry four status dots — database, compute, chain, pons.
 * That answers "are the lights on", which nobody visiting an agent network is
 * asking. This answers "what has it done": real row counts, polled. If the
 * protocol has run nothing, it shows zero rather than a reassuring green dot.
 */
function WorkStrip() {
  const state = useFetch<ActivityResponse>("/api/activity", { refreshMs: 30_000 });
  if (state.status !== "ready") return null;
  const { counts } = state.data;

  // Every figure here is a count of things that exist and run. There is no
  // sample tier to mark.
  const items = [
    { value: counts.nests, label: "nests", hint: "Coordinated swarms in the registry" },
    { value: counts.finches, label: "finches", hint: "Finches in the registry — builtin and published" },
    { value: counts.runs, label: "runs", hint: "Executions carried out" },
    { value: counts.tasks, label: "tasks", hint: "Tasks dispatched inside those runs" },
  ];

  return (
    <span className="hidden items-center gap-4 font-mono text-[10px] text-grey lg:flex">
      {items.map((item) => (
        <span key={item.label} className="flex items-baseline gap-1.5" title={item.hint}>
          <span className="tnum text-[11.5px] font-semibold text-ink">{item.value}</span>
          <span className="text-grey-faint">{item.label}</span>
        </span>
      ))}
    </span>
  );
}

/** The app chrome: compact brand, product tabs, live infra status, wallet. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const isActive = (tab: (typeof TABS)[number]) =>
    tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-bone/95 backdrop-blur-[2px]">
        <div className="container-page flex h-14 items-center gap-4">
          <Link href="/" className="flex items-center gap-2 text-ink" aria-label="Finch — back to overview">
            <FinchGlyph size={22} />
            <span className="hidden font-sans text-[13px] font-semibold sm:block">FINCH</span>
          </Link>
          <span className="hidden h-5 w-px bg-line-strong sm:block" aria-hidden />
          <span className="hidden font-mono text-[10px] text-grey sm:block">app</span>

          <nav className="ml-2 hidden items-center gap-0.5 md:flex" aria-label="App">
            {TABS.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={isActive(tab) ? "page" : undefined}
                className={`rounded-xs px-2.5 py-1.5 font-mono text-[11.5px] transition-colors ${
                  isActive(tab)
                    ?"bg-ink text-bone"
                    : "text-ink-soft hover:bg-bone-sunken/60 hover:text-ink"
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-4">
            <WorkStrip />
            <ConnectButton />
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="flex size-9 items-center justify-center rounded-xs border border-line-strong md:hidden"
              aria-expanded={open}
              aria-label={open ? "Close menu" : "Open menu"}
            >
              <span className="relative block h-[10px] w-4">
                <span className={`absolute left-0 top-0 h-px w-full bg-ink transition-transform ${open ?"top-[5px] rotate-45" : ""}`} />
                <span className={`absolute left-0 bottom-0 h-px w-full bg-ink transition-transform ${open ?"bottom-[4px] -rotate-45" : ""}`} />
              </span>
            </button>
          </div>
        </div>

        {open && (
          <nav className="border-t border-line bg-bone md:hidden" aria-label="App mobile">
            <div className="container-page flex flex-col py-2">
              {TABS.map((tab) => (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`border-b border-line/60 py-3.5 font-mono text-[13px] ${
                    isActive(tab) ?"text-green-deep" : "text-ink"
                  }`}
                >
                  {tab.label}
                </Link>
              ))}
            </div>
          </nav>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-line bg-bone-raised">
        <div className="container-page flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[10px] text-grey-faint">
            finch app · build → hatch → connect → execute → earn
          </p>
          <div className="flex items-center gap-4 font-mono text-[10.5px]">
            <Link href="/docs" className="text-ink-soft hover:text-green-deep">docs</Link>
            <Link href="/research" className="text-ink-soft hover:text-green-deep">research</Link>
            <Link href="/" className="text-ink-soft hover:text-green-deep">← site</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
