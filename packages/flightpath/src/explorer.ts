import {
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  isOffCurveAddress,
  type Address,
  type Signature,
} from "@solana/kit";
import { explorerTxUrl, getFlightpathTarget, type FlightpathTarget } from "./chain.ts";
import { base64ToBytes, formatSol, formatUnits, isSolanaAddress, isSolanaSignature, WSOL_MINT } from "./codec.ts";
import { fetchJson, readJupiterTokens, readTokenPrices, type JupiterToken } from "./market.ts";
import { scrubEndpoints } from "./network.ts";

/**
 * Explorer reads for Solana, straight from the RPC.
 *
 * The RPC answers what an account IS right now and what a given transaction
 * DID. It does not index history the way an explorer database does: there is
 * no lifetime transaction count per address, no holder count per mint, and
 * token transfers are only findable through the accounts they touched. Where
 * a figure needs an index, it comes from Jupiter (holders, prices, volume) or
 * is reported as unavailable — never estimated.
 *
 * Every reader returns { reachable, data, error?, source } and never throws
 * into a tool result. A failed read is `reachable: false` with the reason; it
 * is never presented as an empty list or a zero balance. A definite negative
 * answer from a working RPC ("no such transaction") is `reachable: true` with
 * `data: null` and the answer in `error`.
 *
 * Reads are sized for the public mainnet RPC, which rate limits hard: batch
 * account reads, sliced account data where only a header is needed, and a
 * cap on per-row transaction fetches.
 */

export interface ExplorerResult<T> {
  reachable: boolean;
  data: T | null;
  error?: string;
  source: string;
}

const RPC_SOURCE = "solana-rpc";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TOKEN_PROGRAMS = [TOKEN_PROGRAM, TOKEN_2022_PROGRAM] as const;
const METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const LOADER_V4 = "LoaderV411111111111111111111111111111111111";
const NATIVE_LOADER = "NativeLoader1111111111111111111111111111111";

/** Loader programs by owner address; the name is what jsonParsed calls them. */
const LOADERS: Record<string, string> = {
  [UPGRADEABLE_LOADER]: "bpf-upgradeable-loader",
  BPFLoader2111111111111111111111111111111111: "bpf-loader",
  BPFLoader1111111111111111111111111111111111: "bpf-loader-deprecated",
  [LOADER_V4]: "loader-v4",
  [NATIVE_LOADER]: "native",
};

const ACTIVITY_NOTE =
  "Solana RPC keeps no lifetime transaction count per address. recentActivity is the newest page of signatures (up to 1000); when windowFull is true the address has more history than that.";

// ── Small helpers ──────────────────────────────────────────────────────────

/** Kit returns u64 fields as bigint; test doubles and some fields come back as number or string. */
function big(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isoTime(blockTime: unknown): string | null {
  const seconds = num(blockTime);
  return seconds === null ? null : new Date(seconds * 1000).toISOString();
}

/**
 * Transaction errors arrive with kit's bigint upcasting applied to every
 * number inside them; print them the way the RPC sent them.
 */
function errorText(err: unknown): string | null {
  if (err === null || err === undefined) return null;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err, (_key, value) =>
      typeof value === "bigint" ? (Number.isSafeInteger(Number(value)) ? Number(value) : value.toString()) : value,
    );
  } catch {
    return "transaction error";
  }
}

/**
 * A readable, credential-free reason for an RPC failure.
 *
 * Kit's production builds reduce messages to "Solana error #8100002; decode…",
 * so the useful part is taken from the error context (the server's own
 * message, or the HTTP status) before falling back to the message.
 */
function rpcError(error: unknown, target: FlightpathTarget): string {
  let message = "rpc read failed";
  if (error instanceof Error) {
    const context = (error as { context?: Record<string, unknown> }).context;
    if (context && typeof context.__serverMessage === "string") message = context.__serverMessage;
    else if (context && typeof context.statusCode === "number") {
      message = `HTTP ${context.statusCode}${typeof context.message === "string" && context.message ? ` ${context.message}` : ""}`;
    } else if (error.name === "TimeoutError" || error.name === "AbortError") message = "request timed out";
    else message = error.message;
  }
  return `rpc: ${scrubEndpoints(message, target.rpcUrls).slice(0, 200)}`;
}

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

async function attempt<T>(target: FlightpathTarget, read: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    return { ok: false, error: rpcError(error, target) };
  }
}

function fail<T>(error: string, source = RPC_SOURCE): ExplorerResult<T> {
  return { reachable: false, data: null, error, source };
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  const n = Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.max(min, Math.min(n, max));
}

/** Run `fn` over `items` with at most `limit` in flight — public RPCs throttle bursts. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Percent of supply with four decimals, from integers so large supplies stay exact. */
function sharePct(raw: bigint, supply: bigint): number | null {
  if (supply <= 0n) return null;
  return Number((raw * 1_000_000n) / supply) / 10_000;
}

function roundUsd(value: number): number {
  return value >= 1 ? Math.round(value * 100) / 100 : Number(value.toPrecision(4));
}

// ── Raw RPC shapes (only the fields read here) ─────────────────────────────

interface RawAccount {
  data: unknown;
  executable: boolean;
  lamports: unknown;
  owner: string;
  space: unknown;
}

interface ParsedData {
  parsed: { type?: string; info?: Record<string, unknown> };
  program?: string;
}

function parsedData(account: RawAccount | null | undefined): ParsedData | null {
  const data = account?.data as ParsedData | undefined;
  return data && typeof data === "object" && !Array.isArray(data) && data.parsed && typeof data.parsed === "object" ? data : null;
}

function base64Data(account: RawAccount | null | undefined): Uint8Array | null {
  const data = account?.data;
  if (Array.isArray(data) && typeof data[0] === "string") return base64ToBytes(data[0]);
  return null;
}

interface RawSignatureInfo {
  signature: string;
  slot: unknown;
  blockTime: unknown;
  err: unknown;
  memo: string | null;
}

interface RawTokenBalance {
  accountIndex: unknown;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: { amount: string; decimals: unknown };
}

interface RawParsedInstruction {
  programId: string;
}

