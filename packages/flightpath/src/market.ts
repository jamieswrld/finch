import { isSolanaAddress, type AccountRoleName, type SerializedInstruction } from "./codec.ts";
import type { ExplorerResult } from "./explorer.ts";

/**
 * Market data for Solana tokens: Jupiter (prices, token records, route
 * quotes) and DexScreener (the pools a token trades in).
 *
 * The chain says what a token IS — supply, authorities, balances. What it is
 * WORTH, and where it trades, is indexed off chain by these two services.
 * Every reader here returns { reachable, data, error } exactly like the
 * explorer readers: an outage, a rate limit or an HTML error page is reported
 * as a failure, never as an empty market or a zero price. A mint Jupiter does
 * not price is simply absent from a price map — callers show it as unpriced.
 *
 * Response fields used here were checked against the live APIs:
 *   price v3     /price/v3?ids=<≤50 mints>  → { [mint]: { usdPrice, liquidity, priceChange24h, decimals } }
 *   tokens v2    /tokens/v2/search?query=<≤100 mints> → [{ id, name, symbol, holderCount, stats24h, … }]
 *                /tokens/v2/toptraded/24h?limit=<≤100>
 *   swap v1      /swap/v1/quote, POST /swap/v1/swap-instructions
 *   dexscreener  /token-pairs/v1/solana/<mint> (≤30 pairs, unsorted), /latest/dex/pairs/solana/<pair>
 */

const HTTP_TIMEOUT_MS = 10_000;
/** Price v3 takes at most 50 ids per request. */
const PRICE_BATCH = 50;
/** Token search answers at most 100 mints per query; extra ids are silently dropped. */
const SEARCH_BATCH = 100;
const DEXSCREENER_URL = "https://api.dexscreener.com";

export function jupiterConfig(): { baseUrl: string; apiKey?: string } {
  const env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env;
  const baseUrl = (env.JUPITER_API_URL || "https://lite-api.jup.ag").replace(/\/+$/, "");
  const apiKey = env.JUPITER_API_KEY || undefined;
  return apiKey ? { baseUrl, apiKey } : { baseUrl };
}

function jupiterHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const { apiKey } = jupiterConfig();
  return { Accept: "application/json", ...(apiKey ? { "x-api-key": apiKey } : {}), ...extra };
}

/**
 * One HTTP read, one shape of failure. Never throws.
 *
 * A non-2xx answer is a failure even when it carries JSON, and the service's
 * own error text (Jupiter: `{ error }`) is kept because "token is not
 * tradable" is far more useful to a finch than a bare status code.
 */
export async function fetchJson<T>(url: string, source: string, init: RequestInit = {}): Promise<ExplorerResult<T>> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("json")) {
      const reason = type.includes("html") ? "returned an HTML page instead of JSON" : `returned ${type || "no content type"} instead of JSON`;
      return { reachable: false, data: null, error: `${source} HTTP ${response.status}: ${reason}`, source };
    }
    const body = (await response.json()) as unknown;
    if (!response.ok) {
      const detail = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : "";
      return { reachable: false, data: null, error: `${source} HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`, source };
    }
    return { reachable: true, data: body as T, source };
  } catch (error) {
    const message = error instanceof Error ? (error.name === "TimeoutError" ? `timed out after ${HTTP_TIMEOUT_MS / 1000}s` : error.message) : "request failed";
    return { reachable: false, data: null, error: `${source}: ${message.slice(0, 200)}`, source };
  }
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function uniqueMints(mints: string[]): string[] {
  // Case-sensitive on purpose: base58 strings differing in case are different mints.
  return [...new Set(mints.filter((mint) => isSolanaAddress(mint)))];
}

// ── Prices ─────────────────────────────────────────────────────────────────

export interface TokenPrice {
  usdPrice: number;
  liquidityUsd: number | null;
  priceChange24h: number | null;
  decimals: number | null;
}

interface RawPrice {
  usdPrice?: number;
  liquidity?: number;
  priceChange24h?: number | null;
  decimals?: number;
}

/**
 * USD prices from Jupiter price v3, keyed by mint.
 *
 * A mint Jupiter cannot price is absent from the map — not 0. If any batch
 * fails the whole read fails: a half-priced portfolio presented as complete
 * would undervalue silently.
 */
