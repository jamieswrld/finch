import type { Slot } from "@solana/kit";
import { explorerBlockUrl } from "./chain.ts";
import { isSolanaAddress, isSolanaSignature, parseUnits, SOL_DECIMALS, WSOL_MINT, type AccountRoleName } from "./codec.ts";
import {
  readChainStats,
  readProgramVerification,
  readTokenActivity,
  readTokenHolders,
  readTokenProfile,
  readTransaction,
  readWalletHoldings,
  readWalletProfile,
  readWalletTransactions,
} from "./explorer.ts";
import type { Flightpath } from "./flightpath.ts";
import { readMarketPair, readSwapQuote, readTokenList, readTokenMarkets, readTokenPrices } from "./market.ts";
import { getNetworkStatus } from "./network.ts";
import { readPumpCurve } from "./pump.ts";
import { loadApprovedRwaAssets } from "./rwa.ts";

/**
 * The Flightpath tool catalog.
 *
 * One source of truth used three ways:
 *  · the Finch runtime exposes these to models as callable tools,
 *  · the Nest Builder UI renders them as selectable capabilities,
 *  · the PolicyEngine sees every write-mode invocation as an ExecutionIntent.
 */

export type ToolMode = "read" | "write";

export type ToolCategory =
  | "network"
  | "explorer"
  | "market"
  | "balances"
  | "tokens"
  | "portfolio"
  | "accounts"
  | "transfers"
  | "spl"
  | "programs"
  | "swaps"
  | "rwa";

export type ToolRisk = "none" | "low" | "high";

export interface FlightpathToolMeta {
  name: string;
  mode: ToolMode;
  category: ToolCategory;
  description: string;
  risk: ToolRisk;
  /** JSON Schema for the tool's arguments, as handed to the model. */
  inputSchema: Record<string, unknown>;
}