interface RawParsedTransaction {
  slot: unknown;
  blockTime: unknown;
  meta: {
    err: unknown;
    fee: unknown;
    preBalances: unknown[];
    postBalances: unknown[];
    preTokenBalances?: RawTokenBalance[] | null;
    postTokenBalances?: RawTokenBalance[] | null;
    logMessages?: string[] | null;
    computeUnitsConsumed?: unknown;
    innerInstructions?: Array<{ instructions: RawParsedInstruction[] }> | null;
  } | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: Array<{ pubkey: string; signer: boolean; writable: boolean }>;
      instructions: RawParsedInstruction[];
    };
  };
}

/**
 * Transaction versions the reads accept. Mainnet carries v1 transactions now;
 * asking for less makes the RPC refuse those outright.
 */
const MAX_TX_VERSION = 1;

async function fetchParsedTransaction(signature: string, target: FlightpathTarget): Promise<RawParsedTransaction | null> {
  const tx = await target.rpc
    .getTransaction(signature as Signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: MAX_TX_VERSION })
    .send();
  return tx as unknown as RawParsedTransaction | null;
}

/** Every program the transaction ran, outer then inner, first appearance order. */
function programsOf(tx: RawParsedTransaction): string[] {
  const seen = new Set<string>();
  for (const ix of tx.transaction.message.instructions) if (ix.programId) seen.add(ix.programId);
  for (const inner of tx.meta?.innerInstructions ?? []) {
    for (const ix of inner.instructions ?? []) if (ix.programId) seen.add(ix.programId);
  }
  return [...seen];
}

function solDeltaAt(tx: RawParsedTransaction, index: number): bigint | null {
  const pre = big(tx.meta?.preBalances[index]);
  const post = big(tx.meta?.postBalances[index]);
  return pre === null || post === null ? null : post - pre;
}

interface TokenDelta {
  tokenAccount: string;
  owner: string | null;
  mint: string;
  raw: bigint;
  decimals: number;
}

/**
 * Per-token-account balance change, from the transaction's own pre/post
 * token balances. An account missing on one side was created or closed in
 * the transaction, so its balance on that side is zero.
 */
function tokenDeltas(tx: RawParsedTransaction, mint?: string): TokenDelta[] {
  const keys = tx.transaction.message.accountKeys;
  const sides = new Map<number, { pre?: RawTokenBalance; post?: RawTokenBalance }>();
  for (const entry of tx.meta?.preTokenBalances ?? []) {
    const index = num(entry.accountIndex);
    if (index !== null) sides.set(index, { ...sides.get(index), pre: entry });
  }
  for (const entry of tx.meta?.postTokenBalances ?? []) {
    const index = num(entry.accountIndex);
    if (index !== null) sides.set(index, { ...sides.get(index), post: entry });
  }
  const out: TokenDelta[] = [];
  for (const [index, { pre, post }] of [...sides.entries()].sort((a, b) => a[0] - b[0])) {
    const entryMint = post?.mint ?? pre?.mint;
    if (!entryMint || (mint && entryMint !== mint)) continue;
    const before = big(pre?.uiTokenAmount.amount) ?? 0n;
    const after = big(post?.uiTokenAmount.amount) ?? 0n;
    if (after === before) continue;
    out.push({
      tokenAccount: keys[index]?.pubkey ?? `account #${index}`,
      owner: post?.owner ?? pre?.owner ?? null,
      mint: entryMint,
      raw: after - before,
      decimals: num(post?.uiTokenAmount.decimals ?? pre?.uiTokenAmount.decimals) ?? 0,
    });
  }
  return out;
}

// ── Mint accounts ──────────────────────────────────────────────────────────

export interface MintInfo {
  mint: string;
  /** The token program that owns the mint: SPL Token or Token-2022. */
  tokenProgram: string;
  decimals: number;
  /** Raw supply in base units, decimal string. */
  supply: string;
  supplyFormatted: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  name: string | null;
  symbol: string | null;
  uri: string | null;
  /** Where name/symbol came from: the Token-2022 metadata extension, the Metaplex metadata account, or nowhere. */
  metadataSource: "token-2022" | "metaplex" | null;
  /** Set when the metadata account could not be READ (as opposed to not existing). */
  metadataError?: string;
}

export interface MetaplexMetadata {
  updateAuthority: string;
  mint: string;
  name: string;
  symbol: string;
  uri: string;
}

function trimPadding(value: string): string {
  // Metaplex pads fixed-width fields with NULs; some creators pad with spaces.
  return value.replace(/\u0000+$/g, "").trim();
}

/**
 * Decode the head of a Metaplex Token Metadata account (MetadataV1):
 * key u8 (= 4), update authority, mint, then borsh strings name, symbol, uri
 * (u32 little-endian length + UTF-8 bytes). Returns null for anything that
 * is not a well-formed MetadataV1 account.
 */
export function decodeMetaplexMetadata(bytes: Uint8Array): MetaplexMetadata | null {
  const METADATA_V1 = 4;
  if (bytes.length < 1 + 32 + 32 + 12 || bytes[0] !== METADATA_V1) return null;
  const decoder = getAddressDecoder();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = new TextDecoder("utf-8", { fatal: false });
  let offset = 65;
  const strings: string[] = [];
  for (let field = 0; field < 3; field++) {
    if (offset + 4 > bytes.length) return null;
    const length = view.getUint32(offset, true);
    offset += 4;
    if (offset + length > bytes.length) return null;
    strings.push(trimPadding(text.decode(bytes.subarray(offset, offset + length))));
    offset += length;
  }
  return {
    updateAuthority: decoder.decode(bytes.subarray(1, 33)),
    mint: decoder.decode(bytes.subarray(33, 65)),
    name: strings[0]!,
    symbol: strings[1]!,
    uri: strings[2]!,
  };
}

async function metaplexMetadataAddress(mint: string): Promise<Address> {
  const encoder = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: METADATA_PROGRAM as Address,
    seeds: ["metadata", encoder.encode(METADATA_PROGRAM as Address), encoder.encode(mint as Address)],
  });
  return pda;
}

