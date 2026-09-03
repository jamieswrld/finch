import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  type Abi,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  explorerAddressUrl,
  explorerTxUrl,
  getFlightpathTarget,
  type FlightpathTarget,
} from "./chain.ts";
import { executeIntent, resumeApprovedIntent, type ExecutionContext } from "./execution.ts";
import { MemorySpendTracker, OBSERVER_POLICY, PolicyEngine, type SpendTracker, type WalletPolicy } from "./policy.ts";
import {
  MemoryExecutionSink,
  type ExecutionRecord,
  type ExecutionSink,
  type PortfolioSnapshot,
  type TokenBalance,
  type TokenData,
} from "./types.ts";

export class FlightpathConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlightpathConfigError";
  }
}

export interface SwapVenueConfig {
  /** Router contract address. Must also be present on the policy contract allowlist. */
  router: Address;
  kind: "uniswap-v2";
  label: string;
}

export interface FlightpathOptions {
  target?: FlightpathTarget;
  /**
   * Private key of the RESTRICTED OPERATOR WALLET only — funded from the
   * treasury with a bounded float (see contracts/OperatorBudget.sol).
   * NEVER the treasury key. Server-side environments only; typically
   * process.env.FLIGHTPATH_OPERATOR_KEY.
   */
  operatorKey?: Hex;
  /** Pre-built operator account (alternative to operatorKey). Server-side only. */
  account?: Account;
  policy?: WalletPolicy;
  sink?: ExecutionSink;
  agentId?: string;
  swapVenue?: SwapVenueConfig;
  rwaApprovedAssets?: Address[];
  confirmations?: number;
  /**
   * Shared spend accounting. Pass a durable implementation in production so a
   * daily allowance survives process restarts and is not reset by re-hatching.
   */
  spendTracker?: SpendTracker;
}

export interface TransferParams {
  id: string;
  to: Address;
  /** Amount in wei / smallest unit. */
  amount: bigint;
}

export interface Erc20TransferParams extends TransferParams {
  token: Address;
}

export interface ApproveParams {
  id: string;
  token: Address;
  spender: Address;
  amount: bigint;
}

export interface ContractWriteParams {
  id: string;
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  summary?: string;
}

export interface SwapExactInParams {
  id: string;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  /** Minimum acceptable output after slippage, in tokenOut smallest units. */
  minAmountOut: bigint;
  recipient?: Address;
  deadlineSeconds?: number;
}

