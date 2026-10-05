"use client";

import Link from "next/link";
import type { AviaryListing, NestDoc, FinchDoc } from "@finch/db";
import { AgentGlyph, DartGlyph } from "@/components/brand/AgentGlyph";
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
      <Link href={href} className="font-mono text-[10.5px] text-green-deep hover:underline">
        {hrefLabel} →
      </Link>
    </header>
  );
}

/** Stored agent status values, in the words the product uses. */
const AGENT_STATUS_LABEL: Record<string, string> = { draft: "draft", hatched: "launched" };

function AgentsPanel() {
  const state = useFetch<{ source: string; finches: FinchDoc[] }>("/api/agents");
  return (
    <section className="rounded-xs border border-line bg-bone-raised" aria-label="Your agents">
      <PanelHeader title="agents" href="/app/build" hrefLabel="launch" />
      <div className="p-4">
        {state.status === "loading" && <LoadingBlock label="loading agents" />}
        {state.status === "error" && <ErrorBlock message={state.message} onRetry={state.retry} />}
        {state.status === "ready" &&
          (state.data.finches.length === 0 ? (
            <EmptyBlock title="no agents yet">Assemble your first agent in the builder — or start in the playground.</EmptyBlock>
          ) : (
            <ul className="divide-y divide-line/60">
              {state.data.finches.slice(0, 5).map((agent) => {
                const manifest = agent.manifest as { identity?: { name?: string; description?: string }; model?: { model?: string } };
                return (
                  <li key={agent.handle} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <AgentGlyph size={16} className="shrink-0 text-ink-soft" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold tracking-[-0.01em] text-ink">
                        {manifest.identity?.name ?? agent.handle}
                      </p>
                      <p className="truncate font-mono text-[10.5px] text-grey">
                        {agent.handle} · {manifest.model?.model ?? "model unset"}
                      </p>
                    </div>
                    <Badge tone={agent.status === "hatched" ? "green" : "sage"}>{AGENT_STATUS_LABEL[agent.status] ?? agent.status}</Badge>
                  </li>
                );
              })}
            </ul>
          ))}
        {state.status === "ready" && state.data.source === "builtin" && state.data.finches.length > 0 && (
          <p className="mt-3 flex items-center gap-2">
            <DataBadge source="builtin" />
            <span className="text-[11px] text-grey">builtin agents — runnable now; yours appear here once published</span>
          </p>
        )}
      </div>
    </section>
  );
}

function DirectoryPanel() {
  const state = useFetch<{ source: "db" | "builtin"; listings: AviaryListing[] }>("/api/directory");
  return (
    <section className="rounded-xs border border-line bg-bone-raised" aria-label="Directory highlights">
      <PanelHeader title="directory — most called" href="/app/directory" hrefLabel="browse" />
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
                    <p className="truncate font-mono text-[10.5px] text-grey">{listing.category}</p>
                  </div>
                  <span className="font-mono text-[11px] text-ink-soft tnum">{formatCompact(listing.stats.calls30d)} calls</span>
                  <Link
                    href={`/app/build?service=${listing.slug}`}
                    className="rounded-xs border border-line-strong px-2 py-1 font-mono text-[10px] text-ink hover:border-green-deep hover:text-green-deep"
                  >
                    add
                  </Link>
                </li>
              ))}
            </ul>
            {state.data.listings.some((listing) => listing.source === "builtin") && (
              <p className="mt-3 flex items-center gap-2">
                <DataBadge source="builtin" />
                <span className="text-[11px] text-grey">
                  builtin listings — call counts are measured from real runs
                </span>
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function PlaygroundPanel() {
  return (
    <section className="flex flex-col rounded-xs border border-line bg-ink text-bone" aria-label="Playground">
      <header className="flex items-baseline justify-between border-b border-bone/15 px-4 py-2.5">
        <span className="font-mono text-[11px] text-sage">playground</span>
        <span className="font-mono text-[10px] text-green">no wallet needed</span>
      </header>
      <div className="flex flex-1 flex-col p-4">
        <p className="serif-note text-[19px] leading-snug !text-bone/90">what should your first agent learn?</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-bone/60">
          Presets on the real runtime — Market Scout, Wallet Analyst, Token Inspector, Launch Scout and more read
          Solana; Courier prepares a SOL transfer for your own wallet to sign. Try one, view its manifest, fork
          it into the builder.
        </p>
        <div className="mt-auto pt-4">
          <Link
            href="/app/playground"
            className="inline-flex h-9 items-center gap-2 rounded-xs border border-green bg-green px-3.5 font-mono text-[11px] text-ink transition-colors hover:bg-bone hover:border-bone"
          >
            enter the playground <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}

function SwarmsPanel() {
  const state = useFetch<{ source: "db" | "builtin"; nests: NestDoc[] }>("/api/swarms");
  return (
    <section className="rounded-xs border border-line bg-bone-raised" aria-label="Swarms">
      <PanelHeader title="swarms" href="/app/swarms?tab=compose" hrefLabel="compose" />
      <div className="p-4">
        {state.status === "loading" && <LoadingBlock label="loading swarms" />}
        {state.status === "error" && <ErrorBlock message={state.message} onRetry={state.retry} />}
        {state.status === "ready" && (
          <ul className="divide-y divide-line/60">
            {state.data.nests.slice(0, 4).map((swarm) => (
              <li key={swarm.slug} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="flex shrink-0 -space-x-1">
                  {swarm.stages.slice(0, 4).map((stage) => (
                    <DartGlyph key={stage.id} size={11} angle={-14} className="text-sage-deep" />
                  ))}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold tracking-[-0.01em] text-ink">{swarm.name}</p>
                  <p className="truncate font-mono text-[10.5px] text-grey">
                    {swarm.stages.length} stages · {swarm.stages.reduce((sum, stage) => sum + stage.finches.length, 0)} agents
                  </p>
                </div>
                <Badge tone="sage">{swarm.status}</Badge>
              </li>
            ))}
          </ul>
        )}
        {state.status === "ready" && state.data.source === "builtin" && state.data.nests.length > 0 && (
          <p className="mt-3 flex items-center gap-2">
            <DataBadge source="builtin" />
            <span className="text-[11px] text-grey">builtin swarms — every one runs</span>
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
            The swarm, at a glance.
          </h1>
        </div>
        <ButtonLink href="/app/build">Launch an agent</ButtonLink>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PlaygroundPanel />
        <RunHistory />
        <AgentsPanel />
        <DirectoryPanel />
        <SwarmsPanel />
      </div>
    </div>
  );
}