const address = { type: "string", pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$", description: "Solana address (base58)" };
const mint = { ...address, description: "SPL token mint address (base58)" };
const decimalAmount = { type: "string", pattern: "^[0-9]+(\\.[0-9]+)?$", description: "decimal amount in human units" };
const limit = (max: number, fallback: number) => ({
  type: "string",
  pattern: "^[0-9]{1,2}$",
  description: `how many rows, 1-${max}; default ${fallback}`,
});

export const FLIGHTPATH_TOOLS: FlightpathToolMeta[] = [
  // ── Live network — what the cluster IS right now ──────────────────────────
  {
    name: "network_status",
    mode: "read",
    category: "network",
    risk: "none",
    description:
      "Read live Solana status: cluster, latest slot and block height, epoch and its progress, transactions per second (all and non-vote), observed slot time, the network fee for one signature, recent priority fees, RPC latency and node version.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "block_read",
    mode: "read",
    category: "network",
    risk: "none",
    description:
      "Read one block by slot (or the latest confirmed one): block time, block height, transaction count, blockhash and parent slot. Some slots are skipped by their leader and have no block — that is reported, not an error.",
    inputSchema: {
      type: "object",
      properties: { slot: { type: "string", pattern: "^[0-9]+$", description: "decimal slot number; omit for the latest confirmed" } },
    },
  },

  // ── History and indexed reads — what HAPPENED ─────────────────────────────
  // Every one reports reachable:false with a reason when its source cannot be
  // read, and a finch must say so rather than treat it as an empty answer.
  {
    name: "chain_stats",
    mode: "read",
    category: "explorer",
    risk: "none",
    description:
      "Whole-network counters: total transactions since genesis, SOL supply (total, circulating, non-circulating), current epoch and progress, TPS and slot time, and the SOL price in USD from Jupiter (null when unavailable).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "wallet_profile",
    mode: "read",
    category: "explorer",
    risk: "none",
    description:
      "What an address is: a wallet, a program (with its upgrade authority), a token account, a mint, an account owned by some other program, or empty. Its SOL balance, owner program, size, how many token accounts it holds, and its recent activity window. Lifetime transaction counts are not available from the chain and are not estimated.",
    inputSchema: { type: "object", properties: { address }, required: ["address"] },
  },
  {
    name: "wallet_transactions",
    mode: "read",
    category: "explorer",
    risk: "none",
    description:
      "Most recent transactions involving an address, newest first: signature, slot, time, success or failure, fee, this address's SOL change, programs invoked and any memo.",
    inputSchema: { type: "object", properties: { address, limit: limit(20, 10) }, required: ["address"] },
  },
  {
    name: "wallet_holdings",
    mode: "read",
    category: "explorer",
    risk: "none",
    description:
      "Every SPL token (SPL Token and Token-2022) an address holds with a non-zero balance, with USD price and value where Jupiter prices it. Unpriced tokens report null rather than a guess.",
    inputSchema: { type: "object", properties: { address }, required: ["address"] },
  },
  {
    name: "token_profile",
    mode: "read",
    category: "explorer",
    risk: "none",
    description:
      "A token mint: name, symbol, decimals, supply, mint and freeze authority (null means revoked), token program, plus holder count, USD price, market cap, liquidity, 24h volume and Jupiter's verification flag where known.",
    inputSchema: { type: "object", properties: { mint }, required: ["mint"] },
  },
  {
    name: "token_holders",
    mode: "read",
    category: "explorer",
    risk: "none",
    description:
      "Largest token accounts for a mint (up to 20), largest first: owner, balance, share of total supply in percent, and whether the owner is a program-derived address (typically a pool, vault or program-controlled account). Also the total holder count where Jupiter reports one.",
    inputSchema: { type: "object", properties: { mint, limit: limit(20, 10) }, required: ["mint"] },
  },
  {
    name: "token_activity",
    mode: "read",
    category: "explorer",
    risk: "none",
    description:
      "Recent transactions that reference a mint account, newest first, with each one's balance changes in this token by owner. Transfers that do not pass the mint account (plain unchecked transfers) are not visible here, so this is recent activity, not a complete transfer log.",
    inputSchema: { type: "object", properties: { mint, limit: limit(15, 10) }, required: ["mint"] },
  },
  {
    name: "token_list",
    mode: "read",
    category: "market",
    risk: "none",
    description: "Tokens Jupiter ranks by 24h trading on Solana, with USD price, market cap, liquidity, 24h volume, holder count and verification flag where known.",
    inputSchema: { type: "object", properties: { limit: limit(50, 20) } },
  },
  {
    name: "token_price",
    mode: "read",
    category: "market",
    risk: "none",
    description: "USD prices from Jupiter for up to 50 mints. A mint Jupiter cannot price is absent from the answer — never zero.",
    inputSchema: {
      type: "object",
      properties: { mints: { type: "array", items: mint, maxItems: 50, description: "mint addresses to price" } },
      required: ["mints"],
    },
  },
  {
    name: "token_markets",
    mode: "read",
    category: "market",
    risk: "none",
    description:
      "Where a token trades: its DEX markets from DexScreener, largest liquidity first — DEX, pair address, base and quote token, price, liquidity in USD, 24h volume and buy/sell counts, market cap and FDV.",
    inputSchema: { type: "object", properties: { mint, limit: limit(20, 10) }, required: ["mint"] },
  },
  {
    name: "market_pair",
    mode: "read",
    category: "market",
    risk: "none",
    description: "One DEX pair or pool by its address, from DexScreener: tokens, price, liquidity, 24h volume and trade counts.",
    inputSchema: { type: "object", properties: { pair: address }, required: ["pair"] },
  },
  {
    name: "swap_quote",
    mode: "read",
    category: "market",
    risk: "none",
    description:
      "A Jupiter route quote for swapping an exact input amount: expected output, the minimum output at the given slippage, price impact and the route's legs. Read-only — nothing is signed.",
    inputSchema: {
      type: "object",
      properties: {
        inputMint: mint,
        outputMint: mint,
        amount: { ...decimalAmount, description: "input amount in human units of inputMint" },
        slippageBps: { type: "string", pattern: "^[0-9]{1,4}$", description: "slippage tolerance in basis points; default 50" },
      },
      required: ["inputMint", "outputMint", "amount"],
    },
  },
  {
    name: "pump_curve",
    mode: "read",
    category: "market",
    risk: "none",
    description:
      "Read a pump.fun launch straight off its bonding-curve account: whether the mint exists, whether it is still on the curve or has graduated, how far along the curve it is (against the launch parameters read from pump.fun's global config), SOL paid in, tokens left on the curve, spot price on the curve, and the creator. A mint that exists but has no pump.fun curve is reported as not_on_pump.",
    inputSchema: { type: "object", properties: { mint }, required: ["mint"] },
  },
  {
    name: "tx_lookup",
    mode: "read",
    category: "explorer",
    risk: "none",
    description:
      "One transaction by signature: success or failure (with the error), slot, time, fee, compute units, fee payer and signers, programs invoked, SOL and token balance changes, and the last program log lines.",
    inputSchema: {
      type: "object",
      properties: { signature: { type: "string", pattern: "^[1-9A-HJ-NP-Za-km-z]{64,88}$", description: "transaction signature (base58)" } },
      required: ["signature"],
    },
  },
  {
    name: "program_verified",
    mode: "read",
    category: "explorer",
    risk: "none",
    description:
      "Whether an address is an executable program, whether it can still be upgraded and by which authority (or is immutable), and whether its build is verified against public source (OtterSec verify API). Unverified is a definite answer, not an error.",
    inputSchema: { type: "object", properties: { program: address }, required: ["program"] },
  },
  {
    name: "balance_native",
    mode: "read",
    category: "balances",
    risk: "none",
    description: "Read the SOL balance of an address.",
    inputSchema: { type: "object", properties: { address }, required: ["address"] },
  },
  {
    name: "balance_spl",
    mode: "read",
    category: "balances",
    risk: "none",
    description: "Read a holder's balance of one SPL token, summed across every token account it owns for that mint.",
    inputSchema: { type: "object", properties: { mint, holder: address }, required: ["mint", "holder"] },
  },
  {
    name: "token_data",
    mode: "read",
    category: "tokens",
    risk: "none",
    description: "Read a mint account directly: decimals, supply, mint and freeze authority, token program, and on-chain name and symbol where the mint carries metadata.",
    inputSchema: { type: "object", properties: { mint }, required: ["mint"] },
  },
  {
    name: "portfolio_snapshot",
    mode: "read",
    category: "portfolio",
    risk: "none",
    description: "Snapshot the SOL balance plus the balances of a given list of SPL mints for an address.",
    inputSchema: {
      type: "object",
      properties: { address, mints: { type: "array", items: mint, description: "SPL mints to include" } },
      required: ["address"],
    },
  },
  {
    name: "account_read",
    mode: "read",
    category: "accounts",
    risk: "none",
    description:
      "Raw read of any account: owner program, lamports, whether it is executable, data size, and the decoded data where the RPC can parse it (token accounts, mints, stake, vote, config and similar); otherwise the start of its raw data.",
    inputSchema: { type: "object", properties: { address }, required: ["address"] },
  },
  {
    name: "rwa_registry",
    mode: "read",
    category: "rwa",
    risk: "none",
    description: "List the tokenized real-world assets (SPL mints) approved for agent interaction, with issuer restrictions.",
    inputSchema: { type: "object", properties: {} },
  },

  // ── Writes — simulated first, bounded by wallet policy, logged ────────────
  {
    name: "transfer_native",
    mode: "write",
    category: "transfers",
    risk: "high",
    description: "Transfer SOL. Simulated first; bounded by wallet allowances; logged.",
    inputSchema: { type: "object", properties: { to: address, amount: decimalAmount }, required: ["to", "amount"] },
  },
  {
    name: "transfer_spl",
    mode: "write",
    category: "transfers",
    risk: "high",
    description:
      "Transfer an SPL token (checked transfer, to the recipient's associated token account, which must already exist). Simulated first; bounded by wallet allowances; logged.",
    inputSchema: {
      type: "object",
      properties: { mint, to: address, amount: decimalAmount },
      required: ["mint", "to", "amount"],
    },
  },
  {
    name: "spl_approve",
    mode: "write",
    category: "spl",
    risk: "high",
    description: "Approve a delegate to spend an amount of an SPL token. Approvals count against allowances.",
    inputSchema: {
      type: "object",
      properties: { mint, delegate: address, amount: decimalAmount },
      required: ["mint", "delegate", "amount"],
    },
  },
  {
    name: "program_invoke",
    mode: "write",
    category: "programs",
    risk: "high",
    description:
      "Send one raw instruction to a program. The program must be on the allowlist, the only signer may be this agent's wallet, and any System or Token instruction inside must be one the policy can price.",
    inputSchema: {
      type: "object",
      properties: {
        program: address,
        accounts: {
          type: "array",
          description: "account metas in order",
          items: {
            type: "object",
            properties: {
              address,
              role: { type: "string", enum: ["readonly", "writable", "readonly_signer", "writable_signer"] },
            },
            required: ["address", "role"],
          },
        },
        data: { type: "string", description: "instruction data, base64" },
      },
      required: ["program", "accounts", "data"],
    },
  },
  {
    name: "swap_exact_in",
    mode: "write",
    category: "swaps",
    risk: "high",
    description:
      "Swap an exact input amount through Jupiter, with a slippage bound the route enforces on chain. The Jupiter program must be on the allowlist; the input amount counts against the input asset's allowance.",
    inputSchema: {
      type: "object",
      properties: {
        inputMint: mint,
        outputMint: mint,
        amountIn: decimalAmount,
        slippageBps: { type: "string", pattern: "^[0-9]{1,4}$", description: "slippage tolerance in basis points, 1-1000; default 50" },
      },
      required: ["inputMint", "outputMint", "amountIn"],
    },
  },
  {
    name: "rwa_interact",
    mode: "write",
    category: "rwa",
    risk: "high",
    description: "Transfer or approve an approved RWA token. Hard-restricted to the approved registry.",
    inputSchema: {
      type: "object",
      properties: {
        mint,
        action: { type: "string", enum: ["transfer", "approve"] },
        counterparty: address,
        amount: decimalAmount,
      },
      required: ["mint", "action", "counterparty", "amount"],
    },
  },
];

export interface ToolExecutionContext {
  /** Idempotency key for write tools, assigned by the runtime per invocation. */
  executionId: string;
}

export interface ExecutableTool {
  meta: FlightpathToolMeta;
  execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>;
}

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`tool argument "${key}" must be a non-empty string`);
  return value;
}