/** The mint account alone, jsonParsed. A non-mint is a definite answer, not an outage. */
async function readMintAccount(mint: string, target: FlightpathTarget): Promise<ExplorerResult<{ program: string; info: Record<string, unknown> }>> {
  const read = await attempt(target, () => target.rpc.getAccountInfo(mint as Address, { encoding: "jsonParsed" }).send());
  if (!read.ok) return fail(read.error);
  const account = read.value.value as unknown as RawAccount | null;
  if (!account) return { reachable: true, data: null, error: `no account exists at ${mint}`, source: RPC_SOURCE };
  const parsed = parsedData(account);
  if (!TOKEN_PROGRAMS.includes(account.owner as (typeof TOKEN_PROGRAMS)[number]) || parsed?.parsed.type !== "mint" || !parsed.parsed.info) {
    return { reachable: true, data: null, error: `${mint} is not an SPL token mint (owner ${account.owner})`, source: RPC_SOURCE };
  }
  return { reachable: true, data: { program: account.owner, info: parsed.parsed.info }, source: RPC_SOURCE };
}

function tokenMetadataExtension(info: Record<string, unknown>): { name: string; symbol: string; uri: string } | null {
  const extensions = Array.isArray(info.extensions) ? (info.extensions as Array<{ extension?: string; state?: Record<string, unknown> }>) : [];
  const entry = extensions.find((ext) => ext.extension === "tokenMetadata");
  if (!entry?.state) return null;
  return {
    name: trimPadding(String(entry.state.name ?? "")),
    symbol: trimPadding(String(entry.state.symbol ?? "")),
    uri: trimPadding(String(entry.state.uri ?? "")),
  };
}

/**
 * A mint read from the chain: decimals, supply, authorities, and the name,
 * symbol and URI its on-chain metadata declares (Token-2022 extension first,
 * Metaplex metadata account second). A mint with neither has null metadata.
 */
export async function readMintInfo(mint: string, target: FlightpathTarget = getFlightpathTarget()): Promise<ExplorerResult<MintInfo>> {
  if (!isSolanaAddress(mint)) return fail(`not a Solana mint address: ${String(mint).slice(0, 60)}`);
  const account = await readMintAccount(mint, target);
  if (!account.data) return { ...account, data: null };
  const { program, info } = account.data;
  const decimals = num(info.decimals) ?? 0;
  const supply = big(info.supply) ?? 0n;

  let name: string | null = null;
  let symbol: string | null = null;
  let uri: string | null = null;
  let metadataSource: MintInfo["metadataSource"] = null;
  let metadataError: string | undefined;

  const extension = tokenMetadataExtension(info);
  if (extension) {
    name = extension.name || null;
    symbol = extension.symbol || null;
    uri = extension.uri || null;
    metadataSource = "token-2022";
  } else {
    const pda = await metaplexMetadataAddress(mint);
    const read = await attempt(target, () => target.rpc.getAccountInfo(pda, { encoding: "base64" }).send());
    if (!read.ok) {
      metadataError = `metadata account unreadable: ${read.error}`;
    } else {
      const raw = read.value.value as unknown as RawAccount | null;
      const bytes = raw && raw.owner === METADATA_PROGRAM ? base64Data(raw) : null;
      const decoded = bytes ? decodeMetaplexMetadata(bytes) : null;
      if (decoded && decoded.mint === mint) {
        name = decoded.name || null;
        symbol = decoded.symbol || null;
        uri = decoded.uri || null;
        metadataSource = "metaplex";
      }
    }
  }

  return {
    reachable: true,
    source: RPC_SOURCE,
    data: {
      mint,
      tokenProgram: program,
      decimals,
      supply: supply.toString(),
      supplyFormatted: formatUnits(supply, decimals),
      mintAuthority: typeof info.mintAuthority === "string" ? info.mintAuthority : null,
      freezeAuthority: typeof info.freezeAuthority === "string" ? info.freezeAuthority : null,
      name,
      symbol,
      uri,
      metadataSource,
      ...(metadataError ? { metadataError } : {}),
    },
  };
}

// ── Whole-network counters ─────────────────────────────────────────────────

export interface ChainStats {
  cluster: string;
  /** Latest confirmed slot, decimal string. */
  slot: string;
  blockHeight: string;
  epoch: number;
  epochProgressPct: number | null;
  /** Transactions processed since genesis, per the node. */
  transactionCount: string | null;
  /** SOL supply, decimal SOL strings. */
  supply: { totalSol: string; circulatingSol: string; nonCirculatingSol: string } | null;
  tps: number | null;
  nonVoteTps: number | null;
  slotTimeMs: number | null;
  /** SOL in USD from Jupiter (wrapped-SOL price); null when Jupiter could not be read. */
  solPriceUsd: number | null;
  /** Which figures could not be read, and why. */
  notes: string[];
  sampledAt: string;
}

