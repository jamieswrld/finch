import { explorerTokenUrl, getFlightpathTarget, type FlightpathTarget } from "./chain.ts";
import { isSolanaAddress, WSOL_MINT } from "./codec.ts";
import { readMintInfo } from "./explorer.ts";
import { readJupiterTokens, readTokenMarkets, readTokenPrices, type TokenMarket } from "./market.ts";
import { readPumpCurve, type PumpResult } from "./pump.ts";

/**
 * Tracked token mints on Solana.
 *
 * Every field displayed for these is read from the mint account at request
 * time. Nothing is hardcoded from a spec sheet, because a spec sheet can be
 * wrong and a mint account cannot: if the chain says the supply is X, the
 * supply is X.
 *
 * `relation` is deliberately narrow. Listing a mint here means Finch reads
 * it, nothing more — it is not a claim of endorsement, listing, or
 * affiliation with whoever issued it.
 */

export interface TrackedToken {
  mint: string;
  /** What Finch's actual relationship to this mint is. Keep it literal. */
  relation: string;
}

const FINCH_RELATION = "the network's token — Finch reads it like any other mint";

/** The reference assets agents most often price and move against. */
export const REFERENCE_TOKENS: TrackedToken[] = [
  { mint: WSOL_MINT, relation: "reference asset — wrapped SOL" },
  { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", relation: "reference asset" },
];

/**
 * $FINCH — the pump.fun contract address the team published ahead of launch.
 * Whether a mint account exists there yet is read, never assumed:
 * readFinchToken reports launched:false until the chain has one.
 */
export const FINCH_TOKEN_MINT_DEFAULT = "63GtvVxFKgXCcSAXXkrPtp7vk8oWyEfqwwdB8gNYpump";

/** FINCH_TOKEN_MINT when it is a valid Solana address, else the published default. */
export function getFinchTokenMint(): string | null {
  const value = typeof process !== "undefined" ? process.env.FINCH_TOKEN_MINT : undefined;
  if (isSolanaAddress(value)) return value;
  return isSolanaAddress(FINCH_TOKEN_MINT_DEFAULT) ? FINCH_TOKEN_MINT_DEFAULT : null;
}

/** $FINCH first when configured, then the reference assets. */
export function trackedTokens(): TrackedToken[] {
  const finch = getFinchTokenMint();
  return finch ? [{ mint: finch, relation: FINCH_RELATION }, ...REFERENCE_TOKENS] : [...REFERENCE_TOKENS];
}

/** Kept as a constant for callers that list what is tracked by default. */
export const TRACKED_TOKENS = REFERENCE_TOKENS;

export interface TokenReadout {
  mint: string;
  relation: string;
  /** Null when the read failed or the mint carries no metadata — never a guess. */
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  supply: string | null;
  supplyFormatted: string | null;
  tokenProgram: string | null;
  /** Null once the authority is revoked: nobody can mint more. */
  mintAuthority: string | null;
  freezeAuthority: string | null;
  explorerUrl: string;
  reachable: boolean;
  error?: string;
}

/** Read one mint straight off the chain. */
export async function readToken(token: TrackedToken, target: FlightpathTarget = getFlightpathTarget()): Promise<TokenReadout> {
  const base: TokenReadout = {
    mint: token.mint,
    relation: token.relation,
    name: null,
    symbol: null,
    decimals: null,
    supply: null,
    supplyFormatted: null,
    tokenProgram: null,
    mintAuthority: null,
    freezeAuthority: null,
    explorerUrl: explorerTokenUrl(token.mint, target),
    reachable: false,
  };
  const result = await readMintInfo(token.mint, target);
  if (!result.reachable || !result.data) {
    // A mint that cannot be read is reported as unreadable. Rendering a
    // plausible name here would be inventing data.
    const missing = result.reachable && /^no account exists/.test(result.error ?? "");
    const error = missing
      ? token.relation === FINCH_RELATION
        ? "no mint account yet — $FINCH has not launched on pump.fun"
        : "no mint account exists at this address"
      : result.error ?? "mint could not be read";
    return { ...base, error };
  }
  const info = result.data;
  return {
    ...base,
    reachable: true,
    name: info.name,
    symbol: info.symbol,
    decimals: info.decimals,
    supply: info.supply,
    supplyFormatted: info.supplyFormatted,
    tokenProgram: info.tokenProgram,
    mintAuthority: info.mintAuthority,
    freezeAuthority: info.freezeAuthority,
  };
}

export async function readTrackedTokens(target: FlightpathTarget = getFlightpathTarget()): Promise<TokenReadout[]> {
  return Promise.all(trackedTokens().map((token) => readToken(token, target)));
}

// ── $FINCH ─────────────────────────────────────────────────────────────────

interface SubRead<T> {
  reachable: boolean;
  data: T | null;
  error?: string;
}

export interface FinchTokenReadout {
  readAt: string;
  /** False only when no mint address is configured at all. */
  configured: boolean;
  /**
   * Whether a mint account exists at the address. False means the address is
   * published but nothing has been launched there yet; null means the chain
   * could not be asked.
   */
  launched: boolean | null;
  mint: string | null;
  explorerUrl: string | null;
  /** The mint account itself. */
  token: TokenReadout | null;
  price: (SubRead<{ usdPrice: number; liquidityUsd: number | null; priceChange24h: number | null }> & { source: "jupiter" }) | null;
  markets: (SubRead<TokenMarket[]> & { source: "dexscreener" }) | null;
  /** Holder count as Jupiter indexes it — an indexer figure, not a chain read. */
  holders: { count: number | null; source: "jupiter" | null; error?: string };
  /** The pump.fun curve: bonding progress, or graduation. Null when the mint is unconfigured. */
  launchpad: (PumpResult & { venue: "pump.fun" }) | null;
  /** Publishing on Finch is open and free. The token gates nothing. */
  gate: { publishingFree: true; note: string };
  note?: string;
}

const PUBLISHING_NOTE = "Publishing on Finch is open and free. Holding the token is not required for anything.";

/** Run one sub-read in isolation: a throw becomes the given fallback, never a rejection of the whole readout. */
async function isolated<T>(read: () => Promise<T>, fallback: (error: unknown) => T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    return fallback(error);
  }
}

