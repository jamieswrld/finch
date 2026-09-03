"use client";

import { useFetch } from "@/lib/use-fetch";
import { ErrorBlock, LoadingBlock } from "@/components/ui/StateBlocks";

/**
 * Token contracts Finch tracks on Robinhood Chain.
 *
 * Every value shown is read from the contract during the request that renders
 * it. "Tracked" means exactly that Finch reads the contract — it asserts no
 * partnership, endorsement, listing or affiliation with whoever deployed it,
 * and the UI says so rather than leaving the reader to assume.
 */

interface TokenReadout {
  address: string;
  relation: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
  totalSupplyFormatted: string | null;
  explorerUrl: string | null;
  reachable: boolean;
  error?: string;
}

interface TokensResponse {
  chainId: number;
  tokens: TokenReadout[];
}

function compactSupply(value: string | null): string {
  if (!value) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n >= 1e12) return `${(n / 1e12).toFixed(n % 1e12 === 0 ? 0 : 2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 2)}M`;
  return n.toLocaleString();
}

export function TrackedContracts() {
  const state = useFetch<TokensResponse>("/api/tokens", { refreshMs: 60_000 });

  if (state.status === "loading") return <LoadingBlock label="reading contracts" />;
  if (state.status === "error") return <ErrorBlock message={state.message} onRetry={state.retry} />;

  const { tokens } = state.data;
  if (tokens.length === 0) {
    return <p className="font-mono text-[11px] text-grey">no contracts tracked yet</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            {["token", "symbol", "total supply", "decimals", "contract"].map((head) => (
              <th
                key={head}
                className="pb-2 font-mono text-[9px] font-normal text-grey-faint"
              >
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => (
            <tr key={token.address} className="border-b border-line/60 last:border-0">
              <td className="py-3 pr-4 text-[13.5px] text-ink">
                {token.reachable ? (
                  token.name
                ) : (
                  <span className="text-gold-deep" title={token.error}>
                    unreadable
                  </span>
                )}
                <span className="ml-2 font-mono text-[8.5px] text-grey-faint">
                  {token.relation}
                </span>
              </td>
              <td className="py-3 pr-4 font-mono text-[12px] text-ink-soft">{token.symbol ?? "—"}</td>
              <td className="tnum py-3 pr-4 font-mono text-[12px] text-ink-soft">
                {compactSupply(token.totalSupplyFormatted)}
              </td>
              <td className="tnum py-3 pr-4 font-mono text-[12px] text-grey">{token.decimals ?? "—"}</td>
              <td className="py-3 font-mono text-[11px]">
                {token.explorerUrl ? (
                  <a
                    href={token.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink-soft underline decoration-line-strong underline-offset-2 hover:text-green-deep"
                    title={token.address}
                  >
                    {token.address.slice(0, 6)}…{token.address.slice(-4)} ↗
                  </a>
                ) : (
                  <span className="text-grey">{token.address.slice(0, 10)}…</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-3 font-mono text-[8.5px] text-grey-faint">
        read live from chain 4663 · tracked means Finch reads the contract — not an endorsement or affiliation
      </p>
    </div>
  );
}