const UNISWAP_V2_ROUTER_ABI = [
  {
    type: "function",
    name: "swapExactTokensForTokens",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const satisfies Abi;

export class Flightpath {
  readonly target: FlightpathTarget;
  readonly publicClient: PublicClient;
  readonly walletClient?: WalletClient;
  readonly account?: Account;
  readonly policyEngine: PolicyEngine;
  readonly spendTracker: SpendTracker;
  readonly sink: ExecutionSink;
  private readonly options: FlightpathOptions;
  private readonly tokenMetaCache = new Map<string, TokenData>();

  constructor(options: FlightpathOptions = {}) {
    this.options = options;
    this.target = options.target ?? getFlightpathTarget();
    // Failover transport from the target — never a bare single endpoint.
    this.publicClient = createPublicClient({
      chain: this.target.chain,
      transport: this.target.transport,
    }) as PublicClient;

    if (options.operatorKey || options.account) {
      if (typeof (globalThis as { window?: unknown }).window !== "undefined") {
        throw new FlightpathConfigError("operator keys must never be constructed in a browser environment");
      }
      this.account = options.account ?? privateKeyToAccount(options.operatorKey!);
      this.walletClient = createWalletClient({
        chain: this.target.chain,
        transport: this.target.transport,
        account: this.account,
      }) as WalletClient;
    }

    // The spend tracker is SHARED, not per-instance: re-hatching a finch or
    // calling derive() must not hand it a fresh daily allowance.
    this.spendTracker = options.spendTracker ?? new MemorySpendTracker();
    this.policyEngine = new PolicyEngine(options.policy ?? OBSERVER_POLICY, this.spendTracker, {
      rwaApprovedAssets: options.rwaApprovedAssets,
    });
    this.sink = options.sink ?? new MemoryExecutionSink();
  }

  get operatorAddress(): Address | undefined {
    return this.account?.address;
  }

  /**
   * Create a sibling Flightpath on the same target and account, with different
   * policy/sink/agent bindings. Used at hatch time to bind a host-owned signer
   * to a manifest-derived policy — the private key never surfaces.
   */
  derive(
    overrides: Partial<Pick<FlightpathOptions, "policy" | "sink" | "agentId" | "swapVenue" | "rwaApprovedAssets" | "confirmations">>,
  ): Flightpath {
    return new Flightpath({
      ...this.options,
      operatorKey: undefined,
      account: this.account,
      target: this.target,
      // Carry the tracker forward, or a derived finch starts its day fresh.
      spendTracker: this.spendTracker,
      ...overrides,
    });
  }

  private context(): ExecutionContext {
    return {
      publicClient: this.publicClient,
      walletClient: this.walletClient,
      account: this.account,
      chain: this.target.chain,
      policy: this.policyEngine,
      sink: this.sink,
      agentId: this.options.agentId,
      confirmations: this.options.confirmations,
    };
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async nativeBalance(address: Address): Promise<TokenBalance> {
    const raw = await this.publicClient.getBalance({ address });
    return {
      asset: "native",
      symbol: this.target.chain.nativeCurrency.symbol,
      decimals: this.target.chain.nativeCurrency.decimals,
      raw: raw.toString(),
      formatted: formatUnits(raw, this.target.chain.nativeCurrency.decimals),
    };
  }

  async tokenData(token: Address): Promise<TokenData> {
    const cached = this.tokenMetaCache.get(token.toLowerCase());
    if (cached) return cached;
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
      this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
      this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
      this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }),
    ]);
    const data: TokenData = {
      address: token,
      name: name as string,
      symbol: symbol as string,
      decimals: Number(decimals),
      totalSupply: (totalSupply as bigint).toString(),
    };
    this.tokenMetaCache.set(token.toLowerCase(), data);
    return data;
  }

  async erc20Balance(token: Address, holder: Address): Promise<TokenBalance> {
    const [meta, raw] = await Promise.all([
      this.tokenData(token),
      this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [holder] }),
    ]);
    return {
      asset: token,
      symbol: meta.symbol,
      decimals: meta.decimals,
      raw: (raw as bigint).toString(),
      formatted: formatUnits(raw as bigint, meta.decimals),
    };
  }

  async portfolio(address: Address, tokens: Address[] = []): Promise<PortfolioSnapshot> {
    const native = await this.nativeBalance(address);
    const erc20s = await Promise.all(tokens.map((token) => this.erc20Balance(token, address)));
    return {
      address,
      chainId: this.target.chain.id,
      fetchedAt: new Date().toISOString(),
      balances: [native, ...erc20s],
    };
  }

  async contractRead(params: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }): Promise<unknown> {
    return this.publicClient.readContract({
      address: params.address,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args as readonly unknown[] | undefined,
    });
  }

  // ── Writes — every one flows through executeIntent ───────────────────────

  async transferNative(params: TransferParams): Promise<ExecutionRecord> {
    return executeIntent(this.context(), params.id, {
      kind: "transfer.native",
      summary: `transfer ${formatUnits(params.amount, 18)} ${this.target.chain.nativeCurrency.symbol} → ${params.to}`,
      to: params.to,
      value: params.amount,
      spendAsset: "native",
      spendAmount: params.amount,
      meta: { recipient: params.to },
    });
  }

  async transferErc20(params: Erc20TransferParams): Promise<ExecutionRecord> {
    const meta = await this.tokenData(params.token);
    return executeIntent(this.context(), params.id, {
      kind: "transfer.erc20",
      summary: `transfer ${formatUnits(params.amount, meta.decimals)} ${meta.symbol} → ${params.to}`,
      to: params.token,
      value: 0n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [params.to, params.amount] }),
      spendAsset: params.token,
      spendAmount: params.amount,
      meta: { recipient: params.to, token: params.token },
    });
  }

  async approveErc20(params: ApproveParams): Promise<ExecutionRecord> {
    const meta = await this.tokenData(params.token);
    return executeIntent(this.context(), params.id, {
      kind: "erc20.approve",
      summary: `approve ${formatUnits(params.amount, meta.decimals)} ${meta.symbol} for ${params.spender}`,
      to: params.token,
      value: 0n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [params.spender, params.amount] }),
      // Approvals are treated as spends against the allowance — an approval
      // is spendable authority even before transferFrom happens.
      spendAsset: params.token,
      spendAmount: params.amount,
      meta: { spender: params.spender, token: params.token },
    });
  }

  async contractWrite(params: ContractWriteParams): Promise<ExecutionRecord> {
    const data = encodeFunctionData({
      abi: params.abi,
      functionName: params.functionName,
      args: params.args as readonly unknown[] | undefined,
    });
    return executeIntent(this.context(), params.id, {
      kind: "contract.write",
      summary: params.summary ?? `call ${params.functionName} on ${params.address}`,
      to: params.address,
      value: params.value ?? 0n,
      data,
      spendAsset: "native",
      spendAmount: params.value ?? 0n,
      meta: { functionName: params.functionName },
    });
  }

  async swapExactIn(params: SwapExactInParams): Promise<ExecutionRecord> {
    const venue = this.options.swapVenue;
    if (!venue) {
      throw new FlightpathConfigError(
        "no swap venue configured for this target — set swapVenue (router address + kind) once a Robinhood Chain venue is published",
      );
    }
    if (!this.account && !params.recipient) {
      throw new FlightpathConfigError("swapExactIn requires an operator account or an explicit recipient");
    }
    const [tokenInMeta, tokenOutMeta] = await Promise.all([this.tokenData(params.tokenIn), this.tokenData(params.tokenOut)]);
    const recipient = params.recipient ?? this.account!.address;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + (params.deadlineSeconds ?? 600));
    const data = encodeFunctionData({
      abi: UNISWAP_V2_ROUTER_ABI,
      functionName: "swapExactTokensForTokens",
      args: [params.amountIn, params.minAmountOut, [params.tokenIn, params.tokenOut], recipient, deadline],
    });
    return executeIntent(this.context(), params.id, {
      kind: "swap.exactIn",
      summary: `swap ${formatUnits(params.amountIn, tokenInMeta.decimals)} ${tokenInMeta.symbol} → ≥ ${formatUnits(
        params.minAmountOut,
        tokenOutMeta.decimals,
      )} ${tokenOutMeta.symbol} via ${venue.label}`,
      to: venue.router,
      value: 0n,
      data,
      spendAsset: params.tokenIn,
      spendAmount: params.amountIn,
      meta: { venue: venue.label, tokenIn: params.tokenIn, tokenOut: params.tokenOut, recipient },
    });
  }

  /**
   * Interact with an approved RWA token. Uses intent kind "rwa.interact" so the
   * PolicyEngine hard-checks the approved registry — an agent cannot reach
   * arbitrary permissioned assets through this path.
   */
  async rwaInteract(params: {
    id: string;
    asset: Address;
    action: "transfer" | "approve";
    counterparty: Address;
    amount: bigint;
  }): Promise<ExecutionRecord> {
    const meta = await this.tokenData(params.asset);
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: params.action,
      args: [params.counterparty, params.amount],
    });
    return executeIntent(this.context(), params.id, {
      kind: "rwa.interact",
      summary: `RWA ${params.action}: ${formatUnits(params.amount, meta.decimals)} ${meta.symbol} ↔ ${params.counterparty}`,
      to: params.asset,
      value: 0n,
      data,
      spendAsset: params.asset,
      spendAmount: params.amount,
      meta: { action: params.action, counterparty: params.counterparty },
    });
  }

  /**
   * Resume an execution held at the approval gate. The intent comes from the
   * stored record, so what gets executed is exactly what was approved.
   */
  async resumeApproved(id: string, approvedBy: string): Promise<ExecutionRecord> {
    const record = await this.sink.get(id);
    if (!record) throw new FlightpathConfigError(`no execution record with id ${id}`);
    return resumeApprovedIntent(this.context(), id, approvedBy);
  }

  txExplorerUrl(hash: Hex): string | null {
    return explorerTxUrl(hash, this.target);
  }

  addressExplorerUrl(address: Address): string | null {
    return explorerAddressUrl(address, this.target);
  }
}

export function createFlightpath(options: FlightpathOptions = {}): Flightpath {
  return new Flightpath(options);
}
