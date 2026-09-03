import { getFlightpathTarget, type FlightpathTarget } from "./chain.ts";
import { readPoolState, type PoolState } from "./pool.ts";

/**
 * Blockscout explorer reads for Robinhood Chain.
 *
 * The RPC tells a finch what the chain IS right now — head block, a balance,
 * a contract's storage. It cannot tell a finch what HAPPENED: who holds a
 * token, what an address has done, how much volume moved. That is indexed
 * data, and the chain's Blockscout instance already has it.
 *
 * Two facts about that instance shape this file:
 *
 *  1. The documented explorer host (explorer.mainnet.chain.robinhood.com)
 *     301-redirects every API path to the bare root of a different host,
 *     dropping the path. The API only answers on robinhoodchain.blockscout.com.
 *  2. That host sits behind a Cloudflare bot challenge. A default fetch UA gets
 *     a 403 HTML page; a browser UA with Accept: application/json gets JSON.
 *     Verified empirically against every endpoint used here.
 *
 * Every reader returns { reachable, error } alongside its data. A finch that
 * cannot read the explorer must say so — inventing holders or volume is
 * exactly the failure the grounding rules exist to prevent.
 */

export const DEFAULT_EXPLORER_API_URL = "https://robinhoodchain.blockscout.com";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export interface ExplorerResult<T> {
  reachable: boolean;
  data: T | null;
  error?: string;
  source: string;
}

function apiBase(target: FlightpathTarget): string {
  return (target.explorerApiUrl ?? DEFAULT_EXPLORER_API_URL).replace(/\/$/, "");
}

/** One fetch, one shape of failure. Never throws into a tool result. */
async function explorerGet<T>(path: string, target: FlightpathTarget): Promise<ExplorerResult<T>> {
  const url = `${apiBase(target)}/api/v2/${path.replace(/^\//, "")}`;
  const source = "blockscout";
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.includes("json")) {
      // A Cloudflare challenge page is text/html with status 403. Report it as
      // what it is rather than letting the caller mistake it for "no data".
      const reason = type.includes("html") ? "explorer returned a challenge/HTML page instead of JSON" : `explorer HTTP ${response.status}`;
      return { reachable: false, data: null, error: reason, source };
    }
    return { reachable: true, data: (await response.json()) as T, source };
  } catch (error) {
    return {
      reachable: false,
      data: null,
      error: error instanceof Error ? error.message.slice(0, 160) : "explorer read failed",
      source,
    };
  }
}

// ── Raw Blockscout shapes (only the fields we surface) ─────────────────────

interface RawStats {
  total_blocks?: string;
  total_transactions?: string;
  total_addresses?: string;
  transactions_today?: string;
  average_block_time?: number;
  gas_prices?: { slow?: number; average?: number; fast?: number };
  coin_price?: string;
  market_cap?: string;
}

interface RawAddress {
  hash: string;
  coin_balance?: string | null;
  is_contract?: boolean;
  is_verified?: boolean;
  is_scam?: boolean;
  name?: string | null;
  creator_address_hash?: string | null;
  creation_transaction_hash?: string | null;
  has_tokens?: boolean;
  has_token_transfers?: boolean;
}

interface RawCounters {
  transactions_count?: string;
  token_transfers_count?: string;
  gas_usage_count?: string;
}

interface RawTx {
  hash: string;
  block_number?: number;
  status?: string;
  method?: string | null;
  value?: string;
  fee?: { value?: string };
  from?: { hash?: string };
  to?: { hash?: string } | null;
  created_contract?: { hash?: string } | null;
  timestamp?: string;
  confirmations?: number;
}

interface RawToken {
  address_hash?: string;
  address?: string;
  name?: string | null;
  symbol?: string | null;
  decimals?: string | null;
  type?: string;
  holders_count?: string | null;
  total_supply?: string | null;
  exchange_rate?: string | null;
  circulating_market_cap?: string | null;
  volume_24h?: string | null;
}

interface RawHolder {
  address: { hash: string; is_contract?: boolean; name?: string | null };
  value: string;
}

interface RawTransfer {
  from?: { hash?: string };
  to?: { hash?: string };
  total?: { value?: string; decimals?: string };
  block_number?: number;
  timestamp?: string;
  transaction_hash?: string;
}

interface RawTokenBalance {
  token: RawToken;
  value: string;
}

interface RawContract {
  is_verified?: boolean | null;
  name?: string | null;
  compiler_version?: string | null;
  language?: string | null;
}

interface Paged<T> {
  items: T[];
  next_page_params?: unknown;
}

// ── Formatting helpers ─────────────────────────────────────────────────────

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Scale a base-unit string by decimals into a human decimal string, losslessly for the integer part. */
function scale(raw: string | undefined, decimals: number): string | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const big = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = big / base;
  const frac = (big % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac.length > 0 ? `${whole}.${frac.slice(0, 6)}` : whole.toString();
}

