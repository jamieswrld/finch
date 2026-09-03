import { parseUnits, type Address } from "viem";
import { explorerBlockUrl } from "./chain.ts";
import type { Flightpath } from "./flightpath.ts";
import { getNetworkStatus } from "./network.ts";
import {
  readChainStats,
  readContractVerification,
  readTokenHolders,
  readTokenList,
  readTokenProfile,
  readTokenTransfers,
  readTransaction,
  readWalletHoldings,
  readWalletProfile,
  readWalletTransactions,
} from "./explorer.ts";
import { creatorTaxOn, getPonsConfig, FINCH_CREATOR_TAX_BPS } from "./pons.ts";
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
  | "balances"
  | "transfers"
  | "erc20"
  | "contracts"
  | "swaps"
  | "pons"
  | "tokens"
  | "portfolio"
  | "rwa"
  | "explorer";

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

const address = { type: "string", pattern: "^0x[a-fA-F0-9]{40}$", description: "EVM address" };
const decimalAmount = { type: "string", pattern: "^[0-9]+(\\.[0-9]+)?$", description: "decimal amount in human units" };

export const FLIGHTPATH_TOOLS: FlightpathToolMeta[] = [
  {
    name: "network_status",
    mode: "read",
    category: "network",
    risk: "none",
    description:
      "Read live Robinhood Chain status: chain id, head block height and age, gas price, block time, transactions in the latest block, and RPC latency.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "block_read",
    mode: "read",
    category: "network",
    risk: "none",
    description: "Read a specific block by number (or the latest) — timestamp, transaction count, gas used and limit.",
    inputSchema: {
      type: "object",
      properties: {
        blockNumber: { type: "string", pattern: "^[0-9]+$", description: "decimal block number; omit for latest" },
      },
    },
  },

  // ── Explorer reads — what HAPPENED, indexed by Blockscout ─────────────────
  // The RPC answers "what is the chain right now"; these answer history:
  // holders, activity, volume, verification. Every one reports reachable:false
  // with a reason when the explorer cannot be read, and a finch must say so.
  {
    name: "chain_stats",
    mode: "read",
    category: "explorer",
    risk: "none",
    description:
      "Whole-chain counters from the explorer: total blocks, total transactions, total addresses, transactions today, average block time, slow/average/fast gas in gwei, ETH price in USD.",
    inputSchema: { type: "object", properties: {  } },
  },
  {
    name: "wallet_profile",
    mode: "read",
    category: "explorer",
    risk: "none",
    description:
      "Who an address is: native ETH balance, whether it is a contract (and verified), explorer label, scam flag, creator and creation tx for contracts, lifetime transaction count and token-transfer count.",
    inputSchema: { type: "object", properties: { address }, required: ["address"] },
  },
  {
    name: "wallet_transactions",
    mode: "read",
    category: "explorer",
    risk: "none",
    description:
      "Most recent transactions sent to or from an address, newest first: hash, block, time, status, method, counterparty, value and fee in ETH.",
    inputSchema: { type: "object", properties: { address, limit: { type: "string", pattern: "^[0-9]{1,2}$", description: "how many rows, 1-50; default 10" } }, required: ["address"] },
  },
  {
    name: "wallet_holdings",
    mode: "read",
    category: "explorer",
    risk: "none",
    description:
      "Every ERC-20 an address holds, with balance, USD price where the explorer has one, and USD value. Tokens with no price report null rather than a guess.",
    inputSchema: { type: "object", properties: { address }, required: ["address"] },
  },
  {
    name: "token_profile",
    mode: "read",
    category: "explorer",
    risk: "none",
    description:
      "A token as the explorer indexes it: name, symbol, decimals, holder count, total supply, USD price, market cap, 24h volume.",
    inputSchema: { type: "object", properties: { token: address }, required: ["token"] },
  },
  {
    name: "token_holders",
    mode: "read",
    category: "explorer",
    risk: "none",
    description:
      "Largest holders of a token, largest first, each with balance, share of total supply in percent, and whether the holder is a contract. Also the total holder count.",
    inputSchema: { type: "object", properties: { token: address, limit: { type: "string", pattern: "^[0-9]{1,2}$", description: "how many rows, 1-50; default 10" } }, required: ["token"] },
  },
  {
    name: "token_transfers",
    mode: "read",
    category: "explorer",
    risk: "none",
    description:
      "Most recent transfers of a token, newest first: tx, block, time, from, to, amount.",
    inputSchema: { type: "object", properties: { token: address, limit: { type: "string", pattern: "^[0-9]{1,2}$", description: "how many rows, 1-50; default 10" } }, required: ["token"] },
  },
  {
    name: "token_list",
    mode: "read",
    category: "explorer",
    risk: "none",
    description:
      "ERC-20 tokens the explorer ranks on Robinhood Chain, with holders, USD price, market cap and 24h volume where known.",
    inputSchema: { type: "object", properties: { limit: { type: "string", pattern: "^[0-9]{1,2}$", description: "how many rows, 1-50; default 10" } } },
  },
  {
    name: "tx_lookup",
    mode: "read",
    category: "explorer",
    risk: "none",
    description:
      "One transaction by hash: status, block, time, confirmations, method, from, to, created contract, value and fee in ETH.",
    inputSchema: { type: "object", properties: { hash: { type: "string", pattern: "^0x[a-fA-F0-9]{64}$", description: "transaction hash" } }, required: ["hash"] },
  },
  {
    name: "contract_verified",
    mode: "read",
    category: "explorer",
    risk: "none",
    description:
      "Whether a contract's source code is published and verified on the explorer, and if so its name, compiler and language. Unverified is a definite answer, not an error.",
    inputSchema: { type: "object", properties: { address }, required: ["address"] },
  },
  {
    name: "balance_native",
    mode: "read",
    category: "balances",
    risk: "none",
    description: "Read the native balance of an address on Robinhood Chain.",
    inputSchema: { type: "object", properties: { address }, required: ["address"] },
  },
  {
    name: "balance_erc20",
    mode: "read",
    category: "balances",
    risk: "none",
    description: "Read an ERC20 token balance for a holder.",
    inputSchema: { type: "object", properties: { token: address, holder: address }, required: ["token", "holder"] },
  },
  {
    name: "token_data",
    mode: "read",
    category: "tokens",
    risk: "none",
    description: "Read ERC20 metadata: name, symbol, decimals, total supply.",
    inputSchema: { type: "object", properties: { token: address }, required: ["token"] },
  },
  {
    name: "portfolio_snapshot",
    mode: "read",
    category: "portfolio",
    risk: "none",
    description: "Snapshot the native + ERC20 balances of an address for a given token list.",
    inputSchema: {
      type: "object",
      properties: { address, tokens: { type: "array", items: address, description: "ERC20 addresses to include" } },
      required: ["address"],
    },
  },
  {
    name: "contract_read",
    mode: "read",
    category: "contracts",
    risk: "none",
    description: "Call a read-only contract function with an inline ABI fragment.",
    inputSchema: {
      type: "object",
      properties: {
        address,
        abi: { type: "array", description: "ABI fragment containing the function" },
        functionName: { type: "string" },
        args: { type: "array" },
      },
      required: ["address", "abi", "functionName"],
    },
  },
  {
    name: "transfer_native",
    mode: "write",
    category: "transfers",
    risk: "high",
    description: "Transfer native currency. Simulated first; bounded by wallet allowances; logged.",
    inputSchema: { type: "object", properties: { to: address, amount: decimalAmount }, required: ["to", "amount"] },
  },
  {
    name: "transfer_erc20",
    mode: "write",
    category: "transfers",
    risk: "high",
    description: "Transfer an ERC20 token. Simulated first; bounded by wallet allowances; logged.",
    inputSchema: {
      type: "object",
      properties: { token: address, to: address, amount: decimalAmount },
      required: ["token", "to", "amount"],
    },
  },
  {
    name: "erc20_approve",
    mode: "write",
    category: "erc20",
    risk: "high",
    description: "Approve a spender for an ERC20 amount. Approvals count against allowances.",
    inputSchema: {
      type: "object",
      properties: { token: address, spender: address, amount: decimalAmount },
      required: ["token", "spender", "amount"],
    },
  },
  {
    name: "contract_write",
    mode: "write",
    category: "contracts",
    risk: "high",
    description: "Call a state-changing contract function. Target must be on the contract allowlist.",
    inputSchema: {
      type: "object",
      properties: {
        address,
        abi: { type: "array" },
        functionName: { type: "string" },
        args: { type: "array" },
        valueWei: { type: "string", pattern: "^[0-9]+$", description: "native value in wei" },
      },
      required: ["address", "abi", "functionName"],
    },
  },
  {
    name: "swap_exact_in",
    mode: "write",
    category: "swaps",
    risk: "high",
    description: "Swap an exact input amount via the configured venue, with a minimum-output slippage bound.",
    inputSchema: {
      type: "object",
      properties: {
        tokenIn: address,
        tokenOut: address,
        amountIn: decimalAmount,
        minAmountOut: decimalAmount,
      },
      required: ["tokenIn", "tokenOut", "amountIn", "minAmountOut"],
    },
  },
  {
    name: "pons_status",
    mode: "read",
    category: "pons",
    risk: "none",
    description: "Report Pons integration status and Finch's creator-tax configuration.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "pons_creator_tax",
    mode: "read",
    category: "pons",
    risk: "none",
    description: "Compute the Finch creator tax (3%) on a gross volume. Pons' own protocol fee is separate and not Finch revenue.",
    inputSchema: {
      type: "object",
      properties: { volumeWei: { type: "string", pattern: "^[0-9]+$" } },
      required: ["volumeWei"],
    },
  },
  {
    name: "rwa_registry",
    mode: "read",
    category: "rwa",
    risk: "none",
    description: "List RWA assets approved for agent interaction, with issuer restrictions.",
    inputSchema: { type: "object", properties: {} },
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
        asset: address,
        action: { type: "string", enum: ["transfer", "approve"] },
        counterparty: address,
        amount: decimalAmount,
      },
      required: ["asset", "action", "counterparty", "amount"],
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

/** Optional row limit, clamped to the explorer's page size. */
function lim(args: Record<string, unknown>, fallback = 10): number {
  const raw = typeof args.limit === "string" ? Number(args.limit) : Number.NaN;
  return Number.isFinite(raw) && raw >= 1 ? Math.min(raw, 50) : fallback;
}

/**
 * Present an explorer result to a model. Data is spread to the top level (or
 * under `key` when it is a list) so the useful part is not buried, while
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

function addr(args: Record<string, unknown>, key: string): Address {
  const value = str(args, key);
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`tool argument "${key}" is not a valid address`);
  return value as Address;
}

/** Bind the catalog to a live Flightpath instance for the Finch runtime. */
export function createFlightpathTools(fp: Flightpath, selection?: string[]): ExecutableTool[] {
  const metas = FLIGHTPATH_TOOLS.filter((meta) => !selection || selection.includes(meta.name));

  const bindings: Record<string, (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<unknown>> = {
    network_status: async () => {
      const status = await getNetworkStatus(fp.target);
      return {
        chainId: status.chainId,
        chainName: status.chainName,
        stack: status.stack,
        reachable: status.reachable,
        blockNumber: status.blockNumber,
        blockTimestamp: status.blockTimestamp,
        blockTimeSeconds: status.blockTimeSeconds,
        transactionsInLatestBlock: status.transactionsInLatestBlock,
        gasPriceGwei: status.gasPriceGwei,
        rpcLatencyMs: status.latencyMs,
        error: status.error ?? null,
      };
    },
    // Explorer reads return the whole result — reachable, error, source — so a
    // finch sees a failed read as a failed read, never as an empty dataset.
    chain_stats: async () => flat(await readChainStats(fp.target)),
    wallet_profile: async (args) => flat(await readWalletProfile(addr(args, "address"), fp.target)),
    wallet_transactions: async (args) =>
      flat(await readWalletTransactions(addr(args, "address"), lim(args), fp.target), "transactions"),
    wallet_holdings: async (args) => flat(await readWalletHoldings(addr(args, "address"), fp.target), "holdings"),
    token_profile: async (args) => flat(await readTokenProfile(addr(args, "token"), fp.target)),
    token_holders: async (args) => flat(await readTokenHolders(addr(args, "token"), lim(args), fp.target)),
    token_transfers: async (args) => flat(await readTokenTransfers(addr(args, "token"), lim(args), fp.target), "transfers"),
    token_list: async (args) => flat(await readTokenList(lim(args, 20), fp.target), "tokens"),
    tx_lookup: async (args) => {
      const hash = str(args, "hash");
      if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new Error('tool argument "hash" is not a transaction hash');
      return flat(await readTransaction(hash, fp.target));
    },
    contract_verified: async (args) => flat(await readContractVerification(addr(args, "address"), fp.target)),
    block_read: async (args) => {
      const blockNumber = typeof args.blockNumber === "string" ? BigInt(args.blockNumber) : undefined;
      const block = await fp.publicClient.getBlock(
        blockNumber !== undefined ? { blockNumber, includeTransactions: false } : { blockTag: "latest", includeTransactions: false },
      );
      return {
        number: block.number.toString(),
        timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
        transactions: block.transactions.length,
        gasUsed: block.gasUsed.toString(),
        gasLimit: block.gasLimit.toString(),
        explorerUrl: explorerBlockUrl(block.number, fp.target),
      };
    },
    balance_native: async (args) => fp.nativeBalance(addr(args, "address")),
    balance_erc20: async (args) => fp.erc20Balance(addr(args, "token"), addr(args, "holder")),
    token_data: async (args) => fp.tokenData(addr(args, "token")),
    portfolio_snapshot: async (args) =>
      fp.portfolio(addr(args, "address"), Array.isArray(args.tokens) ? (args.tokens as Address[]) : []),
    contract_read: async (args) =>
      fp.contractRead({
        address: addr(args, "address"),
        abi: args.abi as never,
        functionName: str(args, "functionName"),
        args: (args.args as readonly unknown[] | undefined) ?? [],
      }),
    transfer_native: async (args, ctx) =>
      fp.transferNative({ id: ctx.executionId, to: addr(args, "to"), amount: parseUnits(str(args, "amount"), 18) }),
    transfer_erc20: async (args, ctx) => {
      const token = addr(args, "token");
      const meta = await fp.tokenData(token);
      return fp.transferErc20({
        id: ctx.executionId,
        token,
        to: addr(args, "to"),
        amount: parseUnits(str(args, "amount"), meta.decimals),
      });
    },
    erc20_approve: async (args, ctx) => {
      const token = addr(args, "token");
      const meta = await fp.tokenData(token);
      return fp.approveErc20({
        id: ctx.executionId,
        token,
        spender: addr(args, "spender"),
        amount: parseUnits(str(args, "amount"), meta.decimals),
      });
    },
    contract_write: async (args, ctx) =>
      fp.contractWrite({
        id: ctx.executionId,
        address: addr(args, "address"),
        abi: args.abi as never,
        functionName: str(args, "functionName"),
        args: (args.args as readonly unknown[] | undefined) ?? [],
        value: typeof args.valueWei === "string" ? BigInt(args.valueWei) : undefined,
      }),
    swap_exact_in: async (args, ctx) => {
      const tokenIn = addr(args, "tokenIn");
      const tokenOut = addr(args, "tokenOut");
      const [inMeta, outMeta] = await Promise.all([fp.tokenData(tokenIn), fp.tokenData(tokenOut)]);
      return fp.swapExactIn({
        id: ctx.executionId,
        tokenIn,
        tokenOut,
        amountIn: parseUnits(str(args, "amountIn"), inMeta.decimals),
        minAmountOut: parseUnits(str(args, "minAmountOut"), outMeta.decimals),
      });
    },
    pons_status: async () => {
      const config = getPonsConfig();
      return {
        configured: config.configured,
        creatorTaxBps: Number(FINCH_CREATOR_TAX_BPS),
        feeRecipient: config.feeRecipient ?? null,
        note: "Finch revenue is the 3% creator tax only; Pons' protocol fee is separate.",
      };
    },
    pons_creator_tax: async (args) => {
      const volume = BigInt(str(args, "volumeWei"));
      return { volumeWei: volume.toString(), creatorTaxWei: creatorTaxOn(volume).toString(), bps: Number(FINCH_CREATOR_TAX_BPS) };
    },
    rwa_registry: async () => loadApprovedRwaAssets(),
    rwa_interact: async (args, ctx) => {
      const asset = addr(args, "asset");
      const meta = await fp.tokenData(asset);
      const action = str(args, "action");
      if (action !== "transfer" && action !== "approve") throw new Error(`unsupported RWA action "${action}"`);
      return fp.rwaInteract({
        id: ctx.executionId,
        asset,
        action,
        counterparty: addr(args, "counterparty"),
        amount: parseUnits(str(args, "amount"), meta.decimals),
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
