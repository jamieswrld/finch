"use client";

import { useFetch } from "@/lib/use-fetch";
import { explorerAddressUrl } from "@/lib/chain";
import { truncateAddress } from "@/lib/format";
import { ErrorBlock, LoadingBlock } from "@/components/ui/StateBlocks";

/**
 * SPL mints Yinsi tracks on Solana.
 *
 * Every value shown is read from the mint account during the request that
 * renders it. "Tracked" means exactly that Yinsi reads the mint — it asserts
 * no endorsement, listing or affiliation with whoever created it, and the UI
 * says so rather than leaving the reader to assume.
 */

/** Mirrors TokenReadout in @finch/flightpath (GET /api/tokens). */
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

interface TokensResponse {
  chain: string;
  tokens: TokenReadout[];
  at: string;
}

const TOKEN_PROGRAMS: Record<string, string> = {
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "spl token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "token-2022",
};

function compactSupply(value: string | null): string {
  if (!value) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n >= 1e12) return `${(n / 1e12).toFixed(n % 1e12 === 0 ? 0 : 2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 2)}M`;
  return n.toLocaleString("en-US");
}

function AddressLink({ address }: { address: string }) {
  return (
    <a
      href={explorerAddressUrl(address)}
      target="_blank"
      rel="noopener noreferrer"
      className="text-ink-soft underline decoration-line-strong underline-offset-2 hover:text-green-deep"
      title={address}
    >
      {truncateAddress(address)}
    </a>
  );
}

/**
 * An authority cell. Unreadable is not the same as "none": only a readable
 * mint with a null authority means the power was given up.
 */
function Authority({ token, value, noneLabel }: { token: TokenReadout; value: string | null; noneLabel: string }) {
  if (!token.reachable) return <span className="text-grey-faint">—</span>;
  if (value) return <AddressLink address={value} />;
  return <span className="text-grey">{noneLabel}</span>;
}

export function TrackedTokens() {
  const state = useFetch<TokensResponse>("/api/tokens", { refreshMs: 60_000 });

  if (state.status === "loading") return <LoadingBlock label="reading mints" />;
  if (state.status === "error") return <ErrorBlock message={state.message} onRetry={state.retry} />;

  const { tokens } = state.data;
  if (tokens.length === 0) {
    return <p className="font-mono text-[11px] text-grey">no mints tracked yet</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            {["token", "symbol", "supply", "decimals", "program", "mint authority", "freeze authority", "mint"].map((head) => (
              <th key={head} className="pb-2 pr-4 font-mono text-[9px] font-normal text-grey-faint last:pr-0">
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => (
            <tr key={token.mint} className="border-b border-line/60 last:border-0">
              <td className="py-3 pr-4 text-[13.5px] text-ink">
                {token.reachable ? (
                  (token.name ?? <span className="text-grey">unnamed</span>)
                ) : (
                  <span className="text-gold-deep">
                    unreadable
                    {token.error && <span className="block font-mono text-[9px] text-grey-faint">{token.error}</span>}
                  </span>
                )}
                <span className="ml-2 font-mono text-[8.5px] text-grey-faint">{token.relation}</span>
              </td>
              <td className="py-3 pr-4 font-mono text-[12px] text-ink-soft">{token.symbol ?? "—"}</td>
              <td className="tnum py-3 pr-4 font-mono text-[12px] text-ink-soft" title={token.supplyFormatted ?? undefined}>
                {compactSupply(token.supplyFormatted)}
              </td>
              <td className="tnum py-3 pr-4 font-mono text-[12px] text-grey">{token.decimals ?? "—"}</td>
              <td className="py-3 pr-4 font-mono text-[11px] text-grey" title={token.tokenProgram ?? undefined}>
                {token.tokenProgram ? (TOKEN_PROGRAMS[token.tokenProgram] ?? truncateAddress(token.tokenProgram)) : "—"}
              </td>
              <td className="py-3 pr-4 font-mono text-[11px]">
                <Authority token={token} value={token.mintAuthority} noneLabel="none · fixed supply" />
              </td>
              <td className="py-3 pr-4 font-mono text-[11px]">
                <Authority token={token} value={token.freezeAuthority} noneLabel="none" />
              </td>
              <td className="py-3 font-mono text-[11px]">
                {token.explorerUrl ? (
                  <a
                    href={token.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink-soft underline decoration-line-strong underline-offset-2 hover:text-green-deep"
                    title={token.mint}
                  >
                    {truncateAddress(token.mint)} ↗
                  </a>
                ) : (
                  <span className="text-grey" title={token.mint}>
                    {truncateAddress(token.mint)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-3 font-mono text-[8.5px] text-grey-faint">
        read live from Solana · tracked means Yinsi reads the mint — not an endorsement or affiliation
      </p>
    </div>
  );
}