function short(hash: string | undefined | null): string | null {
  return hash ? hash : null;
}

// ── Public readers ─────────────────────────────────────────────────────────

export interface ChainStats {
  totalBlocks: number | null;
  totalTransactions: number | null;
  totalAddresses: number | null;
  transactionsToday: number | null;
  averageBlockTimeMs: number | null;
  gasPricesGwei: { slow: number | null; average: number | null; fast: number | null };
  ethPriceUsd: number | null;
}

/** Whole-chain counters: what the network has done in total and today. */
export async function readChainStats(target = getFlightpathTarget()): Promise<ExplorerResult<ChainStats>> {
  const r = await explorerGet<RawStats>("stats", target);
  if (!r.data) return { ...r, data: null };
  const s = r.data;
  return {
    ...r,
    data: {
      totalBlocks: toNumber(s.total_blocks),
      totalTransactions: toNumber(s.total_transactions),
      totalAddresses: toNumber(s.total_addresses),
      transactionsToday: toNumber(s.transactions_today),
      averageBlockTimeMs: toNumber(s.average_block_time),
      gasPricesGwei: {
        slow: toNumber(s.gas_prices?.slow),
        average: toNumber(s.gas_prices?.average),
        fast: toNumber(s.gas_prices?.fast),
      },
      ethPriceUsd: toNumber(s.coin_price),
    },
  };
}

export interface WalletProfile {
  address: string;
  nativeBalanceEth: string | null;
  isContract: boolean;
  isVerifiedContract: boolean;
  flaggedScam: boolean;
  label: string | null;
  createdBy: string | null;
  creationTx: string | null;
  transactionCount: number | null;
  tokenTransferCount: number | null;
  holdsTokens: boolean;
}

/** Who an address is: balance, contract-ness, activity counts, explorer label. */
export async function readWalletProfile(
  address: string,
  target = getFlightpathTarget(),
): Promise<ExplorerResult<WalletProfile>> {
  const [summary, counters] = await Promise.all([
    explorerGet<RawAddress>(`addresses/${address}`, target),
    explorerGet<RawCounters>(`addresses/${address}/counters`, target),
  ]);
  if (!summary.data) return { ...summary, data: null };
  const a = summary.data;
  const c = counters.data ?? {};
  return {
    reachable: true,
    source: summary.source,
    // Counters failing is a partial read, which is still worth reporting.
    error: counters.error ? `counters unavailable: ${counters.error}` : undefined,
    data: {
      address: a.hash,
      nativeBalanceEth: scale(a.coin_balance ?? undefined, 18),
      isContract: Boolean(a.is_contract),
      isVerifiedContract: Boolean(a.is_verified),
      flaggedScam: Boolean(a.is_scam),
      label: a.name ?? null,
      createdBy: short(a.creator_address_hash),
      creationTx: short(a.creation_transaction_hash),
      transactionCount: toNumber(c.transactions_count),
      tokenTransferCount: toNumber(c.token_transfers_count),
      holdsTokens: Boolean(a.has_tokens),
    },
  };
}

export interface WalletTransaction {
  hash: string;
  block: number | null;
  at: string | null;
  status: string | null;
  method: string | null;
  from: string | null;
  to: string | null;
  createdContract: string | null;
  valueEth: string | null;
  feeEth: string | null;
}

/** Most recent transactions for an address — first page, newest first. */
export async function readWalletTransactions(
  address: string,
  limit = 10,
  target = getFlightpathTarget(),
): Promise<ExplorerResult<WalletTransaction[]>> {
  const r = await explorerGet<Paged<RawTx>>(`addresses/${address}/transactions`, target);
  if (!r.data) return { ...r, data: null };
  const items = (r.data.items ?? []).slice(0, Math.max(1, Math.min(limit, 50)));
  return {
    ...r,
    data: items.map((t) => ({
      hash: t.hash,
      block: t.block_number ?? null,
      at: t.timestamp ?? null,
      status: t.status ?? null,
      method: t.method ?? null,
      from: short(t.from?.hash),
      to: short(t.to?.hash),
      createdContract: short(t.created_contract?.hash),
      valueEth: scale(t.value, 18),
      feeEth: scale(t.fee?.value, 18),
    })),
  };
}

export interface TokenHolding {
  token: string;
  symbol: string | null;
  name: string | null;
  balance: string | null;
  priceUsd: number | null;
  valueUsd: number | null;
}