/** Whole-network counters: transactions since genesis, SOL supply, epoch, throughput, SOL price. */
export async function readChainStats(target: FlightpathTarget = getFlightpathTarget()): Promise<ExplorerResult<ChainStats>> {
  const source = `${RPC_SOURCE}+jupiter`;
  const { rpc } = target;
  // The epoch read is the reachability probe: if it fails, nothing is claimed.
  const epoch = await attempt(target, () => rpc.getEpochInfo().send());
  if (!epoch.ok) return fail(epoch.error, source);

  const [txCount, supply, samples, price] = await Promise.all([
    attempt(target, () => rpc.getTransactionCount().send()),
    attempt(target, () => rpc.getSupply({ excludeNonCirculatingAccountsList: true }).send()),
    attempt(target, () => rpc.getRecentPerformanceSamples(30).send()),
    readTokenPrices([WSOL_MINT]),
  ]);

  const notes: string[] = [];
  let tps: number | null = null;
  let nonVoteTps: number | null = null;
  let slotTimeMs: number | null = null;
  if (samples.ok && samples.value.length > 0) {
    const list = samples.value as unknown as Array<Record<string, unknown>>;
    const seconds = list.reduce((sum, s) => sum + (num(s.samplePeriodSecs) ?? 0), 0);
    const transactions = list.reduce((sum, s) => sum + (num(s.numTransactions) ?? 0), 0);
    const slots = list.reduce((sum, s) => sum + (num(s.numSlots) ?? 0), 0);
    if (seconds > 0) {
      tps = Math.round(transactions / seconds);
      nonVoteTps = list.every((s) => s.numNonVoteTransactions !== undefined)
        ? Math.round(list.reduce((sum, s) => sum + (num(s.numNonVoteTransactions) ?? 0), 0) / seconds)
        : null;
      slotTimeMs = slots > 0 ? Math.round((seconds * 1000) / slots) : null;
    }
  } else if (!samples.ok) {
    notes.push(`throughput unavailable: ${samples.error}`);
  }
  if (!txCount.ok) notes.push(`transaction count unavailable: ${txCount.error}`);
  if (!supply.ok) notes.push(`supply unavailable: ${supply.error}`);

  let solPriceUsd: number | null = null;
  if (price.data?.[WSOL_MINT]) solPriceUsd = price.data[WSOL_MINT].usdPrice;
  else notes.push(`SOL price unavailable: ${price.error ?? "Jupiter returned no price for wrapped SOL"}`);

  const info = epoch.value as unknown as Record<string, unknown>;
  const slotIndex = num(info.slotIndex);
  const slotsInEpoch = num(info.slotsInEpoch);
  const s = supply.ok ? (supply.value.value as unknown as Record<string, unknown>) : null;
  return {
    reachable: true,
    source,
    data: {
      cluster: target.cluster,
      slot: String(big(info.absoluteSlot) ?? ""),
      blockHeight: String(big(info.blockHeight) ?? ""),
      epoch: num(info.epoch) ?? 0,
      epochProgressPct:
        slotIndex !== null && slotsInEpoch ? Math.round((slotIndex / slotsInEpoch) * 10_000) / 100 : null,
      transactionCount: txCount.ok ? String(txCount.value) : null,
      supply: s
        ? {
            totalSol: formatSol(big(s.total) ?? 0n),
            circulatingSol: formatSol(big(s.circulating) ?? 0n),
            nonCirculatingSol: formatSol(big(s.nonCirculating) ?? 0n),
          }
        : null,
      tps,
      nonVoteTps,
      slotTimeMs,
      solPriceUsd,
      notes,
      sampledAt: new Date().toISOString(),
    },
  };
}

// ── Programs ───────────────────────────────────────────────────────────────

interface ProgramAuthority {
  loader: string | null;
  upgradeable: boolean;
  upgradeAuthority: string | null;
  immutable: boolean;
  lastDeploySlot: string | null;
  note?: string;
}

/**
 * Who can change a program, from its loader's own account layout.
 *
 * `head` is the first 48 bytes of the program account. The upgradeable
 * loader's program account (u32 tag 2, programdata address) points at a
 * ProgramData account whose header is u32 tag 3, u64 deploy slot,
 * Option<Pubkey> upgrade authority. Only that 45-byte header is fetched —
 * reading it jsonParsed would download the whole ELF (megabytes).
 */
async function readProgramAuthority(owner: string, head: Uint8Array | null, target: FlightpathTarget): Promise<Attempt<ProgramAuthority>> {
  const loader = LOADERS[owner] ?? owner;
  const decoder = getAddressDecoder();

  if (owner === UPGRADEABLE_LOADER) {
    if (!head || head.length < 36 || new DataView(head.buffer, head.byteOffset, 4).getUint32(0, true) !== 2) {
      return { ok: false, error: "program account is not in the upgradeable loader's Program layout" };
    }
    const programData = decoder.decode(head.subarray(4, 36));
    const read = await attempt(target, () =>
      target.rpc.getAccountInfo(programData, { encoding: "base64", dataSlice: { offset: 0, length: 45 } }).send(),
    );
    if (!read.ok) return read;
    const bytes = base64Data(read.value.value as unknown as RawAccount | null);
    if (!bytes || bytes.length < 13 || new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) !== 3) {
      return { ok: false, error: "program data account is missing or not in the ProgramData layout" };
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const slot = view.getBigUint64(4, true);
    const authority = bytes[12] === 1 && bytes.length >= 45 ? decoder.decode(bytes.subarray(13, 45)) : null;
    return {
      ok: true,
      value: { loader, upgradeable: authority !== null, upgradeAuthority: authority, immutable: authority === null, lastDeploySlot: slot.toString() },
    };
  }

  if (owner === LOADER_V4) {
    // LoaderV4State: u64 slot, 32-byte authority (or next version once finalized), u64 status (2 = finalized).
    if (!head || head.length < 48) return { ok: false, error: "program account is not in the loader-v4 layout" };
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const finalized = view.getBigUint64(40, true) === 2n;
    return {
      ok: true,
      value: {
        loader,
        upgradeable: !finalized,
        upgradeAuthority: finalized ? null : decoder.decode(head.subarray(8, 40)),
        immutable: finalized,
        lastDeploySlot: view.getBigUint64(0, true).toString(),
      },
    };
  }

  if (owner === NATIVE_LOADER) {
    return {
      ok: true,
      value: {
        loader,
        upgradeable: false,
        upgradeAuthority: null,
        immutable: false,
        lastDeploySlot: null,
        note: "built into the validator: no upgrade authority, but it changes with validator releases and feature activations",
      },
    };
  }

  if (owner in LOADERS) {
    // The original BPF loaders have no upgrade instruction at all.
    return { ok: true, value: { loader, upgradeable: false, upgradeAuthority: null, immutable: true, lastDeploySlot: null } };
  }
  return { ok: false, error: `executable account owned by an unrecognized loader ${owner}` };
}

async function readAccountHead(address: string, target: FlightpathTarget): Promise<Attempt<RawAccount | null>> {
  const read = await attempt(target, () =>
    target.rpc.getAccountInfo(address as Address, { encoding: "base64", dataSlice: { offset: 0, length: 48 } }).send(),
  );
  return read.ok ? { ok: true, value: read.value.value as unknown as RawAccount | null } : read;
}

export interface VerifiedBuild {
  verified: boolean;
  repoUrl: string | null;
  commit: string | null;
  lastVerifiedAt: string | null;
  message: string | null;
}

export interface ProgramVerification {
  program: string;
  exists: boolean;
  executable: boolean;
  loader: string | null;
  upgradeable: boolean;
  upgradeAuthority: string | null;
  immutable: boolean;
  lastDeploySlot: string | null;
  /** OtterSec's verified-build record; null when it could not be read or there is no program. */
  verifiedBuild: VerifiedBuild | null;
  verifiedBuildError?: string;
  note?: string;
}

interface RawOsecStatus {
  is_verified?: boolean;
  message?: string;
  repo_url?: string;
  commit?: string;
  last_verified_at?: string | null;
}

function emptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Whether a program can still be changed (and by whom) and whether its
 * deployed bytecode is a verified build of public source (OtterSec's
 * verify API, which compares a reproducible build against the chain).
 */
export async function readProgramVerification(
  program: string,
  target: FlightpathTarget = getFlightpathTarget(),
): Promise<ExplorerResult<ProgramVerification>> {
  const source = `${RPC_SOURCE}+ottersec`;
  if (!isSolanaAddress(program)) return fail(`not a Solana program address: ${String(program).slice(0, 60)}`, source);

  const [head, osec] = await Promise.all([
    readAccountHead(program, target),
    fetchJson<RawOsecStatus>(`https://verify.osec.io/status/${program}`, "ottersec"),
  ]);
  if (!head.ok) return fail(head.error, source);

  const verifiedBuild: VerifiedBuild | null =
    osec.reachable && osec.data && typeof osec.data.is_verified === "boolean"
      ? {
          verified: osec.data.is_verified,
          repoUrl: emptyString(osec.data.repo_url),
          commit: emptyString(osec.data.commit),
          lastVerifiedAt: emptyString(osec.data.last_verified_at),
          message: emptyString(osec.data.message),
        }
      : null;
  const verifiedBuildError = verifiedBuild ? undefined : (osec.error ?? "ottersec response had no is_verified flag");

  const base: ProgramVerification = {
    program,
    exists: false,
    executable: false,
    loader: null,
    upgradeable: false,
    upgradeAuthority: null,
    immutable: false,
    lastDeploySlot: null,
    verifiedBuild,
    ...(verifiedBuildError ? { verifiedBuildError } : {}),
  };
  const account = head.value;
  if (!account) return { reachable: true, source, data: { ...base, note: "no account exists at this address" } };
  if (!account.executable) {
    return { reachable: true, source, data: { ...base, exists: true, note: `not an executable program (owner ${account.owner})` } };
  }
  const authority = await readProgramAuthority(account.owner, base64Data(account), target);
  if (!authority.ok) return { reachable: false, data: null, error: authority.error, source };
  const { note, ...rest } = authority.value;
  return { reachable: true, source, data: { ...base, exists: true, executable: true, ...rest, ...(note ? { note } : {}) } };
}

// ── Addresses ──────────────────────────────────────────────────────────────

export type AccountKind = "wallet" | "program" | "token-account" | "mint" | "program-owned" | "empty";

export interface WalletProfile {
  address: string;
  /** Whether an account exists at the address. An address can own token accounts and have history without one. */
  exists: boolean;
  lamports: string;
  sol: string;
  owner: string | null;
  kind: AccountKind;
  executable: boolean;
  dataLength: number;
  /** For programs: the key that can upgrade it, or null when immutable. */
  upgradeAuthority?: string | null;
  /** Token accounts this address owns across SPL Token and Token-2022; null when the count could not be read. */
  tokenAccounts: number | null;
  recentActivity: { signatures: number; newest: string | null; oldest: string | null; windowFull: boolean } | null;
  /** Always present: lifetime transaction counts are not available from Solana RPC. */
  activityNote: string;
  notes: string[];
}

async function countTokenAccounts(owner: string, target: FlightpathTarget): Promise<Attempt<number>> {
  const counts = await Promise.all(
    TOKEN_PROGRAMS.map((programId) =>
      attempt(target, () =>
        target.rpc
          .getTokenAccountsByOwner(owner as Address, { programId: programId as Address }, { encoding: "base64", dataSlice: { offset: 0, length: 0 } })
          .send(),
      ),
    ),
  );
  const failed = counts.find((count) => !count.ok);
  if (failed && !failed.ok) return failed;
  return { ok: true, value: counts.reduce((sum, count) => sum + (count.ok ? count.value.value.length : 0), 0) };
}

/** What an address is, what it holds in SOL, and how active it has been lately. */
export async function readWalletProfile(address: string, target: FlightpathTarget = getFlightpathTarget()): Promise<ExplorerResult<WalletProfile>> {
  if (!isSolanaAddress(address)) return fail(`not a Solana address: ${String(address).slice(0, 60)}`);

  const [head, signatures, tokenAccounts] = await Promise.all([
    readAccountHead(address, target),
    attempt(target, () => target.rpc.getSignaturesForAddress(address as Address, { limit: 1000 }).send()),
    countTokenAccounts(address, target),
  ]);
  if (!head.ok) return fail(head.error);

  const notes: string[] = [];
  const account = head.value;
  const lamports = big(account?.lamports) ?? 0n;
  let kind: AccountKind = "empty";
  let upgradeAuthority: string | null | undefined;

  if (account) {
    if (account.executable) {
      kind = "program";
      const authority = await readProgramAuthority(account.owner, base64Data(account), target);
      if (authority.ok) upgradeAuthority = authority.value.upgradeAuthority;
      else notes.push(`upgrade authority unavailable: ${authority.error}`);
    } else if (account.owner === SYSTEM_PROGRAM) {
      // A system-owned account with data is a nonce account, not a wallet.
      kind = (num(account.space) ?? 0) === 0 ? "wallet" : "program-owned";
    } else if (TOKEN_PROGRAMS.includes(account.owner as (typeof TOKEN_PROGRAMS)[number])) {
      const parsed = await attempt(target, () => target.rpc.getAccountInfo(address as Address, { encoding: "jsonParsed" }).send());
      const type = parsed.ok ? parsedData(parsed.value.value as unknown as RawAccount | null)?.parsed.type : undefined;
      if (type === "mint") kind = "mint";
      else if (type === "account") kind = "token-account";
      else {
        kind = "program-owned";
        if (!parsed.ok) notes.push(`token account type unavailable: ${parsed.error}`);
      }
    } else {
      kind = "program-owned";
    }
  }

  let recentActivity: WalletProfile["recentActivity"] = null;
  if (signatures.ok) {
    const list = signatures.value as unknown as RawSignatureInfo[];
    recentActivity = {
      signatures: list.length,
      newest: list.length > 0 ? isoTime(list[0]!.blockTime) : null,
      oldest: list.length > 0 ? isoTime(list[list.length - 1]!.blockTime) : null,
      windowFull: list.length >= 1000,
    };
  } else {
    notes.push(`recent activity unavailable: ${signatures.error}`);
  }
  if (!tokenAccounts.ok) notes.push(`token account count unavailable: ${tokenAccounts.error}`);

  return {
    reachable: true,
    source: RPC_SOURCE,
    data: {
      address,
      exists: account !== null,
      lamports: lamports.toString(),
      sol: formatSol(lamports),
      owner: account?.owner ?? null,
      kind,
      executable: account?.executable ?? false,
      dataLength: num(account?.space) ?? 0,
      ...(upgradeAuthority !== undefined ? { upgradeAuthority } : {}),
      tokenAccounts: tokenAccounts.ok ? tokenAccounts.value : null,
      recentActivity,
      activityNote: ACTIVITY_NOTE,
      notes,
    },
  };
}

