"use client";

import { useEffect, useMemo, useState } from "react";
import type { AviaryCategory, AviaryListing } from "@finch/db";
import { AviaryCard } from "./AviaryCard";
import { DataBadge } from "@/components/ui/Badge";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/StateBlocks";
import { useFetch } from "@/lib/use-fetch";

const CATEGORIES: Array<{ key: AviaryCategory | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "agents", label: "Finches" },
  { key: "tools", label: "Tools" },
  { key: "data", label: "Data" },
  { key: "trading", label: "Trading" },
  { key: "research", label: "Research" },
  { key: "rwa", label: "RWA" },
  { key: "infrastructure", label: "Infrastructure" },
];

interface AviaryResponse {
  source: "db" | "builtin";
  degraded?: boolean;
  note?: string;
  listings: AviaryListing[];
}

export function AviaryBrowser() {
  const [category, setCategory] = useState<AviaryCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (category !== "all") params.set("category", category);
    if (debounced) params.set("q", debounced);
    const query = params.toString();
    return `/api/aviary${query ? `?${query}` : ""}`;
  }, [category, debounced]);

  const state = useFetch<AviaryResponse>(url);

  return (
    <div>
      {/* controls */}
      <div className="flex flex-col gap-3 border-y border-line py-3 md:flex-row md:items-center">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter by category">
          {CATEGORIES.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={category === entry.key}
              onClick={() => setCategory(entry.key)}
              className={`rounded-xs border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${
                category === entry.key
                  ? "border-ink bg-ink text-bone"
                  : "border-transparent text-ink-soft hover:border-line-strong hover:text-ink"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="md:ml-auto">
          <label className="sr-only" htmlFor="aviary-search">
            Search listings
          </label>
          <input
            id="aviary-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="search finches, nests, tools, services…"
            className="h-9 w-full rounded-xs border border-line bg-bone-raised px-3 font-mono text-[12px] text-ink placeholder:text-grey-faint focus:border-green-deep md:w-64"
          />
        </div>
      </div>

      {/* data states */}
      <div className="mt-6">
        {state.status === "loading" && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <LoadingBlock label="loading registry" />
            <LoadingBlock label="loading registry" />
            <LoadingBlock label="loading registry" />
          </div>
        )}

        {state.status === "error" && <ErrorBlock message={state.message} onRetry={state.retry} />}

        {state.status === "ready" && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <DataBadge source={state.data.source === "db" ? "db" : "builtin"} />
              <span className="font-mono text-[11px] text-grey tnum">
                {state.data.listings.length} listing{state.data.listings.length === 1 ? "" : "s"}
              </span>
              {state.data.source === "builtin" && !state.data.degraded && (
                <span className="text-[11.5px] text-grey">
                  Builtin registry — every listing opens and runs. Published listings appear alongside them.
                </span>
              )}
              {state.data.note && <span className="text-[11.5px] text-gold-deep">{state.data.note}</span>}
            </div>

            {state.data.listings.length === 0 ? (
              <EmptyBlock title="no listings match">
                Try a different category or clear the search — or <a href="#publish" className="underline decoration-line-strong underline-offset-2 hover:text-ink">publish something here</a>.
              </EmptyBlock>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {state.data.listings.map((listing) => (
                  <AviaryCard key={listing.slug} listing={listing} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