/** Every ERC-20 an address holds, as the explorer indexes it. */
export async function readWalletHoldings(
  address: string,
  target = getFlightpathTarget(),
): Promise<ExplorerResult<TokenHolding[]>> {
  const r = await explorerGet<RawTokenBalance[]>(`addresses/${address}/token-balances`, target);
  if (!r.data) return { ...r, data: null };
  const rows = Array.isArray(r.data) ? r.data : [];
  return {
    ...r,
    data: rows
      .filter((b) => b.token && (b.token.type ?? "ERC-20") === "ERC-20")
      .map((b) => {
        const decimals = toNumber(b.token.decimals) ?? 18;
        const balance = scale(b.value, decimals);
        const price = toNumber(b.token.exchange_rate);
        const value = balance !== null && price !== null ? Number(balance) * price : null;
        return {
          token: b.token.address_hash ?? b.token.address ?? "",
          symbol: b.token.symbol ?? null,
          name: b.token.name ?? null,
          balance,
          priceUsd: price,
          valueUsd: value !== null && Number.isFinite(value) ? Number(value.toFixed(2)) : null,
        };
      }),
  };
}

export interface TokenProfile {
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  type: string | null;
  holders: number | null;
  totalSupply: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
}

/** A token as the explorer sees it: holders, supply, price, market cap, 24h volume. */
export async function readTokenProfile(
  address: string,
  target = getFlightpathTarget(),
): Promise<ExplorerResult<TokenProfile>> {
  const r = await explorerGet<RawToken>(`tokens/${address}`, target);
  if (!r.data) return { ...r, data: null };
  const t = r.data;
  const decimals = toNumber(t.decimals);
  return {
    ...r,
    data: {
      address: t.address_hash ?? t.address ?? address,
      name: t.name ?? null,
      symbol: t.symbol ?? null,
      decimals,
      type: t.type ?? null,
      holders: toNumber(t.holders_count),
      totalSupply: scale(t.total_supply ?? undefined, decimals ?? 18),
      priceUsd: toNumber(t.exchange_rate),
      marketCapUsd: toNumber(t.circulating_market_cap),
      volume24hUsd: toNumber(t.volume_24h),
    },
  };
}

export interface TokenHolder {
  address: string;
  isContract: boolean;
  label: string | null;
  balance: string | null;
  /** Share of total supply, in percent, when supply is known. */
  supplyPct: number | null;
}

/** Largest holders — first page (up to 50), largest first. */
export async function readTokenHolders(
  address: string,
  limit = 10,
  target = getFlightpathTarget(),
): Promise<ExplorerResult<{ holders: TokenHolder[]; totalHolders: number | null }>> {
  const [page, profile] = await Promise.all([
    explorerGet<Paged<RawHolder>>(`tokens/${address}/holders`, target),
    explorerGet<RawToken>(`tokens/${address}`, target),
  ]);
  if (!page.data) return { ...page, data: null };
  const decimals = toNumber(profile.data?.decimals) ?? 18;
  const supply = profile.data?.total_supply && /^\d+$/.test(profile.data.total_supply) ? BigInt(profile.data.total_supply) : null;
  const holders = (page.data.items ?? []).slice(0, Math.max(1, Math.min(limit, 50))).map((h) => {
    const raw = /^\d+$/.test(h.value) ? BigInt(h.value) : null;
    const pct = supply && raw !== null && supply > 0n ? Number((raw * 1_000_000n) / supply) / 10_000 : null;
    return {
      address: h.address.hash,
      isContract: Boolean(h.address.is_contract),
      label: h.address.name ?? null,
      balance: scale(h.value, decimals),
      supplyPct: pct,
    };
  });
  return { ...page, data: { holders, totalHolders: toNumber(profile.data?.holders_count) } };
}

export interface TokenTransfer {
  tx: string | null;
  block: number | null;
  at: string | null;
  from: string | null;
  to: string | null;
  amount: string | null;
}

/** Most recent transfers of a token — first page, newest first. */
export async function readTokenTransfers(
  address: string,
  limit = 10,
  target = getFlightpathTarget(),
): Promise<ExplorerResult<TokenTransfer[]>> {
  const r = await explorerGet<Paged<RawTransfer>>(`tokens/${address}/transfers`, target);
  if (!r.data) return { ...r, data: null };
  return {
    ...r,
    data: (r.data.items ?? []).slice(0, Math.max(1, Math.min(limit, 50))).map((t) => ({
      tx: short(t.transaction_hash),
      block: t.block_number ?? null,
      at: t.timestamp ?? null,
      from: short(t.from?.hash),
      to: short(t.to?.hash),
      amount: scale(t.total?.value, toNumber(t.total?.decimals) ?? 18),
    })),
  };
}

export interface TokenListing {
  address: string;
  name: string | null;
  symbol: string | null;
  holders: number | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
}