export interface WalletTransaction {
  signature: string;
  slot: string;
  time: string | null;
  status: "success" | "failed";
  error: string | null;
  feeSol: string | null;
  /** Net SOL change for the address asked about (fee included when it paid). */
  solChange: string | null;
  /** Programs invoked, outer and inner. Null when the transaction's details could not be read. */
  programs: string[] | null;
  memo: string | null;
  explorerUrl: string;
  /** Why fee, solChange and programs are null for this row. */
  detailError?: string;
}

/** Most recent transactions for an address, newest first, with per-transaction detail (max 20). */
export async function readWalletTransactions(
  address: string,
  limit = 10,
  target: FlightpathTarget = getFlightpathTarget(),
): Promise<ExplorerResult<WalletTransaction[]>> {
  if (!isSolanaAddress(address)) return fail(`not a Solana address: ${String(address).slice(0, 60)}`);
  const size = clamp(limit, 1, 20, 10);
  const signatures = await attempt(target, () => target.rpc.getSignaturesForAddress(address as Address, { limit: size }).send());
  if (!signatures.ok) return fail(signatures.error);
  const list = signatures.value as unknown as RawSignatureInfo[];

  const rows = await mapLimit(list, 4, async (info): Promise<WalletTransaction> => {
    const row: WalletTransaction = {
      signature: info.signature,
      slot: String(big(info.slot) ?? ""),
      time: isoTime(info.blockTime),
      status: info.err ? "failed" : "success",
      error: errorText(info.err),
      feeSol: null,
      solChange: null,
      programs: null,
      memo: info.memo ?? null,
      explorerUrl: explorerTxUrl(info.signature, target),
    };
    const detail = await attempt(target, () => fetchParsedTransaction(info.signature, target));
    if (!detail.ok) return { ...row, detailError: detail.error };
    const tx = detail.value;
    if (!tx || !tx.meta) return { ...row, detailError: "the RPC returned no details for this transaction" };
    const fee = big(tx.meta.fee);
    const index = tx.transaction.message.accountKeys.findIndex((key) => key.pubkey === address);
    const delta = index >= 0 ? solDeltaAt(tx, index) : null;
    return {
      ...row,
      feeSol: fee !== null ? formatSol(fee) : null,
      solChange: delta !== null ? formatSol(delta) : null,
      programs: programsOf(tx),
    };
  });

  const missing = rows.filter((row) => row.detailError).length;
  return {
    reachable: true,
    source: RPC_SOURCE,
    data: rows,
    ...(missing > 0 ? { error: `${missing} of ${rows.length} transactions could not be read in detail` } : {}),
  };
}

export interface TokenHolding {
  mint: string;
  tokenAccount: string;
  tokenProgram: string;
  symbol: string | null;
  name: string | null;
  decimals: number;
  /** Human units. */
  amount: string;
  /** Base units, decimal string. */
  raw: string;
  /** Null when Jupiter does not price the mint — never 0. */
  priceUsd: number | null;
  valueUsd: number | null;
}

/** Mints priced per holdings read: bounds Jupiter calls for wallets full of dust. */
const HOLDINGS_PRICE_CAP = 200;

interface RawTokenAccountEntry {
  pubkey: string;
  account: RawAccount;
}

/**
 * Every SPL token (both token programs) an address holds a non-zero balance
 * of, with USD price and value where Jupiter prices the mint.
 */
export async function readWalletHoldings(address: string, target: FlightpathTarget = getFlightpathTarget()): Promise<ExplorerResult<TokenHolding[]>> {
  const source = `${RPC_SOURCE}+jupiter`;
  if (!isSolanaAddress(address)) return fail(`not a Solana address: ${String(address).slice(0, 60)}`, source);

  const reads = await Promise.all(
    TOKEN_PROGRAMS.map((programId) =>
      attempt(target, () =>
        target.rpc.getTokenAccountsByOwner(address as Address, { programId: programId as Address }, { encoding: "jsonParsed" }).send(),
      ),
    ),
  );
  const failures = reads.flatMap((read, i) => (read.ok ? [] : [`${i === 0 ? "SPL Token" : "Token-2022"} accounts unreadable: ${read.error}`]));
  if (failures.length === reads.length) return fail(failures.join("; "), source);

  const holdings: TokenHolding[] = [];
  reads.forEach((read, i) => {
    if (!read.ok) return;
    for (const entry of read.value.value as unknown as RawTokenAccountEntry[]) {
      const info = parsedData(entry.account)?.parsed.info as
        | { mint?: string; tokenAmount?: { amount?: string; decimals?: unknown } }
        | undefined;
      const raw = big(info?.tokenAmount?.amount);
      if (!info?.mint || raw === null || raw === 0n) continue;
      const decimals = num(info.tokenAmount?.decimals) ?? 0;
      holdings.push({
        mint: info.mint,
        tokenAccount: entry.pubkey,
        tokenProgram: TOKEN_PROGRAMS[i]!,
        symbol: null,
        name: null,
        decimals,
        amount: formatUnits(raw, decimals),
        raw: raw.toString(),
        priceUsd: null,
        valueUsd: null,
      });
    }
  });

  const notes = [...failures];
  const mints = [...new Set(holdings.map((h) => h.mint))];
  const priced = mints.slice(0, HOLDINGS_PRICE_CAP);
  if (mints.length > priced.length) notes.push(`priced the first ${priced.length} of ${mints.length} mints; the rest are shown unpriced`);
  if (priced.length > 0) {
    const [prices, tokens] = await Promise.all([readTokenPrices(priced), readJupiterTokens(priced)]);
    if (!prices.data) notes.push(`prices unavailable: ${prices.error}`);
    if (!tokens.data) notes.push(`token names unavailable: ${tokens.error}`);
    const byMint = new Map<string, JupiterToken>((tokens.data ?? []).map((t) => [t.mint, t]));
    for (const holding of holdings) {
      const token = byMint.get(holding.mint);
      holding.symbol = token?.symbol ?? null;
      holding.name = token?.name ?? null;
      const price = prices.data?.[holding.mint]?.usdPrice ?? null;
      holding.priceUsd = price;
      if (price !== null) {
        const value = Number(holding.amount) * price;
        holding.valueUsd = Number.isFinite(value) ? roundUsd(value) : null;
      }
    }
  }

  // Priced holdings by value first; unpriced keep their read order after them.
  holdings.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
  return { reachable: true, source, data: holdings, ...(notes.length > 0 ? { error: notes.join("; ") } : {}) };
}

