"use client";

import { useState, type ReactNode } from "react";
import { useFetch } from "@/lib/use-fetch";
import { ErrorBlock, LoadingBlock } from "@/components/ui/StateBlocks";
import { explorerAddressUrl } from "@/lib/chain";
import { truncateAddress } from "@/lib/format";

/**
 * $FINCH, read live.
 *
 * Everything here comes from GET /api/token, which reads the pump.fun
 * bonding-curve account and the SPL mint account on Solana, Jupiter (price,
 * holder count) and DexScreener (markets)
 * for that request (behind a short server cache). Each of those is its own
 * block with its own reachable flag: a sub-read that failed renders as
 * "unreachable" — never as 0, never as a remembered value.
 *
 * Before any of that, the section answers whether there is a token at all.
 * No mint configured, a published address with no mint account behind it
 * (not launched), and a chain that could not be asked are three different
 * states, each said plainly and none of them with numbers. Nothing here calls
 * the token live or trading unless the API reports `launched: true`. The only
 * client-side work is string formatting; no arithmetic on chain values
 * happens in the browser.
 */

// ── the API shape: FinchTokenReadout & { cache, cachedAt } ───────────────

interface TokenReadout {
  mint: string;
  relation: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  supply: string | null;
  supplyFormatted: string | null;
  tokenProgram: string | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  explorerUrl: string | null;
  reachable: boolean;
  error?: string;
}

interface TokenMarket {
  dex: string | null;
  pairAddress: string;
  url: string | null;
  baseToken: { address: string; symbol: string | null };
  quoteToken: { address: string; symbol: string | null };
  priceNative: number | string | null;
  priceUsd: string | number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  txns24h: { buys: number | null; sells: number | null } | null;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  pairCreatedAt: string | number | null;
}

interface PriceRead {
  reachable: boolean;
  source: "jupiter";
  data: { usdPrice: number | null; liquidityUsd: number | null; priceChange24h: number | null } | null;
  error?: string;
}

interface MarketsRead {
  reachable: boolean;
  source: "dexscreener";
  data: TokenMarket[] | null;
  error?: string;
}

type LaunchPhase = "not_launched" | "bonding_curve" | "graduated" | "not_on_pump";

/** The pump.fun curve as the curve account reports it (PumpCurve in @finch/flightpath). */
interface PumpCurve {
  mint: string;
  curve: string;
  phase: LaunchPhase;
  /** 0–100; null when it could not be computed — then no progress is shown at all. */
  progressPct: number | null;
  solInCurve: string | null;
  priceSol: string | null;
  tokensLeftOnCurve: string | null;
  creator: string | null;
  explorerUrl: string;
}

interface LaunchpadRead {
  venue: "pump.fun";
  reachable: boolean;
  source: "rpc:pump.fun";
  data: PumpCurve | null;
  error?: string;
}

interface TokenResponse {
  readAt: string;
  configured: boolean;
  /** Whether a mint account exists at `mint`. Null: the chain could not be asked. */
  launched: boolean | null;
  mint: string | null;
  explorerUrl: string | null;
  token: TokenReadout | null;
  price: PriceRead | null;
  markets: MarketsRead | null;
  holders: { count: number | null; source: "jupiter" | null; error?: string } | null;
  launchpad?: LaunchpadRead | null;
  gate: { publishingFree: true; note: string } | null;
  note?: string;
  cache?: unknown;
  cachedAt?: string | null;
}

interface PublishStatus {
  state: "locked" | "open" | "error";
  mechanism: "free" | "hold" | "pay";
  reason: string;
}

const OPEN_FREE = [
  "Finch SDK + manifests",
  "self-hosting",
  "Aviary browsing",
  "Flight School read-only presets",
  "public Solana reads",
  "publishing finches and nests",
];

const TOKEN_PROGRAMS: Record<string, string> = {
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022",
};

// ── formatting only ──────────────────────────────────────────────────────

/**
 * Group the integer part of an already-formatted decimal string. The
 * fraction is truncated to `maxFraction` digits, never rounded, and the
 * digits never pass through a double.
 */
function formatDecimalString(value: string, maxFraction = 0): string {
  const [whole = "", fraction = ""] = value.split(".");
  if (!/^\d+$/.test(whole)) return value;
  const grouped = BigInt(whole).toLocaleString("en-US");
  const kept = fraction.slice(0, maxFraction).replace(/0+$/, "");
  return kept ? `${grouped}.${kept}` : grouped;
}

