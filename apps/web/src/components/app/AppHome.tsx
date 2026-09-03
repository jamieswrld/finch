"use client";

import Link from "next/link";
import type { AviaryListing, NestDoc, FinchDoc } from "@finch/db";
import { DartGlyph, FinchGlyph } from "@/components/birds/FinchGlyph";
import { Badge, DataBadge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/StateBlocks";
import { formatCompact } from "@/lib/format";
import { useFetch } from "@/lib/use-fetch";
import { RunHistory } from "./RunHistory";

function PanelHeader({ title, href, hrefLabel }: { title: string; href: string; hrefLabel: string }) {
  return (
    <header className="flex items-baseline justify-between border-b border-line px-4 py-2.5">
      <span className="label-mono text-ink">{title}</span>
      <Link href={href} className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-green-deep hover:underline">
        {hrefLabel} →
      </Link>
    </header>
  );
}

function FinchesPanel() {
  const state = useFetch<{ source: string; nests: FinchDoc[] }>("/api/finches");
  return (
    <section className="rounded-xs border border-line bg-bone-raised" aria-label="Your finches">
      <PanelHeader title="finches" href="/app/build" hrefLabel="hatch" />
      <div className="p-4">
        {state.status === "loading" && <LoadingBlock label="loading nests" />}
        {state.status === "error" && <ErrorBlock message={state.message} onRetry={state.retry} />}
        {state.status === "ready" &&
          (state.data.nests.length === 0 ? (
            <EmptyBlock title="no finches yet">Assemble your first finch in the builder — or start in Flight School.</EmptyBlock>
          ) : (
            <ul className="divide-y divide-line/60">
              {state.data.nests.slice(0, 5).map((nest) => {
                const manifest = nest.manifest as { identity?: { name?: string; description?: string }; model?: { model?: string } };
                return (
                  <li key={nest.handle} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <FinchGlyph size={16} className="shrink-0 text-ink-soft" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold tracking-[-0.01em] text-ink">
                        {manifest.identity?.name ?? nest.handle}
                      </p>
                      <p className="truncate font-mono text-[10.5px] text-grey">
                        {nest.handle} · {manifest.model?.model ?? "model unset"}
                      </p>
                    </div>
                    <Badge tone={nest.status === "hatched" ? "green" : "sage"}>{nest.status}</Badge>
                  </li>
                );
              })}
            </ul>
          ))}
        {state.status === "ready" && state.data.source === "seed" && state.data.nests.length > 0 && (
          <p className="mt-3 flex items-center gap-2">
            <DataBadge source="seed" />
            <span className="text-[11px] text-grey">sample finches, not yours</span>
          </p>
        )}
      </div>
    </section>
  );
}

function AviaryPanel() {
  const state = useFetch<{ source: "db" | "seed"; listings: AviaryListing[] }>("/api/aviary");
  return (
    <section className="rounded-xs border border-line bg-bone-raised" aria-label="Aviary highlights">
      <PanelHeader title="aviary — most called" href="/app/aviary" hrefLabel="browse" />
      <div className="p-4">
        {state.status === "loading" && <LoadingBlock label="loading registry" />}
        {state.status === "error" && <ErrorBlock message={state.message} onRetry={state.retry} />}
        {state.status === "ready" && (
          <>
            <ul className="divide-y divide-line/60">
              {state.data.listings.slice(0, 5).map((listing) => (
                <li key={listing.slug} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-[13.5px] font-semibold tracking-[-0.01em] text-ink">
                      {listing.name}
                      {listing.verified && <span className="text-green-deep" aria-label="verified">✓</span>}
                    </p>
                    <p className="truncate font-mono text-[10.5px] uppercase tracking-[0.06em] text-grey">{listing.category}</p>
                  </div>
                  <span className="font-mono text-[11px] text-ink-soft tnum">{formatCompact(listing.stats.calls30d)} calls</span>
                  <Link
                    href={`/app/build?service=${listing.slug}`}
                    className="rounded-xs border border-line-strong px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink hover:border-green-deep hover:text-green-deep"
                  >
                    add
                  </Link>
                </li>
              ))}
            </ul>
            {state.data.listings.some((listing) => listing.source === "seed") && (
              <p className="mt-3 flex items-center gap-2">
                <DataBadge source="seed" />
                <span className="text-[11px] text-grey">
                  includes seed rows, whose call counts are sample figures rather than measured traffic
                </span>
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function SchoolPanel() {
  return (
    <section className="flex flex-col rounded-xs border border-line bg-ink text-bone" aria-label="Flight School">
      <header className="flex items-baseline justify-between border-b border-bone/15 px-4 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-sage">flight school</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-green">no wallet needed</span>
      </header>
      <div className="flex flex-1 flex-col p-4">
        <p className="serif-note text-[19px] leading-snug !text-bone/90">what should your first finch learn?</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-bone/60">
          Five read-only presets on the real runtime — Market Scout, Pons Scout, RWA Researcher, Watchtower, Developer
          Finch. Try one, view its manifest, fork it into the builder.
        </p>
        <div className="mt-auto pt-4">
          <Link
            href="/app/school"
            className="inline-flex h-9 items-center gap-2 rounded-xs border border-green bg-green px-3.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink transition-colors hover:bg-bone hover:border-bone"
          >
            enter flight school <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}

function NestsPanel() {
  const state = useFetch<{ source: "db" | "seed"; nests: NestDoc[] }>("/api/nests");
  return (
    <section className="rounded-xs border border-line bg-bone-raised" aria-label="Nests">
      <PanelHeader title="nests" href="/app/nests?tab=compose" hrefLabel="compose" />
      <div className="p-4">
        {state.status === "loading" && <LoadingBlock label="loading nests" />}
        {state.status === "error" && <ErrorBlock message={state.message} onRetry={state.retry} />}
        {state.status === "ready" && (
          <ul className="divide-y divide-line/60">
            {state.data.nests.slice(0, 4).map((nest) => (
              <li key={nest.slug} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="flex shrink-0 -space-x-1">
                  {nest.stages.slice(0, 4).map((stage) => (
                    <DartGlyph key={stage.id} size={11} angle={-14} className="text-sage-deep" />
                  ))}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold tracking-[-0.01em] text-ink">{nest.name}</p>
                  <p className="truncate font-mono text-[10.5px] text-grey">
                    {nest.stages.length} stages · {nest.stages.reduce((sum, stage) => sum + stage.finches.length, 0)} finches
                  </p>
                </div>
                <Badge tone="sage">{nest.status}</Badge>
              </li>
            ))}
          </ul>
        )}
        {state.status === "ready" && state.data.source === "seed" && state.data.nests.length > 0 && (
          <p className="mt-3 flex items-center gap-2">
            <DataBadge source="seed" />
            <span className="text-[11px] text-grey">preset nests, sample data</span>
          </p>
        )}
      </div>
    </section>
  );
}

export function AppHome() {
  return (
    <div className="container-page py-8 md:py-10">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-line pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="label-mono flex items-center gap-2">
            <span className="inline-block size-[7px] rounded-full bg-green" />
            mission control
          </p>
          <h1 className="mt-2 text-[28px] leading-[1.05] font-semibold tracking-[-0.02em] md:text-[34px]">
            The nest, at a glance.
          </h1>
        </div>
        <ButtonLink href="/app/build">Hatch a Finch</ButtonLink>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SchoolPanel />
        <RunHistory />
        <FinchesPanel />
        <AviaryPanel />
        <NestsPanel />
      </div>
    </div>
  );
}