// ── Tokens ─────────────────────────────────────────────────────────────────

export interface TokenProfile {
  mint: string;
  tokenProgram: string;
  name: string | null;
  symbol: string | null;
  decimals: number;
  supply: string;
  supplyFormatted: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  holderCount: number | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  verified: boolean | null;
  organicScore: number | null;
  sources: { chain: "rpc"; market: "jupiter" };
  /** Jupiter could not be read; market fields are null because of that, not because they are zero. */
  marketError?: string;
  /** Jupiter answered but has no record of this mint. */
  marketNote?: string;
}

/**
 * A mint as the chain declares it (supply, decimals, authorities, on-chain
 * name) joined with Jupiter's market view (holders, price, market cap,
 * liquidity, volume, verification). The chain half stands on its own.
 */
export async function readTokenProfile(mint: string, target: FlightpathTarget = getFlightpathTarget()): Promise<ExplorerResult<TokenProfile>> {
  const source = `${RPC_SOURCE}+jupiter`;
  if (!isSolanaAddress(mint)) return fail(`not a Solana mint address: ${String(mint).slice(0, 60)}`, source);
  const [chain, market] = await Promise.all([readMintInfo(mint, target), readJupiterTokens([mint])]);
  if (!chain.data) return { ...chain, source, data: null };
  const m = chain.data;
  const token = market.data?.find((t) => t.mint === mint) ?? null;
  return {
    reachable: true,
    source,
    data: {
      mint,
      tokenProgram: m.tokenProgram,
      name: m.name ?? token?.name ?? null,
      symbol: m.symbol ?? token?.symbol ?? null,
      decimals: m.decimals,
      supply: m.supply,
      supplyFormatted: m.supplyFormatted,
      mintAuthority: m.mintAuthority,
      freezeAuthority: m.freezeAuthority,
      holderCount: token?.holderCount ?? null,
      priceUsd: token?.usdPrice ?? null,
      marketCapUsd: token?.mcap ?? null,
      fdvUsd: token?.fdv ?? null,
      liquidityUsd: token?.liquidity ?? null,
      volume24hUsd: token?.volume24hUsd ?? null,
      verified: token ? token.isVerified : null,
      organicScore: token?.organicScore ?? null,
      sources: { chain: "rpc", market: "jupiter" },
      ...(market.data ? {} : { marketError: market.error ?? "jupiter unreadable" }),
      ...(market.data && !token ? { marketNote: "Jupiter has no record of this mint" } : {}),
    },
  };
}

export interface TokenHolder {
  rank: number;
  tokenAccount: string;
  /** Wallet or program that controls the token account; null when the account could not be read. */
  owner: string | null;
  amount: string;
  raw: string;
  sharePct: number | null;
  /** True when the owner is off the ed25519 curve — a PDA, so a program (pool, vault, escrow) controls it. */
  ownerIsProgramDerived: boolean | null;
}

export interface TokenHolders {
  mint: string;
  supply: string;
  supplyFormatted: string;
  /** Jupiter's holder count; null when Jupiter has none or could not be read. */
  holderCount: number | null;
  holders: TokenHolder[];
  notes: string[];
}

/**
 * The largest token accounts of a mint (the RPC returns at most 20), with
 * each account's owner and share of supply. Token accounts, not wallets: one
 * owner can appear more than once.
 */
export async function readTokenHolders(
  mint: string,
  limit = 20,
  target: FlightpathTarget = getFlightpathTarget(),
): Promise<ExplorerResult<TokenHolders>> {
  if (!isSolanaAddress(mint)) return fail(`not a Solana mint address: ${String(mint).slice(0, 60)}`);
  const size = clamp(limit, 1, 20, 20);
  const [account, largest, market] = await Promise.all([
    readMintAccount(mint, target),
    attempt(target, () => target.rpc.getTokenLargestAccounts(mint as Address).send()),
    readJupiterTokens([mint]),
  ]);
  if (!account.data) return { ...account, data: null };
  if (!largest.ok) return fail(`largest accounts unavailable: ${largest.error}`);

  const decimals = num(account.data.info.decimals) ?? 0;
  const supply = big(account.data.info.supply) ?? 0n;
  const top = (largest.value.value as unknown as Array<{ address: string; amount: string }>).slice(0, size);

  const notes: string[] = [];
  const owners = new Map<string, string>();
  if (top.length > 0) {
    const read = await attempt(target, () =>
      target.rpc.getMultipleAccounts(top.map((entry) => entry.address as Address), { encoding: "jsonParsed" }).send(),
    );
    if (read.ok) {
      (read.value.value as unknown as Array<RawAccount | null>).forEach((acct, i) => {
        const owner = parsedData(acct)?.parsed.info?.owner;
        if (typeof owner === "string") owners.set(top[i]!.address, owner);
      });
    } else {
      notes.push(`owners unavailable: ${read.error}`);
    }
  }

  const holders = top.map((entry, i): TokenHolder => {
    const raw = big(entry.amount) ?? 0n;
    const owner = owners.get(entry.address) ?? null;
    return {
      rank: i + 1,
      tokenAccount: entry.address,
      owner,
      amount: formatUnits(raw, decimals),
      raw: raw.toString(),
      sharePct: sharePct(raw, supply),
      ownerIsProgramDerived: owner && isSolanaAddress(owner) ? isOffCurveAddress(owner) : null,
    };
  });

  const token = market.data?.find((t) => t.mint === mint);
  if (!market.data) notes.push(`holder count unavailable: ${market.error}`);
  else if (!token) notes.push("Jupiter has no record of this mint, so no holder count");

  return {
    reachable: true,
    source: RPC_SOURCE,
    data: {
      mint,
      supply: supply.toString(),
      supplyFormatted: formatUnits(supply, decimals),
      holderCount: token?.holderCount ?? null,
      holders,
      notes,
    },
  };
}