/** ERC-20s the explorer ranks on this chain — first page. */
export async function readTokenList(
  limit = 20,
  target = getFlightpathTarget(),
): Promise<ExplorerResult<TokenListing[]>> {
  const r = await explorerGet<Paged<RawToken>>("tokens?type=ERC-20", target);
  if (!r.data) return { ...r, data: null };
  return {
    ...r,
    data: (r.data.items ?? []).slice(0, Math.max(1, Math.min(limit, 50))).map((t) => ({
      address: t.address_hash ?? t.address ?? "",
      name: t.name ?? null,
      symbol: t.symbol ?? null,
      holders: toNumber(t.holders_count),
      priceUsd: toNumber(t.exchange_rate),
      marketCapUsd: toNumber(t.circulating_market_cap),
      volume24hUsd: toNumber(t.volume_24h),
    })),
  };
}

export interface TxDetail {
  hash: string;
  status: string | null;
  block: number | null;
  at: string | null;
  confirmations: number | null;
  method: string | null;
  from: string | null;
  to: string | null;
  createdContract: string | null;
  valueEth: string | null;
  feeEth: string | null;
}

/** One transaction by hash. */
export async function readTransaction(hash: string, target = getFlightpathTarget()): Promise<ExplorerResult<TxDetail>> {
  const r = await explorerGet<RawTx>(`transactions/${hash}`, target);
  if (!r.data) return { ...r, data: null };
  const t = r.data;
  return {
    ...r,
    data: {
      hash: t.hash,
      status: t.status ?? null,
      block: t.block_number ?? null,
      at: t.timestamp ?? null,
      confirmations: t.confirmations ?? null,
      method: t.method ?? null,
      from: short(t.from?.hash),
      to: short(t.to?.hash),
      createdContract: short(t.created_contract?.hash),
      valueEth: scale(t.value, 18),
      feeEth: scale(t.fee?.value, 18),
    },
  };
}

export interface ContractVerification {
  address: string;
  verified: boolean;
  name: string | null;
  compiler: string | null;
  language: string | null;
}

/** Whether a contract's source is published and verified on the explorer. */
export async function readContractVerification(
  address: string,
  target = getFlightpathTarget(),
): Promise<ExplorerResult<ContractVerification>> {
  const r = await explorerGet<RawContract>(`smart-contracts/${address}`, target);
  // Blockscout answers 404 for an unverified contract; that is a definite "no",
  // not an outage, so report it as data rather than as unreachable.
  if (!r.reachable && r.error?.includes("404")) {
    return { reachable: true, source: r.source, data: { address, verified: false, name: null, compiler: null, language: null } };
  }
  if (!r.data) return { ...r, data: null };
  return {
    ...r,
    data: {
      address,
      verified: Boolean(r.data.is_verified),
      name: r.data.name ?? null,
      compiler: r.data.compiler_version ?? null,
      language: r.data.language ?? null,
    },
  };
}


// ── Pools ──────────────────────────────────────────────────────────────────

export interface TokenPool {
  pool: string;
  name: string | null;
  /** The pool's share of the token's supply, from the holder list. */
  supplyPct: number | null;
  state: PoolState | null;
  error?: string;
}

/**
 * Where a token's liquidity actually is, found rather than declared.
 *
 * A token's largest holders that are contracts are, very often, its pools.
 * This takes the top holders, keeps the contracts, asks the explorer what each
 * one is, and reads V3 state from any whose verified name says Pool or Pair.
 * One tool call. Previously a finch was asked to do this itself — holders,
 * then a verification per contract, then a pool read — and ran out of tool
 * steps before reaching the answer.
 *
 * Unnamed contracts are reported as unidentified, not guessed at: an
 * unverified contract holding 9M tokens could be a pool, a lock, or a
 * treasury, and nothing here can tell which.
 */
export async function readTokenPools(
  token: string,
  limit = 20,
  target = getFlightpathTarget(),
): Promise<ExplorerResult<{ pools: TokenPool[]; unidentifiedContracts: Array<{ address: string; supplyPct: number | null }>; contractsChecked: number }>> {
  const holders = await readTokenHolders(token, limit, target);
  if (!holders.data) return { ...holders, data: null };
  const contracts = holders.data.holders.filter((h) => h.isContract);
  const verified = await Promise.all(contracts.map((h) => readContractVerification(h.address, target)));

  const pools: TokenPool[] = [];
  const unidentified: Array<{ address: string; supplyPct: number | null }> = [];
  await Promise.all(
    contracts.map(async (holder, index) => {
      const name = verified[index]?.data?.name ?? holder.label ?? null;
      if (name && /pool|pair/i.test(name)) {
        const state = await readPoolState(holder.address, target);
        pools.push({ pool: holder.address, name, supplyPct: holder.supplyPct, state: state.data, error: state.error });
      } else {
        unidentified.push({ address: holder.address, supplyPct: holder.supplyPct });
      }
    }),
  );
  pools.sort((a, b) => (b.supplyPct ?? 0) - (a.supplyPct ?? 0));
  return { reachable: true, source: holders.source, data: { pools, unidentifiedContracts: unidentified, contractsChecked: contracts.length } };
}
