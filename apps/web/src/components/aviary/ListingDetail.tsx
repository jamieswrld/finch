"use client";

import Link from "next/link";
import type { AviaryListing } from "@finch/db";
import { Badge, DataBadge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { ErrorBlock, LoadingBlock } from "@/components/ui/StateBlocks";
import { formatCompact, formatDate, truncateAddress } from "@/lib/format";
import { useFetch } from "@/lib/use-fetch";

interface Capability {
  name: string;
  mode: "read" | "write";
  category: string;
  risk: string;
  description: string;
  known: boolean;
}

interface ListingResponse {
  source: "db" | "seed";
  listing: AviaryListing;
  capabilities: Capability[];
  permissions: { requiresWrites: boolean; walletMode: string; note: string };
  registry: { onchain: boolean; note: string; id?: string; contract?: string; explorerUrl?: string | null };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/60 py-2.5 last:border-b-0">
      <dt className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-grey-faint">{label}</dt>
      <dd className="text-right font-mono text-[12px] text-ink">{children}</dd>
    </div>
  );
}

export function ListingDetail({ slug }: { slug: string }) {
  const state = useFetch<ListingResponse>(`/api/aviary/${slug}`);

  if (state.status === "loading") {
    return (
      <div className="container-page py-10">
        <LoadingBlock label="loading listing" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="container-page py-10">
        <ErrorBlock message={state.message} onRetry={state.retry} />
        <Link href="/app/aviary" className="mt-4 inline-block font-mono text-[11px] uppercase tracking-[0.1em] text-green-deep">
          ← back to aviary
        </Link>
      </div>
    );
  }

  const { listing, capabilities, permissions, registry, source } = state.data;
  const trust =
    listing.creator.name === "finch-labs"
      ? { tone: "green" as const, label: "official" }
      : listing.verified
        ? { tone: "sage" as const, label: "verified" }
        : { tone: "grey" as const, label: "registered" };

  const usage = `import { createFinch, hyperbolic } from "@finch/sdk";

const nest = await createFinch("my-finch")
  .model(hyperbolic("meta-llama/Llama-3.3-70B-Instruct"))
  .service("${listing.slug}")${
    capabilities.length > 0 ? `\n  .tools(${capabilities.map((capability) => `"${capability.name}"`).join(", ")})` : ""
  }
  .wallet({ mode: "${permissions.walletMode}" })
  .hatch();`;

  return (
    <div className="container-page py-10 md:py-14">
      <Link href="/app/aviary" className="font-mono text-[11px] uppercase tracking-[0.1em] text-grey hover:text-ink">
        ← aviary
      </Link>

      <header className="mt-4 flex flex-col gap-4 border-b border-line pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="label-mono">
            {listing.category} / {listing.slug}
          </p>
          <h1 className="mt-2 text-[32px] leading-[1.05] font-semibold tracking-[-0.02em] md:text-[40px]">
            {listing.name}
          </h1>
          <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-ink-soft">{listing.description}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone={trust.tone}>{trust.label}</Badge>
            {listing.source === "seed" && <DataBadge source="seed" />}
            {listing.chains.map((chain) => (
              <Badge key={chain} tone="sage">
                {chain}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/app/build?service=${listing.slug}`}>Add to a finch</ButtonLink>
          <ButtonLink href={`/app/nests?tab=compose&finch=${slug}`} variant="secondary">
            Use in a nest
          </ButtonLink>
        </div>
      </header>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <section className="rounded-xs border border-line bg-bone-raised">
            <header className="border-b border-line px-4 py-2.5">
              <p className="label-mono text-ink">capabilities — resolved against the flightpath catalog</p>
            </header>
            {capabilities.length === 0 ? (
              <p className="p-4 text-[13px] text-grey">
                This listing declares no Flightpath tools. It exposes its capability over its own API surface.
              </p>
            ) : (
              <ul className="divide-y divide-line/60">
                {capabilities.map((capability) => (
                  <li key={capability.name} className="flex items-start gap-3 p-4">
                    <Badge tone={capability.mode === "write" ? "gold" : "sage"}>{capability.mode}</Badge>
                    <div className="min-w-0">
                      <p className="font-mono text-[12.5px] text-ink">{capability.name}</p>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-grey">{capability.description}</p>
                    </div>
                    {!capability.known && (
                      <span className="ml-auto shrink-0">
                        <Badge tone="red">unknown</Badge>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <p className="label-mono mb-2">attach it</p>
            <CodeBlock title="with @finch/sdk" code={usage} />
          </section>

          <section
            className={`rounded-xs border p-4 ${permissions.requiresWrites ? "border-gold/50 bg-gold/10" : "border-line bg-bone-raised"}`}
          >
            <p className={`label-mono ${permissions.requiresWrites ? "text-gold-deep" : ""}`}>
              permissions required
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{permissions.note}</p>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-xs border border-line bg-bone-raised p-4">
            <p className="label-mono">registry record</p>
            <dl className="mt-2">
              <Row label="publisher">{listing.creator.name}</Row>
              {listing.creator.address && (
                <Row label="address">
                  <span title={listing.creator.address}>{truncateAddress(listing.creator.address, 6)}</span>
                </Row>
              )}
              <Row label="version">{listing.version}</Row>
              <Row label="listed">{formatDate(listing.createdAt)}</Row>
              <Row label="index">{source === "db" ? "mongodb" : "seed"}</Row>
            </dl>
          </section>

          <section className="rounded-xs border border-line bg-bone-raised p-4">
            <p className="label-mono">reported usage</p>
            <dl className="mt-2">
              <Row label="calls / 30d">
                <span className="tnum">{formatCompact(listing.stats.calls30d)}</span>
              </Row>
              <Row label="uptime / 90d">
                <span className="tnum">
                  {listing.stats.uptime90d === null ? "unmeasured" : `${listing.stats.uptime90d.toFixed(2)}%`}
                </span>
              </Row>
              <Row label="pricing">
                {listing.pricing.model === "free"
                  ? "free"
                  : `${listing.pricing.credits ?? 0} cr / ${listing.pricing.model === "per_call" ? "call" : "mo"}`}
              </Row>
            </dl>
            {listing.source === "seed" && (
              <p className="mt-3 text-[11.5px] leading-relaxed text-gold-deep">
                Seed listing — these usage figures are sample data, not measured traffic. Published listings report
                metered calls.
              </p>
            )}
          </section>

          <section className="rounded-xs border border-dashed border-line-strong p-4">
            <p className="flex items-center gap-2">
              <span className="label-mono">onchain registration</span>
              <Badge tone={registry.onchain ? "green" : "grey"}>
                {registry.onchain ? "registered" : "not registered"}
              </Badge>
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-grey">{registry.note}</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