function reason(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message.slice(0, 160) : fallback;
}

/**
 * Everything Finch can read about its own token, each source reported
 * separately. A sub-read that fails says so in its own { reachable, error };
 * it never takes the others down with it, and this function never throws.
 */
export async function readFinchToken(target: FlightpathTarget = getFlightpathTarget()): Promise<FinchTokenReadout> {
  const readAt = new Date().toISOString();
  const gate = { publishingFree: true as const, note: PUBLISHING_NOTE };
  const mint = getFinchTokenMint();
  if (!mint) {
    return {
      readAt,
      configured: false,
      launched: null,
      mint: null,
      explorerUrl: null,
      token: null,
      price: null,
      markets: null,
      holders: { count: null, source: null },
      launchpad: null,
      gate,
      note: "$FINCH has no Solana mint configured (FINCH_TOKEN_MINT is unset), so there is nothing to read yet.",
    };
  }

  // A published address with no account behind it is a token that has not
  // launched. Say that plainly instead of reporting four failed reads.
  let launched: boolean | null;
  try {
    const { value } = await target.rpc
      .getAccountInfo(mint as never, { encoding: "base64", dataSlice: { offset: 0, length: 0 }, commitment: "confirmed" })
      .send();
    launched = value !== null;
  } catch {
    launched = null;
  }
  if (launched === false) {
    return {
      readAt,
      configured: true,
      launched: false,
      mint,
      explorerUrl: explorerTokenUrl(mint, target),
      token: null,
      price: null,
      markets: null,
      holders: { count: null, source: null },
      launchpad: { ...(await readPumpCurve(mint, target)), venue: "pump.fun" },
      gate,
      note: "No mint account exists at this address yet, so $FINCH has not launched on pump.fun yet. Curve progress, supply, holders, price and markets appear here once it does.",
    };
  }

  const [token, prices, listing, markets, curve] = await Promise.all([
    isolated(
      () => readToken({ mint, relation: FINCH_RELATION }, target),
      (error): TokenReadout => ({
        mint,
        relation: FINCH_RELATION,
        name: null,
        symbol: null,
        decimals: null,
        supply: null,
        supplyFormatted: null,
        tokenProgram: null,
        mintAuthority: null,
        freezeAuthority: null,
        explorerUrl: explorerTokenUrl(mint, target),
        reachable: false,
        error: reason(error, "mint read failed"),
      }),
    ),
    isolated(() => readTokenPrices([mint]), (error) => ({ reachable: false, data: null, source: "jupiter", error: reason(error, "price read failed") })),
    isolated(() => readJupiterTokens([mint]), (error) => ({ reachable: false, data: null, source: "jupiter", error: reason(error, "token read failed") })),
    isolated(() => readTokenMarkets(mint, 10), (error) => ({ reachable: false, data: null, source: "dexscreener", error: reason(error, "market read failed") })),
    isolated(() => readPumpCurve(mint, target), (error): PumpResult => ({ reachable: false, data: null, source: "rpc:pump.fun", error: reason(error, "curve read failed") })),
  ]);

  const quoted = prices.data?.[mint];
  const price: FinchTokenReadout["price"] = !prices.reachable
    ? { reachable: false, data: null, source: "jupiter", error: prices.error }
    : quoted
      ? { reachable: true, data: { usdPrice: quoted.usdPrice, liquidityUsd: quoted.liquidityUsd, priceChange24h: quoted.priceChange24h }, source: "jupiter" }
      : { reachable: true, data: null, source: "jupiter", error: "Jupiter has no price for this mint" };

  const holderCount = listing.data?.find((entry) => entry.mint === mint)?.holderCount ?? null;
  const holders: FinchTokenReadout["holders"] =
    holderCount !== null
      ? { count: holderCount, source: "jupiter" }
      : { count: null, source: null, error: listing.error ?? "Jupiter did not report a holder count" };

  return {
    readAt,
    configured: true,
    launched,
    mint,
    explorerUrl: explorerTokenUrl(mint, target),
    token,
    price,
    markets: { reachable: markets.reachable, data: markets.data, source: "dexscreener", error: markets.error },
    holders,
    launchpad: { ...curve, venue: "pump.fun" },
    gate,
  };
}