export async function readTokenPrices(mints: string[]): Promise<ExplorerResult<Record<string, TokenPrice>>> {
  const source = "jupiter";
  const ids = uniqueMints(mints);
  if (ids.length === 0) return { reachable: true, data: {}, source };
  const { baseUrl } = jupiterConfig();
  const pages = await Promise.all(
    chunk(ids, PRICE_BATCH).map((batch) =>
      fetchJson<Record<string, RawPrice>>(`${baseUrl}/price/v3?ids=${batch.join(",")}`, source, { headers: jupiterHeaders() }),
    ),
  );
  const failed = pages.find((page) => !page.reachable || !page.data || typeof page.data !== "object");
  if (failed) return { reachable: false, data: null, error: failed.error ?? "jupiter price response was not an object", source };

  const prices: Record<string, TokenPrice> = {};
  for (const page of pages) {
    for (const [mint, raw] of Object.entries(page.data ?? {})) {
      const usdPrice = num(raw?.usdPrice);
      if (usdPrice === null) continue; // listed without a price is still unpriced
      prices[mint] = {
        usdPrice,
        liquidityUsd: num(raw.liquidity),
        priceChange24h: num(raw.priceChange24h),
        decimals: num(raw.decimals),
      };
    }
  }
  return { reachable: true, data: prices, source };
}

// ── Token records ──────────────────────────────────────────────────────────

export interface JupiterToken {
  mint: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  holderCount: number | null;
  usdPrice: number | null;
  mcap: number | null;
  fdv: number | null;
  liquidity: number | null;
  /** Buy plus sell volume over 24h, USD (Jupiter's stats24h). */
  volume24hUsd: number | null;
  isVerified: boolean | null;
  organicScore: number | null;
  tokenProgram: string | null;
}

interface RawJupiterToken {
  id?: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  holderCount?: number;
  usdPrice?: number;
  mcap?: number;
  fdv?: number;
  liquidity?: number;
  stats24h?: { buyVolume?: number; sellVolume?: number };
  isVerified?: boolean;
  organicScore?: number;
  tokenProgram?: string;
}

function volume24h(raw: RawJupiterToken): number | null {
  const buy = num(raw.stats24h?.buyVolume);
  const sell = num(raw.stats24h?.sellVolume);
  return buy === null || sell === null ? null : buy + sell;
}

function toJupiterToken(raw: RawJupiterToken): JupiterToken | null {
  if (!raw || typeof raw.id !== "string") return null;
  return {
    mint: raw.id,
    name: str(raw.name),
    symbol: str(raw.symbol),
    decimals: num(raw.decimals),
    holderCount: num(raw.holderCount),
    usdPrice: num(raw.usdPrice),
    mcap: num(raw.mcap),
    fdv: num(raw.fdv),
    liquidity: num(raw.liquidity),
    volume24hUsd: volume24h(raw),
    // Jupiter only sends the flag when it is true; a record without it is
    // Jupiter saying "not verified", which is a definite false.
    isVerified: raw.isVerified === true,
    organicScore: num(raw.organicScore),
    tokenProgram: str(raw.tokenProgram),
  };
}

/**
 * Jupiter's record for each mint: name, symbol, holders, market cap,
 * liquidity, 24h volume, verification. Mints Jupiter has no record of are
 * absent from the result.
 */
export async function readJupiterTokens(mints: string[]): Promise<ExplorerResult<JupiterToken[]>> {
  const source = "jupiter";
  const ids = uniqueMints(mints);
  if (ids.length === 0) return { reachable: true, data: [], source };
  const { baseUrl } = jupiterConfig();
  const pages = await Promise.all(
    chunk(ids, SEARCH_BATCH).map((batch) =>
      fetchJson<RawJupiterToken[]>(`${baseUrl}/tokens/v2/search?query=${batch.join(",")}`, source, { headers: jupiterHeaders() }),
    ),
  );
  const failed = pages.find((page) => !page.reachable || !Array.isArray(page.data));
  if (failed) return { reachable: false, data: null, error: failed.error ?? "jupiter token search did not return a list", source };

  // Search is fuzzy by design; keep only exact records for the mints asked about.
  const wanted = new Set(ids);
  const seen = new Set<string>();
  const tokens: JupiterToken[] = [];
  for (const page of pages) {
    for (const raw of page.data ?? []) {
      const token = toJupiterToken(raw);
      if (!token || !wanted.has(token.mint) || seen.has(token.mint)) continue;
      seen.add(token.mint);
      tokens.push(token);
    }
  }
  return { reachable: true, data: tokens, source };
}

export interface TokenListing {
  mint: string;
  name: string | null;
  symbol: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  holderCount: number | null;
  verified: boolean;
}