export interface TokenActivityChange {
  /** Wallet or program owning the token account; null when the RPC did not report it. */
  owner: string | null;
  tokenAccount: string;
  /** Signed change in human units, e.g. "-12.5". */
  delta: string;
}

export interface TokenActivity {
  signature: string;
  slot: string;
  time: string | null;
  status: "success" | "failed";
  /** Null when the transaction's details could not be read (see detailError). */
  changes: TokenActivityChange[] | null;
  explorerUrl: string;
  detailError?: string;
}

/**
 * Recent transactions that reference the mint account, each with its balance
 * changes in this token.
 *
 * Coverage caveat: Solana indexes signatures by the accounts a transaction
 * lists. A plain SPL `transfer` does not list the mint (only
 * `transferChecked`, mints, burns and most DEX swaps do), so transfers that
 * don't reference the mint account are not visible here. This is the newest
 * slice of what is visible, not a complete transfer history.
 */
export async function readTokenActivity(
  mint: string,
  limit = 10,
  target: FlightpathTarget = getFlightpathTarget(),
): Promise<ExplorerResult<TokenActivity[]>> {
  if (!isSolanaAddress(mint)) return fail(`not a Solana mint address: ${String(mint).slice(0, 60)}`);
  const size = clamp(limit, 1, 15, 10);
  const signatures = await attempt(target, () => target.rpc.getSignaturesForAddress(mint as Address, { limit: size }).send());
  if (!signatures.ok) return fail(signatures.error);
  const list = signatures.value as unknown as RawSignatureInfo[];

  const rows = await mapLimit(list, 4, async (info): Promise<TokenActivity> => {
    const row: TokenActivity = {
      signature: info.signature,
      slot: String(big(info.slot) ?? ""),
      time: isoTime(info.blockTime),
      status: info.err ? "failed" : "success",
      changes: null,
      explorerUrl: explorerTxUrl(info.signature, target),
    };
    const detail = await attempt(target, () => fetchParsedTransaction(info.signature, target));
    if (!detail.ok) return { ...row, detailError: detail.error };
    if (!detail.value || !detail.value.meta) return { ...row, detailError: "the RPC returned no details for this transaction" };
    return {
      ...row,
      changes: tokenDeltas(detail.value, mint).map((d) => ({
        owner: d.owner,
        tokenAccount: d.tokenAccount,
        delta: formatUnits(d.raw, d.decimals),
      })),
    };
  });

  const missing = rows.filter((row) => row.detailError).length;
  return {
    reachable: true,
    source: RPC_SOURCE,
    data: rows,
    ...(missing > 0 ? { error: `${missing} of ${rows.length} transactions could not be read in detail` } : {}),
  };
}

// ── Transactions ───────────────────────────────────────────────────────────

export interface TransactionDetail {
  signature: string;
  slot: string;
  time: string | null;
  /** "failed" means it landed with an error: the fee was paid, nothing else changed. */
  status: "success" | "failed";
  error: string | null;
  feeSol: string | null;
  computeUnits: string | null;
  feePayer: string | null;
  signers: string[];
  programs: string[];
  /** Net SOL change per account, decimal SOL (fee included for the payer). */
  solChanges: Array<{ address: string; delta: string }>;
  tokenChanges: Array<{ owner: string | null; tokenAccount: string; mint: string; delta: string }>;
  /** The last program log lines — where Solana puts the reason a transaction failed. */
  logTail: string[];
  explorerUrl: string;
}

/** One transaction by signature. */
export async function readTransaction(signature: string, target: FlightpathTarget = getFlightpathTarget()): Promise<ExplorerResult<TransactionDetail>> {
  if (!isSolanaSignature(signature)) return fail(`not a Solana transaction signature: ${String(signature).slice(0, 100)}`);
  const read = await attempt(target, () => fetchParsedTransaction(signature, target));
  if (!read.ok) return fail(read.error);
  const tx = read.value;
  // The RPC answered and does not have it: unknown, dropped, or older than the node's history.
  if (!tx) return { reachable: true, data: null, error: "transaction not found", source: RPC_SOURCE };
  // Without meta there is no status; calling it a success or a failure would be a guess.
  if (!tx.meta) return { reachable: true, data: null, error: "the RPC returned this transaction without its status metadata", source: RPC_SOURCE };

  const keys = tx.transaction.message.accountKeys;
  const meta = tx.meta;
  const fee = big(meta?.fee);
  const solChanges: TransactionDetail["solChanges"] = [];
  keys.forEach((key, index) => {
    const delta = solDeltaAt(tx, index);
    if (delta !== null && delta !== 0n) solChanges.push({ address: key.pubkey, delta: formatSol(delta) });
  });
  const computeUnits = big(meta?.computeUnitsConsumed);

  return {
    reachable: true,
    source: RPC_SOURCE,
    data: {
      signature,
      slot: String(big(tx.slot) ?? ""),
      time: isoTime(tx.blockTime),
      status: meta?.err ? "failed" : "success",
      error: errorText(meta?.err),
      feeSol: fee !== null ? formatSol(fee) : null,
      computeUnits: computeUnits !== null ? computeUnits.toString() : null,
      feePayer: keys[0]?.pubkey ?? null,
      signers: keys.filter((key) => key.signer).map((key) => key.pubkey),
      programs: programsOf(tx),
      solChanges,
      tokenChanges: tokenDeltas(tx).map((d) => ({
        owner: d.owner,
        tokenAccount: d.tokenAccount,
        mint: d.mint,
        delta: formatUnits(d.raw, d.decimals),
      })),
      logTail: (meta?.logMessages ?? []).slice(-12),
      explorerUrl: explorerTxUrl(signature, target),
    },
  };
}