/**
 * A curve price is a long run of zeros then a few digits. Keep four
 * significant digits of the decimal string as given — no float, no rounding.
 */
function formatSmallDecimal(value: string): string {
  const [whole = "", fraction = ""] = value.split(".");
  if (!/^\d+$/.test(whole)) return value;
  if (whole !== "0") return formatDecimalString(value, 6);
  const zeros = (fraction.match(/^0*/)?.[0] ?? "").length;
  const significant = fraction.slice(zeros, zeros + 4).replace(/0+$/, "");
  return significant ? `0.${"0".repeat(zeros)}${significant}` : "0";
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A token price can be a fraction of a cent; keep four significant digits instead of rounding it to $0.00. */
function formatUsdPrice(value: string | number | null | undefined): string | null {
  const n = toNumber(value);
  if (n === null) return null;
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${n.toLocaleString("en-US", { maximumSignificantDigits: 4 })}`;
}

function formatUsdCompact(value: number | null | undefined): string | null {
  const n = toNumber(value);
  if (n === null) return null;
  return `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)}`;
}

function relativeTime(iso: string | null | undefined, now: number): string {
  if (!iso) return "at an unknown time";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "at an unknown time";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `on ${iso.slice(0, 10)}`;
}

// ── pieces ───────────────────────────────────────────────────────────────

function Unreachable({ error }: { error?: string }) {
  return (
    <span className="text-grey" title={error}>
      unreachable
    </span>
  );
}

function Missing() {
  return <span className="text-grey-faint">—</span>;
}

function ExplorerLink({ href, children, title }: { href: string; children: ReactNode; title?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className="text-ink-soft underline decoration-line-strong underline-offset-2 hover:text-green-deep"
    >
      {children} ↗
    </a>
  );
}

function Row({ label, note, children }: { label: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_1fr] gap-3 border-b border-line/60 py-2.5 last:border-0 sm:grid-cols-[132px_1fr]">
      <dt className="label-mono pt-px">{label}</dt>
      <dd className="min-w-0">
        <div className="tnum font-mono text-[12.5px] leading-snug break-words text-ink">{children}</div>
        {note && <div className="mt-0.5 font-mono text-[9.5px] leading-snug text-grey-faint">{note}</div>}
      </dd>
    </div>
  );
}

function Panel({ title, footer, children }: { title: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xs border border-line bg-bone-raised p-5">
      <p className="label-mono mb-2">{title}</p>
      {children}
      {footer && <p className="mt-3 font-mono text-[8.5px] text-grey-faint">{footer}</p>}
    </div>
  );
}

function readLine(source: string, readAt: string | null | undefined, now: number, cached: boolean): string {
  return `${source} · read ${relativeTime(readAt, now)}${cached ? " · served from a 20 s server cache" : ""}`;
}

/**
 * An authority cell. Unreadable is not the same as "none": only a readable
 * mint with a null authority means the power was given up.
 */
function Authority({ token, value, none }: { token: TokenReadout; value: string | null; none: string }) {
  if (!token.reachable) return <Unreachable error={token.error} />;
  if (value) {
    return (
      <ExplorerLink href={explorerAddressUrl(value)} title={value}>
        {truncateAddress(value, 6)}
      </ExplorerLink>
    );
  }
  return <>{none}</>;
}

const PHASE_LABEL: Record<LaunchPhase, string> = {
  bonding_curve: "on the pump.fun bonding curve",
  graduated: "graduated from the pump.fun curve",
  not_on_pump: "no pump.fun curve for this mint",
  not_launched: "not launched",
};

/** The pump.fun launch, read from the curve account. Its own block, with its own failure state. */
function LaunchPanel({ data, now }: { data: TokenResponse; now: number }) {
  const readAt = data.cachedAt ?? data.readAt;
  const cached = data.cache === "cached";
  const launchpad = data.launchpad ?? null;
  const curve = launchpad?.reachable ? launchpad.data : null;

  return (
    <Panel title="launch · pump.fun" footer={readLine("pump.fun curve account", readAt, now, cached)}>
      {!launchpad || !launchpad.reachable || !curve ? (
        <p className="font-mono text-[12px] text-grey" title={launchpad?.error}>
          unreadable{launchpad?.error ? ` — ${launchpad.error}` : ""}
        </p>
      ) : (
        <dl>
          <Row label="phase">{PHASE_LABEL[curve.phase] ?? curve.phase}</Row>

          {curve.progressPct !== null && (
            <Row label="progress">
              {curve.progressPct.toFixed(2)}% of the curve sold
              <div className="mt-1.5 h-[3px] w-full max-w-[240px] rounded-xs bg-line" aria-hidden>
                <div className="h-full rounded-xs bg-green-deep" style={{ width: `${Math.min(100, Math.max(0, curve.progressPct))}%` }} />
              </div>
            </Row>
          )}

          <Row label="SOL in curve">{curve.solInCurve ? `${formatDecimalString(curve.solInCurve, 4)} SOL` : <Missing />}</Row>

          <Row
            label="curve price"
            note={curve.phase === "graduated" ? "the curve is complete; trading moved to pump.fun's AMM — see markets" : undefined}
          >
            {curve.priceSol ? `${formatSmallDecimal(curve.priceSol)} SOL per token` : <Missing />}
          </Row>

          <Row label="left on curve">
            {curve.tokensLeftOnCurve ? `${formatDecimalString(curve.tokensLeftOnCurve)} tokens` : <Missing />}
          </Row>

          <Row label="creator">
            {curve.creator ? (
              <ExplorerLink href={explorerAddressUrl(curve.creator)} title={curve.creator}>
                {truncateAddress(curve.creator, 6)}
              </ExplorerLink>
            ) : (
              <Missing />
            )}
          </Row>

          <Row label="curve account">
            <ExplorerLink href={curve.explorerUrl} title={curve.curve}>
              {truncateAddress(curve.curve, 6)}
            </ExplorerLink>
          </Row>
        </dl>
      )}
    </Panel>
  );
}

function MintPanel({ data, now }: { data: TokenResponse; now: number }) {
  const token = data.token;
  const readAt = data.cachedAt ?? data.readAt;
  const cached = data.cache === "cached";
  const mint = data.mint ?? token?.mint ?? null;
  const program = token?.tokenProgram ?? null;

  return (
    <Panel title="the mint, read from Solana" footer={readLine("mint account", readAt, now, cached)}>
      <dl>
        <Row label="token" note="name · symbol">
          {token?.reachable ? (
            token.name || token.symbol ? (
              <>
                {token.name ?? <Missing />}
                <span className="text-grey"> · </span>
                {token.symbol ?? <Missing />}
              </>
            ) : (
              <span className="text-grey">no name or symbol on record</span>
            )
          ) : (
            <Unreachable error={token?.error} />
          )}
        </Row>

        <Row label="mint" note="SPL mint address">
          {mint ? (
            data.explorerUrl ? (
              <ExplorerLink href={data.explorerUrl} title={mint}>
                {mint}
              </ExplorerLink>
            ) : (
              mint
            )
          ) : (
            <Missing />
          )}
        </Row>

        <Row label="supply" note={token?.decimals != null ? `${token.decimals} decimals` : undefined}>
          {!token?.reachable ? (
            <Unreachable error={token?.error} />
          ) : token.supplyFormatted ? (
            formatDecimalString(token.supplyFormatted)
          ) : (
            <Missing />
          )}
        </Row>

        <Row label="token program" note={program ?? undefined}>
          {!token?.reachable ? (
            <Unreachable error={token?.error} />
          ) : program ? (
            (TOKEN_PROGRAMS[program] ?? truncateAddress(program, 6))
          ) : (
            <Missing />
          )}
        </Row>

        <Row
          label="mint authority"
          note={token?.reachable ? (token.mintAuthority ? "can mint more supply" : "no key can mint more") : undefined}
        >
          {token ? <Authority token={token} value={token.mintAuthority} none="none · the supply is fixed" /> : <Unreachable />}
        </Row>

        <Row
          label="freeze authority"
          note={token?.reachable ? (token.freezeAuthority ? "can freeze token accounts" : "no key can freeze accounts") : undefined}
        >
          {token ? <Authority token={token} value={token.freezeAuthority} none="none" /> : <Unreachable />}
        </Row>
      </dl>
    </Panel>
  );
}

function MarketPanel({ data, now }: { data: TokenResponse; now: number }) {
  const readAt = data.cachedAt ?? data.readAt;
  const cached = data.cache === "cached";
  const price = data.price;
  const holders = data.holders;
  const priceData = price?.reachable ? price.data : null;
  const usd = formatUsdPrice(priceData?.usdPrice);
  const change = toNumber(priceData?.priceChange24h);
  const liquidity = formatUsdCompact(priceData?.liquidityUsd);

  return (
    <Panel title="price and holders" footer={readLine("Jupiter", readAt, now, cached)}>
      <dl>
        <Row
          label="price"
          note={
            priceData
              ? [change !== null ? `24h ${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : null, liquidity ? `liquidity ${liquidity}` : null]
                  .filter(Boolean)
                  .join(" · ") || undefined
              : undefined
          }
        >
          {!price || !price.reachable ? (
            <Unreachable error={price?.error} />
          ) : usd ? (
            usd
          ) : (
            <span className="text-grey">not priced by Jupiter</span>
          )}
        </Row>
        <Row label="holders">
          {holders && holders.count !== null ? holders.count.toLocaleString("en-US") : <Unreachable error={holders?.error} />}
        </Row>
      </dl>
    </Panel>
  );
}

