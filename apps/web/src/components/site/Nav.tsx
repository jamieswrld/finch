"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FinchGlyph } from "@/components/birds/FinchGlyph";

const LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/app/school", label: "Flight School" },
  { href: "/app/aviary", label: "Aviary" },
  { href: "/app/network", label: "Network" },
  { href: "/#finch", label: "$FINCH" },
  { href: "/docs", label: "Docs" },
];

/** Marketing navigation. The wallet lives in the app — this nav's one job is Launch App. */
export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const isActive = (href: string) => !href.includes("#") && pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bone/95 backdrop-blur-[2px]">
      <div className="container-page flex h-14 items-center gap-6">
        <Link href="/" className="flex items-center gap-2.5 text-ink" aria-label="Finch — overview">
          <FinchGlyph size={24} className="text-ink" />
          <span className="font-sans text-[15px] font-semibold">FINCH</span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 lg:flex" aria-label="Primary">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={`rounded-xs border border-transparent px-2.5 py-1.5 font-mono text-[11.5px] transition-colors ${
                isActive(link.href) ?"text-green-deep" : "text-ink-soft hover:text-ink"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <Link
          href="/app"
          className="ml-auto inline-flex h-9 items-center gap-2 rounded-xs border border-ink bg-ink px-3.5 font-mono text-[11px] text-bone transition-colors hover:border-green-deep hover:bg-green-deep lg:ml-3"
        >
          Launch App
          <span aria-hidden>→</span>
        </Link>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex size-9 items-center justify-center rounded-xs border border-line-strong lg:hidden"
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
        >
          <span className="relative block h-[10px] w-4">
            <span
              className={`absolute left-0 top-0 h-px w-full bg-ink transition-transform ${open ?"top-[5px] rotate-45" : ""}`}
            />
            <span
              className={`absolute left-0 bottom-0 h-px w-full bg-ink transition-transform ${open ?"bottom-[4px] -rotate-45" : ""}`}
            />
          </span>
        </button>
      </div>

      {open && (
        <nav className="border-t border-line bg-bone lg:hidden" aria-label="Mobile">
          <div className="container-page flex flex-col py-2">
            {LINKS.map((link, index) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="flex items-baseline justify-between border-b border-line/60 py-3.5 font-mono text-[13px] text-ink"
              >
                {link.label}
                <span className="font-mono text-[10px] text-grey-faint">{String(index + 1).padStart(2, "0")}</span>
              </Link>
            ))}
            <Link
              href="/app"
              className="mt-3 inline-flex h-11 items-center justify-center gap-2 rounded-xs border border-ink bg-ink font-mono text-[12px] text-bone"
            >
              Launch App <span aria-hidden>→</span>
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