/** Optional row limit, clamped to what the source serves. */
function lim(args: Record<string, unknown>, fallback: number, max: number): number {
  const raw = typeof args.limit === "string" ? Number(args.limit) : typeof args.limit === "number" ? args.limit : Number.NaN;
  return Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), max) : fallback;
}

/**
 * Present a read result to a model. Data is spread to the top level (or under
 * `key` when it is a list) so the useful part is not buried, while
 * reachable/error/source stay visible so failure is never mistaken for
 * emptiness.
 */
function flat<T>(
  result: { reachable: boolean; error?: string; source: string; data: T | null },
  key?: string,
): Record<string, unknown> {
  const head = { source: result.source, reachable: result.reachable, error: result.error ?? null };
  if (result.data === null) return head;
  if (key) return { ...head, [key]: result.data };
  return typeof result.data === "object" && !Array.isArray(result.data)
    ? { ...head, ...(result.data as object) }
    : { ...head, data: result.data };
}

function addr(args: Record<string, unknown>, key: string): string {
  const value = str(args, key);
  if (!isSolanaAddress(value)) throw new Error(`tool argument "${key}" is not a valid Solana address`);
  return value;
}

function slippage(args: Record<string, unknown>): number {
  const raw = typeof args.slippageBps === "string" ? Number(args.slippageBps) : typeof args.slippageBps === "number" ? args.slippageBps : 50;
  if (!Number.isInteger(raw) || raw < 1 || raw > 1_000) throw new Error("slippageBps must be an integer between 1 and 1000");
  return raw;
}