/** Tokens Jupiter ranks by 24h trading, in Jupiter's order. */
export async function readTokenList(limit = 20): Promise<ExplorerResult<TokenListing[]>> {
  const source = "jupiter";
  const size = Math.max(1, Math.min(Math.trunc(limit) || 20, 100));
  const { baseUrl } = jupiterConfig();
  const r = await fetchJson<RawJupiterToken[]>(`${baseUrl}/tokens/v2/toptraded/24h?limit=${size}`, source, { headers: jupiterHeaders() });
  if (!r.reachable || !Array.isArray(r.data)) {
    return { reachable: false, data: null, error: r.error ?? "jupiter token list did not return a list", source };
  }
  const listings: TokenListing[] = [];
  for (const raw of r.data.slice(0, size)) {
    const token = toJupiterToken(raw);
    if (!token) continue;
    listings.push({
      mint: token.mint,
      name: token.name,
      symbol: token.symbol,
      priceUsd: token.usdPrice,
      marketCapUsd: token.mcap,
      liquidityUsd: token.liquidity,
      volume24hUsd: token.volume24hUsd,
      holderCount: token.holderCount,
      verified: token.isVerified === true,
    });
  }
  return { reachable: true, data: listings, source };
}

// ── DEX markets (DexScreener) ──────────────────────────────────────────────

export interface TokenMarket {
  dex: string | null;
  pairAddress: string;
  url: string | null;
  baseToken: { address: string; symbol: string | null };
  quoteToken: { address: string; symbol: string | null };
  /** Price of the base token in the quote token. */
  priceNative: number | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  txns24h: { buys: number | null; sells: number | null };
  fdvUsd: number | null;
  marketCapUsd: number | null;
  /** ISO time the pair was created, when DexScreener knows it. */
  pairCreatedAt: string | null;
}

interface RawPair {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken?: { address?: string; symbol?: string };
  quoteToken?: { address?: string; symbol?: string };
  priceNative?: string;
  priceUsd?: string;
  txns?: { h24?: { buys?: number; sells?: number } };
  volume?: { h24?: number };
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
}

function toTokenMarket(raw: RawPair): TokenMarket | null {
  if (!raw || typeof raw.pairAddress !== "string") return null;
  const created = num(raw.pairCreatedAt);
  return {
    dex: str(raw.dexId),
    pairAddress: raw.pairAddress,
    url: str(raw.url),
    baseToken: { address: raw.baseToken?.address ?? "", symbol: str(raw.baseToken?.symbol) },
    quoteToken: { address: raw.quoteToken?.address ?? "", symbol: str(raw.quoteToken?.symbol) },
    priceNative: num(raw.priceNative),
    priceUsd: num(raw.priceUsd),
    liquidityUsd: num(raw.liquidity?.usd),
    volume24hUsd: num(raw.volume?.h24),
    txns24h: { buys: num(raw.txns?.h24?.buys), sells: num(raw.txns?.h24?.sells) },
    fdvUsd: num(raw.fdv),
    marketCapUsd: num(raw.marketCap),
    pairCreatedAt: created !== null ? new Date(created).toISOString() : null,
  };
}

/**
 * The DEX pools a mint trades in, deepest first. DexScreener returns them
 * unsorted; pools with unknown liquidity sort last rather than as zero.
 */
export async function readTokenMarkets(mint: string, limit = 10): Promise<ExplorerResult<TokenMarket[]>> {
  const source = "dexscreener";
  if (!isSolanaAddress(mint)) return { reachable: false, data: null, error: `not a Solana mint address: ${String(mint).slice(0, 60)}`, source };
  const size = Math.max(1, Math.min(Math.trunc(limit) || 10, 30));
  const r = await fetchJson<RawPair[]>(`${DEXSCREENER_URL}/token-pairs/v1/solana/${mint}`, source);
  if (!r.reachable || !Array.isArray(r.data)) {
    return { reachable: false, data: null, error: r.error ?? "dexscreener did not return a list of pairs", source };
  }
  const markets = r.data
    .filter((pair) => !pair.chainId || pair.chainId === "solana")
    .map(toTokenMarket)
    .filter((market): market is TokenMarket => market !== null)
    .sort((a, b) => (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1))
    .slice(0, size);
  return { reachable: true, data: markets, source };
}

/** One DEX pair or pool by its address. */
export async function readMarketPair(pairAddress: string): Promise<ExplorerResult<TokenMarket>> {
  const source = "dexscreener";
  if (!isSolanaAddress(pairAddress)) {
    return { reachable: false, data: null, error: `not a Solana address: ${String(pairAddress).slice(0, 60)}`, source };
  }
  const r = await fetchJson<{ pair?: RawPair | null; pairs?: RawPair[] | null }>(
    `${DEXSCREENER_URL}/latest/dex/pairs/solana/${pairAddress}`,
    source,
  );
  if (!r.reachable || !r.data) return { reachable: false, data: null, error: r.error ?? "dexscreener returned no body", source };
  const raw = r.data.pair ?? r.data.pairs?.[0] ?? null;
  const market = raw ? toTokenMarket(raw) : null;
  // DexScreener answers an unknown pair with { pair: null } — a definite answer, not an outage.
  if (!market) return { reachable: true, data: null, error: "DexScreener has no pair at this address", source };
  return { reachable: true, data: market, source };
}

