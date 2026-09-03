import Link from "next/link";
import type { AviaryListing } from "@finch/db";
import { Badge } from "@/components/ui/Badge";
import { formatCompact } from "@/lib/format";

const CATEGORY_LABEL: Record<AviaryListing["category"], string> = {
  agents: "Finch",
  tools: "Tool",
  data: "Data",
  trading: "Trading",
  research: "Research",
  rwa: "RWA",
  infrastructure: "Infrastructure",
};

/**
 * Trust labels per the network spec — provenance, never financial quality:
 * REGISTERED (listing exists) · VERIFIED (ownership/manifest checks passed) ·
 * OFFICIAL (published by Finch). AUDITED appears when a review exists.
 */
function TrustBadge({ listing }: { listing: AviaryListing }) {
  if (listing.creator.name === "finch-labs") return <Badge tone="green">official</Badge>;
  if (listing.verified) return <Badge tone="sage">verified</Badge>;
  return <Badge tone="grey">registered</Badge>;
}

function priceLabel(pricing: AviaryListing["pricing"]): string {
  if (pricing.model === "free") return "free";
  if (pricing.model === "per_call") return `${pricing.credits ?? 0} cr / call`;
  return `${pricing.credits ?? 0} cr / mo`;
}

export function AviaryCard({ listing }: { listing: AviaryListing }) {
  return (
    <article className="flex flex-col rounded-xs border border-line bg-bone-raised transition-colors hover:border-line-strong">
      <header className="flex items-start justify-between gap-3 border-b border-line/70 p-4">
        <div>
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            <Link href={`/app/aviary/${listing.slug}`} className="hover:text-green-deep">
              {listing.name}
            </Link>
          </h3>
          <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-grey">
            {CATEGORY_LABEL[listing.category]} · by {listing.creator.name}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <TrustBadge listing={listing} />
          {listing.source === "builtin" && <Badge tone="gold">seed</Badge>}
        </span>
      </header>

      <p className="flex-1 p-4 pt-3 text-[13px] leading-relaxed text-ink-soft">{listing.description}</p>

      <dl className="grid grid-cols-3 gap-px border-t border-line/70 bg-line/50 font-mono text-[11px]">
        <div className="bg-bone-raised p-3">
          <dt className="text-[9.5px] uppercase tracking-[0.1em] text-grey-faint">calls / 30d</dt>
          <dd className="mt-0.5 text-ink tnum">{formatCompact(listing.stats.calls30d)}</dd>
        </div>
        <div className="bg-bone-raised p-3">
          <dt className="text-[9.5px] uppercase tracking-[0.1em] text-grey-faint">uptime / 90d</dt>
          <dd className="mt-0.5 text-ink tnum">
            {listing.stats.uptime90d === null ? "—" : `${listing.stats.uptime90d.toFixed(2)}%`}
          </dd>
        </div>
        <div className="bg-bone-raised p-3">
          <dt className="text-[9.5px] uppercase tracking-[0.1em] text-grey-faint">price</dt>
          <dd className="mt-0.5 text-ink tnum">{priceLabel(listing.pricing)}</dd>
        </div>
      </dl>

      <footer className="flex items-center justify-between border-t border-line/70 p-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {listing.chains.map((chain) => (
            <Badge key={chain} tone="sage">
              {chain}
            </Badge>
          ))}
          {listing.toolNames.slice(0, 2).map((tool) => (
            <span key={tool} className="font-mono text-[10px] text-grey-faint">
              {tool}
            </span>
          ))}
          {listing.toolNames.length > 2 && (
            <span className="font-mono text-[10px] text-grey-faint">+{listing.toolNames.length - 2}</span>
          )}
        </div>
        <Link
          href={`/app/aviary/${listing.slug}`}
          className="shrink-0 rounded-xs border border-line-strong px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink transition-colors hover:border-green-deep hover:text-green-deep"
        >
          Open →
        </Link>
      </footer>
    </article>
  );
}