async function decimalsFor(fp: Flightpath, mintAddress: string): Promise<number> {
  return mintAddress === WSOL_MINT ? SOL_DECIMALS : (await fp.tokenData(mintAddress)).decimals;
}

const ROLES: AccountRoleName[] = ["readonly", "writable", "readonly_signer", "writable_signer"];

/** Bind the catalog to a live Flightpath instance for the Finch runtime. */
export function createFlightpathTools(fp: Flightpath, selection?: string[]): ExecutableTool[] {
  const metas = FLIGHTPATH_TOOLS.filter((meta) => !selection || selection.includes(meta.name));
  const target = fp.target;

  const bindings: Record<string, (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<unknown>> = {
    network_status: async () => {
      const status = await getNetworkStatus(target);
      return {
        cluster: status.cluster,
        chain: status.chain,
        reachable: status.reachable,
        genesisMatches: status.genesisMatches,
        slot: status.slot,
        blockHeight: status.blockHeight,
        blockTime: status.blockTime,
        epoch: status.epoch,
        epochProgressPct: status.epochProgressPct,
        tps: status.tps,
        nonVoteTps: status.nonVoteTps,
        slotTimeMs: status.slotTimeMs,
        feePerSignatureLamports: status.feePerSignatureLamports,
        priorityFeeMicroLamportsPerCu: status.priorityFeeMicroLamports,
        rpcLatencyMs: status.latencyMs,
        version: status.version,
        error: status.error ?? null,
      };
    },
    block_read: async (args) => {
      const slot = typeof args.slot === "string" && /^[0-9]+$/.test(args.slot)
        ? BigInt(args.slot)
        : await target.rpc.getSlot({ commitment: "confirmed" }).send();
      try {
        const block = await target.rpc
          .getBlock(slot as Slot, { transactionDetails: "signatures", rewards: false, maxSupportedTransactionVersion: 1, commitment: "confirmed" })
          .send();
        if (!block) return { slot: slot.toString(), found: false, note: "the node has no block for this slot" };
        return {
          slot: slot.toString(),
          found: true,
          blockTime: block.blockTime !== null ? new Date(Number(block.blockTime) * 1000).toISOString() : null,
          blockHeight: block.blockHeight !== null ? block.blockHeight.toString() : null,
          transactions: block.signatures.length,
          blockhash: block.blockhash,
          parentSlot: block.parentSlot.toString(),
          explorerUrl: explorerBlockUrl(slot, target),
        };
      } catch (error) {
        // Skipped slots have no block; the RPC says so with an error.
        const message = error instanceof Error ? error.message : String(error);
        return { slot: slot.toString(), found: false, note: /skipped|not available/i.test(message) ? "slot was skipped or its block is not available on this node" : message.slice(0, 160) };
      }
    },
    chain_stats: async () => flat(await readChainStats(target)),
    wallet_profile: async (args) => flat(await readWalletProfile(addr(args, "address"), target)),
    wallet_transactions: async (args) =>
      flat(await readWalletTransactions(addr(args, "address"), lim(args, 10, 20), target), "transactions"),
    wallet_holdings: async (args) => flat(await readWalletHoldings(addr(args, "address"), target), "holdings"),
    token_profile: async (args) => flat(await readTokenProfile(addr(args, "mint"), target)),
    token_holders: async (args) => flat(await readTokenHolders(addr(args, "mint"), lim(args, 10, 20), target)),
    token_activity: async (args) => flat(await readTokenActivity(addr(args, "mint"), lim(args, 10, 15), target), "activity"),
    token_list: async (args) => flat(await readTokenList(lim(args, 20, 50)), "tokens"),
    token_price: async (args) => {
      const mints = Array.isArray(args.mints) ? args.mints.filter((entry): entry is string => isSolanaAddress(entry)).slice(0, 50) : [];
      if (mints.length === 0) throw new Error('tool argument "mints" must list at least one Solana mint');
      return flat(await readTokenPrices(mints), "prices");
    },
    token_markets: async (args) => flat(await readTokenMarkets(addr(args, "mint"), lim(args, 10, 20)), "markets"),
    market_pair: async (args) => flat(await readMarketPair(addr(args, "pair"))),
    swap_quote: async (args) => {
      const inputMint = addr(args, "inputMint");
      const outputMint = addr(args, "outputMint");
      const amount = parseUnits(str(args, "amount"), await decimalsFor(fp, inputMint));
      const quote = await readSwapQuote({ inputMint, outputMint, amount, slippageBps: slippage(args) });
      // The raw route is for building a transaction, not for reading.
      const { raw: _raw, ...readable } = quote.data ?? { raw: null };
      return flat({ ...quote, data: quote.data ? readable : null });
    },
    pump_curve: async (args) => {
      const mintAddress = addr(args, "mint");
      // The mint's own decimals scale the price when it can be read; pump.fun's 6 otherwise.
      const decimals = await fp.tokenData(mintAddress).then((meta) => meta.decimals).catch(() => undefined);
      return flat(await readPumpCurve(mintAddress, target, { tokenDecimals: decimals }));
    },
    tx_lookup: async (args) => {
      const signature = str(args, "signature");
      if (!isSolanaSignature(signature)) throw new Error('tool argument "signature" is not a transaction signature');
      return flat(await readTransaction(signature, target));
    },
    program_verified: async (args) => flat(await readProgramVerification(addr(args, "program"), target)),
    balance_native: async (args) => fp.nativeBalance(addr(args, "address")),
    balance_spl: async (args) => fp.splBalance(addr(args, "mint"), addr(args, "holder")),
    token_data: async (args) => fp.tokenData(addr(args, "mint")),
    portfolio_snapshot: async (args) =>
      fp.portfolio(
        addr(args, "address"),
        Array.isArray(args.mints) ? args.mints.filter((entry): entry is string => isSolanaAddress(entry)).slice(0, 25) : [],
      ),
    account_read: async (args) => fp.accountRead(addr(args, "address")),
    rwa_registry: async () => loadApprovedRwaAssets(),
    transfer_native: async (args, ctx) =>
      fp.transferNative({ id: ctx.executionId, to: addr(args, "to"), amount: parseUnits(str(args, "amount"), SOL_DECIMALS) }),
    transfer_spl: async (args, ctx) => {
      const mintAddress = addr(args, "mint");
      return fp.transferSpl({
        id: ctx.executionId,
        mint: mintAddress,
        to: addr(args, "to"),
        amount: parseUnits(str(args, "amount"), await decimalsFor(fp, mintAddress)),
      });
    },
    spl_approve: async (args, ctx) => {
      const mintAddress = addr(args, "mint");
      return fp.approveSpl({
        id: ctx.executionId,
        mint: mintAddress,
        delegate: addr(args, "delegate"),
        amount: parseUnits(str(args, "amount"), await decimalsFor(fp, mintAddress)),
      });
    },
    program_invoke: async (args, ctx) => {
      const accounts = Array.isArray(args.accounts) ? args.accounts : [];
      return fp.programInvoke({
        id: ctx.executionId,
        programAddress: addr(args, "program"),
        accounts: accounts.map((entry, index) => {
          const meta = (entry ?? {}) as { address?: unknown; role?: unknown };
          if (!isSolanaAddress(meta.address)) throw new Error(`account ${index} is not a valid Solana address`);
          if (!ROLES.includes(meta.role as AccountRoleName)) throw new Error(`account ${index} has an invalid role`);
          return { address: meta.address, role: meta.role as AccountRoleName };
        }),
        data: str(args, "data"),
      });
    },
    swap_exact_in: async (args, ctx) => {
      const inputMint = addr(args, "inputMint");
      return fp.swapExactIn({
        id: ctx.executionId,
        inputMint,
        outputMint: addr(args, "outputMint"),
        amountIn: parseUnits(str(args, "amountIn"), await decimalsFor(fp, inputMint)),
        slippageBps: slippage(args),
      });
    },
    rwa_interact: async (args, ctx) => {
      const mintAddress = addr(args, "mint");
      const action = str(args, "action");
      if (action !== "transfer" && action !== "approve") throw new Error(`unsupported RWA action "${action}"`);
      return fp.rwaInteract({
        id: ctx.executionId,
        mint: mintAddress,
        action,
        counterparty: addr(args, "counterparty"),
        amount: parseUnits(str(args, "amount"), (await fp.tokenData(mintAddress)).decimals),
      });
    },
  };

  return metas.map((meta) => ({
    meta,
    execute: (args, ctx) => {
      const binding = bindings[meta.name];
      if (!binding) throw new Error(`no binding for tool ${meta.name}`);
      return binding(args, ctx);
    },
  }));
}