// ── Swaps (Jupiter) ────────────────────────────────────────────────────────

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  /** Smallest units of the input mint, decimal string. */
  inAmount: string;
  /** Expected output, smallest units of the output mint. */
  outAmount: string;
  /** Minimum output after slippage — what the swap instruction enforces. */
  otherAmountThreshold: string;
  slippageBps: number;
  /**
   * Price impact in percent (1.5 = 1.5%). Jupiter's field of the same name
   * is a fraction despite its name (a 20M JUP quote returned 0.995 while
   * losing ~99.5% of its value), so it is scaled here.
   */
  priceImpactPct: number | null;
  route: Array<{ label: string | null; inputMint: string; outputMint: string; percent: number | null }>;
  contextSlot: string | null;
  /** Jupiter's quote exactly as returned — the only valid input to fetchSwapInstructions. */
  raw: unknown;
}

interface RawQuote {
  inputMint?: string;
  outputMint?: string;
  inAmount?: string;
  outAmount?: string;
  otherAmountThreshold?: string;
  slippageBps?: number;
  priceImpactPct?: string;
  routePlan?: Array<{
    percent?: number | null;
    bps?: number | null;
    swapInfo?: { label?: string; inputMint?: string; outputMint?: string };
  }>;
  contextSlot?: number;
}

/** A read-only route quote. Nothing is signed or sent. */
export async function readSwapQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps: number;
}): Promise<ExplorerResult<SwapQuote>> {
  const source = "jupiter";
  const { inputMint, outputMint, amount, slippageBps } = params;
  if (!isSolanaAddress(inputMint) || !isSolanaAddress(outputMint)) {
    return { reachable: false, data: null, error: "inputMint and outputMint must be Solana mint addresses", source };
  }
  if (typeof amount !== "bigint" || amount <= 0n) {
    return { reachable: false, data: null, error: "amount must be a positive integer in the input mint's smallest unit", source };
  }
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    return { reachable: false, data: null, error: "slippageBps must be an integer between 0 and 10000", source };
  }
  const { baseUrl } = jupiterConfig();
  const query = new URLSearchParams({ inputMint, outputMint, amount: amount.toString(), slippageBps: String(slippageBps) });
  const r = await fetchJson<RawQuote>(`${baseUrl}/swap/v1/quote?${query.toString()}`, source, { headers: jupiterHeaders() });
  if (!r.reachable || !r.data) return { reachable: false, data: null, error: r.error ?? "jupiter returned no quote", source };
  const q = r.data;
  if (typeof q.outAmount !== "string" || typeof q.inAmount !== "string" || typeof q.otherAmountThreshold !== "string") {
    return { reachable: false, data: null, error: "jupiter quote is missing amounts", source };
  }
  const impact = num(q.priceImpactPct);
  return {
    reachable: true,
    source,
    data: {
      inputMint: q.inputMint ?? inputMint,
      outputMint: q.outputMint ?? outputMint,
      inAmount: q.inAmount,
      outAmount: q.outAmount,
      otherAmountThreshold: q.otherAmountThreshold,
      slippageBps: num(q.slippageBps) ?? slippageBps,
      priceImpactPct: impact === null ? null : impact * 100,
      route: (q.routePlan ?? []).map((leg) => ({
        label: str(leg.swapInfo?.label),
        inputMint: leg.swapInfo?.inputMint ?? "",
        outputMint: leg.swapInfo?.outputMint ?? "",
        percent: num(leg.percent) ?? (num(leg.bps) !== null ? num(leg.bps)! / 100 : null),
      })),
      contextSlot: num(q.contextSlot) !== null ? String(q.contextSlot) : null,
      raw: q,
    },
  };
}

interface RawInstruction {
  programId?: string;
  accounts?: Array<{ pubkey?: string; isSigner?: boolean; isWritable?: boolean }>;
  data?: string;
}