function MarketsTable({ data, now }: { data: TokenResponse; now: number }) {
  const readAt = data.cachedAt ?? data.readAt;
  const cached = data.cache === "cached";
  const markets = data.markets;

  return (
    <Panel title="markets" footer={readLine("DexScreener", readAt, now, cached)}>
      {!markets || !markets.reachable || !markets.data ? (
        <p className="font-mono text-[12px] text-grey" title={markets?.error}>
          unreachable{markets?.error ? ` — ${markets.error}` : ""}
        </p>
      ) : markets.data.length === 0 ? (
        <p className="font-mono text-[12px] text-grey">no DEX market found for this mint</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line">
                {["dex", "pair", "price", "liquidity", "24h volume"].map((head) => (
                  <th key={head} className="pb-2 pr-3 font-mono text-[9px] font-normal text-grey-faint last:pr-0">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {markets.data.map((market) => {
                const pair = `${market.baseToken.symbol ?? truncateAddress(market.baseToken.address)} / ${market.quoteToken.symbol ?? truncateAddress(market.quoteToken.address)}`;
                return (
                  <tr key={market.pairAddress} className="border-b border-line/60 last:border-0">
                    <td className="py-2 pr-3 font-mono text-[11.5px] text-ink">{market.dex ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono text-[11.5px]">
                      {market.url ? (
                        <ExplorerLink href={market.url} title={market.pairAddress}>
                          {pair}
                        </ExplorerLink>
                      ) : (
                        <span className="text-ink-soft" title={market.pairAddress}>
                          {pair}
                        </span>
                      )}
                    </td>
                    <td className="tnum py-2 pr-3 font-mono text-[11.5px] text-ink-soft">{formatUsdPrice(market.priceUsd) ?? "—"}</td>
                    <td className="tnum py-2 pr-3 font-mono text-[11.5px] text-ink-soft">{formatUsdCompact(market.liquidityUsd) ?? "—"}</td>
                    <td className="tnum py-2 font-mono text-[11.5px] text-ink-soft">{formatUsdCompact(market.volume24hUsd) ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function NotConfigured({ note }: { note?: string }) {
  return (
    <div className="rounded-xs border border-line bg-bone-raised p-5">
      <p className="label-mono">$FINCH on Solana</p>
      <p className="mt-3 text-[15px] leading-relaxed text-ink">No Solana mint is configured for $FINCH yet.</p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
        There is no supply, price, holder count or market to show, so this section shows none. Publishing, running and
        composing finches and nests are free, and nothing here needs a token.
      </p>
      {note && <p className="mt-3 font-mono text-[9.5px] text-grey-faint">{note}</p>}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1_500);
          })
          .catch(() => undefined);
      }}
      className="shrink-0 rounded-xs border border-line px-2 py-1 font-mono text-[10.5px] text-ink-soft hover:border-green-deep hover:text-green-deep"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

/** The published address, shown whole: people check it character by character. */
function MintAddress({ mint, explorerUrl }: { mint: string; explorerUrl: string | null }) {
  return (
    <div className="mt-4 rounded-xs border border-line bg-bone p-3">
      <p className="font-mono text-[9.5px] text-grey-faint">contract address · SPL mint</p>
      <div className="mt-1.5 flex items-center gap-3">
        <code className="min-w-0 flex-1 font-mono text-[12.5px] break-all text-ink">{mint}</code>
        <CopyButton value={mint} />
      </div>
      {explorerUrl && (
        <p className="mt-2 font-mono text-[11px]">
          <ExplorerLink href={explorerUrl} title={mint}>
            {/* the explorer is configurable; only name Solscan when that is where the link goes */}
            {explorerUrl.includes("solscan.io") ? "view on Solscan" : "view in the explorer"}
          </ExplorerLink>
        </p>
      )}
    </div>
  );
}

/** Configured address, no mint account behind it: announced, not launched. */
function NotLaunched({ data, now }: { data: TokenResponse; now: number }) {
  return (
    <div className="rounded-xs border border-line bg-bone-raised p-5">
      <p className="label-mono">$FINCH on pump.fun · not launched</p>
      <p className="mt-3 text-[15px] leading-relaxed text-ink">$FINCH launches on pump.fun. It has not launched yet.</p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
        There is no mint account at its address yet, so there is no curve progress, supply, holder count, price or
        market to show — and this section shows none. They appear here once it launches. Publishing stays free either
        way.
      </p>
      {data.mint && <MintAddress mint={data.mint} explorerUrl={data.explorerUrl} />}
      <p className="mt-3 font-mono text-[8.5px] text-grey-faint">
        mint account checked {relativeTime(data.cachedAt ?? data.readAt, now)}
        {data.cache === "cached" ? " · served from a 20 s server cache" : ""}
      </p>
    </div>
  );
}

/** The chain could not be asked. That is not the same as "not launched". */
function LaunchUnreadable({ data, now, onRetry }: { data: TokenResponse; now: number; onRetry: () => void }) {
  return (
    <div className="rounded-xs border border-gold/50 bg-gold/10 p-5" role="status">
      <p className="label-mono text-gold-deep">$FINCH on Solana · unreadable</p>
      <p className="mt-3 text-[13.5px] leading-relaxed text-ink-soft">
        The Solana RPC could not be asked whether a mint account exists at this address, so this section cannot say
        whether $FINCH has launched on pump.fun. Nothing is shown in place of the read.
      </p>
      {data.note && <p className="mt-2 font-mono text-[10.5px] text-grey">{data.note}</p>}
      {data.mint && <MintAddress mint={data.mint} explorerUrl={data.explorerUrl} />}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-xs border border-gold/50 px-2.5 py-1.5 font-mono text-[11px] text-gold-deep hover:bg-gold/10"
        >
          retry
        </button>
        <span className="font-mono text-[8.5px] text-grey-faint">tried {relativeTime(data.cachedAt ?? data.readAt, now)}</span>
      </div>
    </div>
  );
}

function OpenFree({ note }: { note: string | null }) {
  const gate = useFetch<PublishStatus>("/api/publish/status", { refreshMs: 60_000 });
  const gateLine =
    gate.status === "ready"
      ? `publishing: ${gate.data.state} · ${gate.data.mechanism}`
      : gate.status === "loading"
        ? "publishing: reading…"
        : "publishing: unreachable";

  return (
    <div className="rounded-xs border border-line bg-bone-raised p-4">
      <p className="label-mono text-green-deep">free / open</p>
      <ul className="mt-3 space-y-2">
        {OPEN_FREE.map((item) => (
          <li key={item} className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-soft">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-green" />
            {item}
          </li>
        ))}
      </ul>
      <p className="mt-4 font-mono text-[11px] text-ink" title={gate.status === "ready" ? gate.data.reason : undefined}>
        {gateLine}
      </p>
      <p className="mt-1 font-mono text-[8.5px] text-grey-faint">
        {note ?? "the token gates nothing today"} · read from /api/publish/status
      </p>
    </div>
  );
}

// ── the section body ─────────────────────────────────────────────────────

export function TokenLive() {
  const state = useFetch<TokenResponse>("/api/token", { refreshMs: 60_000 });

  if (state.status === "loading") return <LoadingBlock label="reading solana" />;
  if (state.status === "error") return <ErrorBlock message={state.message} onRetry={state.retry} />;

  const now = Date.now();
  const data = state.data;

  if (data.launched !== true) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        {!data.configured ? (
          <NotConfigured note={data.note} />
        ) : data.launched === false ? (
          <NotLaunched data={data} now={now} />
        ) : (
          <LaunchUnreadable data={data} now={now} onRetry={state.retry} />
        )}
        <OpenFree note={data.gate?.note ?? null} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="flex flex-col gap-4">
        <LaunchPanel data={data} now={now} />
        <MintPanel data={data} now={now} />
        <MarketsTable data={data} now={now} />
      </div>
      <div className="flex flex-col gap-4">
        <MarketPanel data={data} now={now} />
        <OpenFree note={data.gate?.note ?? null} />
      </div>
    </div>
  );
}