interface RawSwapInstructions {
  error?: string;
  tokenLedgerInstruction?: RawInstruction | null;
  computeBudgetInstructions?: RawInstruction[];
  setupInstructions?: RawInstruction[];
  swapInstruction?: RawInstruction;
  cleanupInstruction?: RawInstruction | null;
  otherInstructions?: RawInstruction[];
  addressLookupTableAddresses?: string[];
  computeUnitLimit?: number;
  prioritizationFeeLamports?: number;
  simulationError?: { error?: string; errorCode?: string } | null;
}

function roleOf(isSigner: boolean, isWritable: boolean): AccountRoleName {
  if (isSigner) return isWritable ? "writable_signer" : "readonly_signer";
  return isWritable ? "writable" : "readonly";
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function toSerialized(raw: RawInstruction | null | undefined, label: string): SerializedInstruction {
  if (!raw || !isSolanaAddress(raw.programId)) throw new Error(`jupiter ${label} instruction has no valid program id`);
  if (typeof raw.data !== "string" || !BASE64.test(raw.data)) throw new Error(`jupiter ${label} instruction data is not base64`);
  return {
    programAddress: raw.programId,
    accounts: (raw.accounts ?? []).map((meta, index) => {
      if (!isSolanaAddress(meta.pubkey)) throw new Error(`jupiter ${label} instruction account ${index} is not a valid address`);
      return { address: meta.pubkey, role: roleOf(meta.isSigner === true, meta.isWritable === true) };
    }),
    data: raw.data,
  };
}

export interface SwapInstructions {
  /** In execution order: compute budget, setup, swap, cleanup, other (e.g. a tip). */
  instructions: SerializedInstruction[];
  addressLookupTables: string[];
  /** Compute unit limit Jupiter set in its compute-budget instruction. */
  computeUnitLimit: number | null;
  /** Priority fee Jupiter's compute-budget instructions commit the payer to, lamports. */
  prioritizationFeeLamports: number | null;
  /** Jupiter's own pre-flight simulation error, when it ran one and it failed. */
  simulationError: string | null;
}

/**
 * The instructions for a quoted swap, for `userPublicKey` to sign.
 *
 * THROWS on any failure: this feeds a write path, and a partial or malformed
 * instruction set must stop it rather than be simulated as if complete.
 *
 * Order follows Jupiter's assembly guide: computeBudgetInstructions, then
 * setupInstructions (ATA creation, SOL wrap), the swap, the cleanup (SOL
 * unwrap), and otherInstructions last (Jupiter's swap v2 build guide appends
 * them after cleanup; v1 uses them only for a Jito tip).
 */
export async function fetchSwapInstructions(rawQuote: unknown, userPublicKey: string): Promise<SwapInstructions> {
  if (!rawQuote || typeof rawQuote !== "object") throw new Error("a Jupiter quote object is required");
  if (!isSolanaAddress(userPublicKey)) throw new Error("userPublicKey must be a Solana address");
  const { baseUrl } = jupiterConfig();
  const r = await fetchJson<RawSwapInstructions>(`${baseUrl}/swap/v1/swap-instructions`, "jupiter", {
    method: "POST",
    headers: jupiterHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ quoteResponse: rawQuote, userPublicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
  });
  if (!r.reachable || !r.data) throw new Error(r.error ?? "jupiter returned no swap instructions");
  const body = r.data;
  if (body.error) throw new Error(`jupiter: ${String(body.error).slice(0, 200)}`);
  // Never requested (useTokenLedger is off); its presence means the response
  // is not for the request we made.
  if (body.tokenLedgerInstruction) throw new Error("jupiter returned a token ledger instruction that was not requested");
  if (!body.swapInstruction) throw new Error("jupiter response has no swap instruction");

  const instructions: SerializedInstruction[] = [
    ...(body.computeBudgetInstructions ?? []).map((ix) => toSerialized(ix, "compute budget")),
    ...(body.setupInstructions ?? []).map((ix) => toSerialized(ix, "setup")),
    toSerialized(body.swapInstruction, "swap"),
    ...(body.cleanupInstruction ? [toSerialized(body.cleanupInstruction, "cleanup")] : []),
    ...(body.otherInstructions ?? []).map((ix) => toSerialized(ix, "other")),
  ];
  const tables = body.addressLookupTableAddresses ?? [];
  for (const table of tables) {
    if (!isSolanaAddress(table)) throw new Error(`jupiter returned an invalid address lookup table ${String(table).slice(0, 60)}`);
  }
  const simulation = body.simulationError;
  return {
    instructions,
    addressLookupTables: tables,
    computeUnitLimit: num(body.computeUnitLimit),
    prioritizationFeeLamports: num(body.prioritizationFeeLamports),
    simulationError: simulation ? String(simulation.error ?? simulation.errorCode ?? "simulation failed").slice(0, 200) : null,
  };
}
