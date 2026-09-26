import {
  createKeyPairSignerFromBytes,
  createNoopSigner,
  getBase58Encoder,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { findAssociatedTokenPda, getApproveCheckedInstruction, getTransferCheckedInstruction } from "@solana-program/token";
import { explorerAddressUrl, explorerTxUrl, getFlightpathTarget, type FlightpathTarget } from "./chain.ts";
import {
  formatUnits,
  isSignerRole,
  isSolanaAddress,
  serializeInstruction,
  SOL_DECIMALS,
  WSOL_MINT,
  type SerializedAccountMeta,
  type SerializedInstruction,
} from "./codec.ts";
import { executeIntent, resumeApprovedIntent, type ExecutionContext } from "./execution.ts";
import { readMintInfo } from "./explorer.ts";
import { fetchSwapInstructions, readSwapQuote } from "./market.ts";
import { COMPUTE_BUDGET_PROGRAM, JUPITER_PROGRAM, MemorySpendTracker, OBSERVER_POLICY, PolicyEngine, type SpendTracker, type WalletPolicy } from "./policy.ts";
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

export interface FlightpathOptions {
  target?: FlightpathTarget;
  /**
   * Secret key of the RESTRICTED OPERATOR WALLET only — funded from the
   * treasury with a bounded float. NEVER the treasury key. Server-side
   * environments only; typically process.env.FLIGHTPATH_OPERATOR_KEY, as a
   * base58 64-byte secret key or a JSON array of 64 numbers.
   */
  operatorKey?: string;
  /** Pre-built operator signer (alternative to operatorKey). Server-side only. */
  signer?: KeyPairSigner | Promise<KeyPairSigner>;
  policy?: WalletPolicy;
  sink?: ExecutionSink;
  agentId?: string;
  rwaApprovedAssets?: string[];
  confirmationTimeoutMs?: number;
  /**
   * Shared spend accounting. Pass a durable implementation in production so a
   * daily allowance survives process restarts and is not reset by re-hatching.
   */
  spendTracker?: SpendTracker;
  /**
   * Prepare transactions for this address to sign in its own wallet instead
   * of signing server-side. No key is involved; execution parks at
   * awaiting_signature with the exact instructions.
   */
  externalSigner?: string;
}

export interface TransferParams {
  id: string;
  to: string;
  /** Amount in lamports / the mint's smallest unit. */
  amount: bigint;
}

export interface SplTransferParams extends TransferParams {
  mint: string;
}

export interface ApproveParams {
  id: string;
  mint: string;
  delegate: string;
  amount: bigint;
}

export interface ProgramInvokeParams {
  id: string;
  programAddress: string;
  accounts: SerializedAccountMeta[];
  /** Instruction data, base64. */
  data: string;
  summary?: string;
}

export interface SwapExactInParams {
  id: string;
  inputMint: string;
  outputMint: string;
  amountIn: bigint;
  /** Maximum slippage in basis points; the quote's minimum output enforces it on chain. */
  slippageBps: number;
}

/** Decode FLIGHTPATH_OPERATOR_KEY-style secrets: base58 or a JSON byte array. */
export function secretKeyBytes(secret: string): Uint8Array {
  const trimmed = secret.trim();
  const bytes = trimmed.startsWith("[")
    ? Uint8Array.from(JSON.parse(trimmed) as number[])
    : new Uint8Array(getBase58Encoder().encode(trimmed));
  if (bytes.length !== 64) throw new FlightpathConfigError("operator key must be a 64-byte Solana secret key");
  return bytes;
}

export class Flightpath {
  readonly target: FlightpathTarget;
  readonly policyEngine: PolicyEngine;
  readonly spendTracker: SpendTracker;
  readonly sink: ExecutionSink;
  private readonly options: FlightpathOptions;
  private readonly signerPromise?: Promise<KeyPairSigner>;
  private readonly tokenMetaCache = new Map<string, TokenData>();

  constructor(options: FlightpathOptions = {}) {
    this.options = options;
    this.target = options.target ?? getFlightpathTarget();

    if (options.operatorKey || options.signer) {
      if (typeof (globalThis as { window?: unknown }).window !== "undefined") {
        throw new FlightpathConfigError("operator keys must never be constructed in a browser environment");
      }
      this.signerPromise = options.signer
        ? Promise.resolve(options.signer)
        : createKeyPairSignerFromBytes(secretKeyBytes(options.operatorKey!));
      // A malformed key surfaces when a write needs it, not as an unhandled rejection.
      this.signerPromise.catch(() => {});
    }

    // The spend tracker is SHARED, not per-instance: re-hatching a finch or
    // calling derive() must not hand it a fresh daily allowance.
    this.spendTracker = options.spendTracker ?? new MemorySpendTracker();
    this.policyEngine = new PolicyEngine(options.policy ?? OBSERVER_POLICY, this.spendTracker, {
      rwaApprovedAssets: options.rwaApprovedAssets,
    });
    this.sink = options.sink ?? new MemoryExecutionSink();
  }

  /**
   * The policy this Flightpath was granted. Exposed so a caller binding an
   * untrusted manifest can intersect against it instead of replacing it.
   */
  get policy(): WalletPolicy {
    return this.options.policy ?? OBSERVER_POLICY;
  }

  /** The operator's public address, when this process holds an operator key. */
  async operatorAddress(): Promise<string | undefined> {
    return (await this.signerPromise)?.address;
  }

  /**
   * Create a sibling Flightpath on the same target and signer, with different
   * policy/sink/agent bindings. Used at hatch time to bind a host-owned signer
   * to a manifest-derived policy — the secret key never surfaces.
   */
  derive(
    overrides: Partial<Pick<FlightpathOptions, "policy" | "sink" | "agentId" | "rwaApprovedAssets" | "confirmationTimeoutMs" | "externalSigner">>,
  ): Flightpath {
    return new Flightpath({
      ...this.options,
      operatorKey: undefined,
      signer: this.signerPromise,
      target: this.target,
      // Carry the tracker forward, or a derived finch starts its day fresh.
      spendTracker: this.spendTracker,
      ...overrides,
    });
  }

  private async context(): Promise<ExecutionContext> {
    const signer = this.options.externalSigner ? undefined : await this.signerPromise;
    return {
      target: this.target,
      signer,
      policy: this.policyEngine,
      sink: this.sink,
      agentId: this.options.agentId,
      confirmationTimeoutMs: this.options.confirmationTimeoutMs,
      signing: this.options.externalSigner ? "external" : signer ? "server" : undefined,
      externalSigner: this.options.externalSigner,
    };
  }

  /** Whoever will pay for and sign writes, or null in observer mode. */
  private async payer(): Promise<string | null> {
    if (this.options.externalSigner) return this.options.externalSigner;
    return (await this.signerPromise)?.address ?? null;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async nativeBalance(address: string): Promise<TokenBalance> {
    requireAddress(address, "address");
    const { value } = await this.target.rpc.getBalance(address as Address, { commitment: "confirmed" }).send();
    const raw = BigInt(value);
    return { asset: "native", symbol: "SOL", decimals: SOL_DECIMALS, raw: raw.toString(), formatted: formatUnits(raw, SOL_DECIMALS) };
  }

  async tokenData(mint: string): Promise<TokenData> {
    requireAddress(mint, "mint");
    const cached = this.tokenMetaCache.get(mint);
    if (cached) return cached;
    const result = await readMintInfo(mint, this.target);
    if (!result.reachable || !result.data) throw new Error(result.error ?? `could not read mint ${mint}`);
    const info = result.data;
    const data: TokenData = {
      mint,
      tokenProgram: info.tokenProgram,
      name: info.name,
      symbol: info.symbol,
      decimals: info.decimals,
      supply: info.supply,
      mintAuthority: info.mintAuthority,
      freezeAuthority: info.freezeAuthority,
    };
    this.tokenMetaCache.set(mint, data);
    return data;
  }

  /** Total balance of one mint across every token account the holder owns. */
  async splBalance(mint: string, holder: string): Promise<TokenBalance> {
    requireAddress(holder, "holder");
    const meta = await this.tokenData(mint);
    const { value } = await this.target.rpc
      .getTokenAccountsByOwner(holder as Address, { mint: mint as Address }, { encoding: "jsonParsed", commitment: "confirmed" })
      .send();
    let raw = 0n;
    for (const entry of value) {
      const parsed = (entry.account.data as unknown as { parsed?: { info?: { tokenAmount?: { amount?: string } } } }).parsed;
      raw += BigInt(parsed?.info?.tokenAmount?.amount ?? "0");
    }
    return { asset: mint, symbol: meta.symbol, decimals: meta.decimals, raw: raw.toString(), formatted: formatUnits(raw, meta.decimals) };
  }

  async portfolio(address: string, mints: string[] = []): Promise<PortfolioSnapshot> {
    const native = await this.nativeBalance(address);
    const tokens = await Promise.all(mints.map((mint) => this.splBalance(mint, address)));
    return { address, chain: this.target.chain, fetchedAt: new Date().toISOString(), balances: [native, ...tokens] };
  }

  /** Raw account read: owner, lamports, executable, size, and parsed data where the node can parse it. */
  async accountRead(address: string): Promise<Record<string, unknown>> {
    requireAddress(address, "address");
    const { value } = await this.target.rpc
      .getAccountInfo(address as Address, { encoding: "jsonParsed", commitment: "confirmed" })
      .send();
    if (!value) return { address, exists: false };
    const data = value.data as unknown;
    const parsed = typeof data === "object" && data !== null && !Array.isArray(data) ? (data as { parsed?: unknown; program?: string }) : null;
    const raw = Array.isArray(data) ? (data as [string, string]) : null;
    return {
      address,
      exists: true,
      owner: value.owner,
      lamports: value.lamports.toString(),
      sol: formatUnits(BigInt(value.lamports), SOL_DECIMALS),
      executable: value.executable,
      dataLength: Number(value.space),
      parsedBy: parsed?.program ?? null,
      parsed: parsed?.parsed ?? null,
      // Unparsed data is shown as a prefix: enough to recognise a layout,
      // not a megabyte of base64 handed to a model.
      dataBase64Prefix: raw ? raw[0].slice(0, 256) : null,
    };
  }

  // ── Writes — every one flows through executeIntent ───────────────────────

  async transferNative(params: TransferParams): Promise<ExecutionRecord> {
    requireAddress(params.to, "to");
    const payer = await this.payer();
    const instructions = payer
      ? [serializeInstruction(getTransferSolInstruction({ source: createNoopSigner(payer as Address), destination: params.to as Address, amount: params.amount }))]
      : [];
    const amount = formatUnits(params.amount, SOL_DECIMALS);
    return executeIntent(await this.context(), params.id, {
      kind: "transfer.native",
      summary: `transfer ${amount} SOL → ${params.to}`,
      to: params.to,
      instructions,
      spendAsset: "native",
      spendAmount: params.amount,
      meta: { recipient: params.to, amount, symbol: "SOL", decimals: String(SOL_DECIMALS) },
    });
  }

  /** The recipient's token account for a mint must exist; creating one would spend rent outside any allowance. */
  private async tokenAccounts(owner: string, counterparty: string, meta: TokenData): Promise<{ source: Address; destination: Address }> {
    const tokenProgram = meta.tokenProgram as Address;
    const [[source], [destination]] = await Promise.all([
      findAssociatedTokenPda({ owner: owner as Address, mint: meta.mint as Address, tokenProgram }),
      findAssociatedTokenPda({ owner: counterparty as Address, mint: meta.mint as Address, tokenProgram }),
    ]);
    return { source, destination };
  }

  private async requireTokenAccount(account: Address, owner: string, meta: TokenData): Promise<void> {
    const { value } = await this.target.rpc.getAccountInfo(account, { encoding: "base64", commitment: "confirmed" }).send();
    if (!value) {
      throw new FlightpathConfigError(
        `${owner} has no ${meta.symbol ?? meta.mint} token account yet. Flightpath does not create one on their behalf — that spends rent outside any allowance — so they need to create it (or receive the token once) first.`,
      );
    }
  }

  async transferSpl(params: SplTransferParams): Promise<ExecutionRecord> {
    requireAddress(params.to, "to");
    const meta = await this.tokenData(params.mint);
    const payer = await this.payer();
    let instructions: SerializedInstruction[] = [];
    if (payer) {
      const { source, destination } = await this.tokenAccounts(payer, params.to, meta);
      await this.requireTokenAccount(destination, params.to, meta);
      instructions = [
        serializeInstruction(
          getTransferCheckedInstruction(
            { source, mint: params.mint as Address, destination, authority: createNoopSigner(payer as Address), amount: params.amount, decimals: meta.decimals },
            { programAddress: meta.tokenProgram as Address },
          ),
        ),
      ];
    }
    const amount = formatUnits(params.amount, meta.decimals);
    const symbol = meta.symbol ?? params.mint;
    return executeIntent(await this.context(), params.id, {
      kind: "transfer.spl",
      summary: `transfer ${amount} ${symbol} → ${params.to}`,
      to: params.mint,
      instructions,
      spendAsset: params.mint === WSOL_MINT ? "native" : params.mint,
      spendAmount: params.amount,
      meta: { recipient: params.to, mint: params.mint, amount, symbol, decimals: String(meta.decimals) },
    });
  }

  async approveSpl(params: ApproveParams): Promise<ExecutionRecord> {
    requireAddress(params.delegate, "delegate");
    const meta = await this.tokenData(params.mint);
    const payer = await this.payer();
    let instructions: SerializedInstruction[] = [];
    if (payer) {
      const { source } = await this.tokenAccounts(payer, payer, meta);
      instructions = [
        serializeInstruction(
          getApproveCheckedInstruction(
            { source, mint: params.mint as Address, delegate: params.delegate as Address, owner: createNoopSigner(payer as Address), amount: params.amount, decimals: meta.decimals },
            { programAddress: meta.tokenProgram as Address },
          ),
        ),
      ];
    }
    const amount = formatUnits(params.amount, meta.decimals);
    const symbol = meta.symbol ?? params.mint;
    return executeIntent(await this.context(), params.id, {
      kind: "spl.approve",
      summary: `approve ${amount} ${symbol} for ${params.delegate}`,
      to: params.mint,
      instructions,
      // Approvals are treated as spends against the allowance — a delegation
      // is spendable authority even before the delegate uses it.
      spendAsset: params.mint === WSOL_MINT ? "native" : params.mint,
      spendAmount: params.amount,
      meta: { delegate: params.delegate, mint: params.mint, amount, symbol, decimals: String(meta.decimals) },
    });
  }

  /**
   * One raw instruction to a program. The program must be allowlisted, and
   * the only account that may be marked as a signer is the payer — Flightpath
   * cannot sign for anyone else, and will not pretend to.
   */
  async programInvoke(params: ProgramInvokeParams): Promise<ExecutionRecord> {
    requireAddress(params.programAddress, "programAddress");
    const payer = await this.payer();
    for (const meta of params.accounts) {
      requireAddress(meta.address, "account");
      if (isSignerRole(meta.role) && meta.address !== payer) {
        throw new FlightpathConfigError(`account ${meta.address} is marked as a signer, but only the payer (${payer ?? "none"}) can sign`);
      }
    }
    const instruction: SerializedInstruction = { programAddress: params.programAddress, accounts: params.accounts, data: params.data };
    return executeIntent(await this.context(), params.id, {
      kind: "program.invoke",
      summary: params.summary ?? `invoke ${params.programAddress} (${params.accounts.length} accounts)`,
      to: params.programAddress,
      instructions: payer ? [instruction] : [],
      spendAsset: "native",
      spendAmount: 0n,
      meta: { program: params.programAddress },
    });
  }

  /** Swap through Jupiter. The Jupiter program must be on allowedPrograms. */
  async swapExactIn(params: SwapExactInParams): Promise<ExecutionRecord> {
    requireAddress(params.inputMint, "inputMint");
    requireAddress(params.outputMint, "outputMint");
    if (!Number.isInteger(params.slippageBps) || params.slippageBps < 1 || params.slippageBps > 1_000) {
      throw new FlightpathConfigError("slippageBps must be an integer between 1 and 1000");
    }
    const payer = await this.payer();
    const [inMeta, outMeta] = await Promise.all([this.decimalsOf(params.inputMint), this.decimalsOf(params.outputMint)]);
    const quote = await readSwapQuote({ inputMint: params.inputMint, outputMint: params.outputMint, amount: params.amountIn, slippageBps: params.slippageBps });
    if (!quote.reachable || !quote.data) throw new Error(quote.error ?? "no swap quote available");
    const fetched = payer ? await fetchSwapInstructions(quote.data.raw, payer) : { instructions: [], addressLookupTables: [] };
    // The route's own compute budget (and the priority fee it adds by
    // default) is dropped: Flightpath sizes compute from simulation and sets
    // priority only when the operator configured it.
    const built = {
      instructions: fetched.instructions.filter((ix) => ix.programAddress !== COMPUTE_BUDGET_PROGRAM),
      addressLookupTables: fetched.addressLookupTables,
    };

    const inAmount = formatUnits(params.amountIn, inMeta.decimals);
    const minOut = formatUnits(BigInt(quote.data.otherAmountThreshold), outMeta.decimals);
    return executeIntent(await this.context(), params.id, {
      kind: "swap.exactIn",
      summary: `swap ${inAmount} ${inMeta.symbol} → ≥ ${minOut} ${outMeta.symbol} via Jupiter`,
      to: JUPITER_PROGRAM,
      instructions: built.instructions,
      addressLookupTables: built.addressLookupTables,
      spendAsset: params.inputMint === WSOL_MINT ? "native" : params.inputMint,
      spendAmount: params.amountIn,
      meta: {
        venue: "jupiter",
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: inAmount,
        symbol: inMeta.symbol,
        decimals: String(inMeta.decimals),
        quotedOut: formatUnits(BigInt(quote.data.outAmount), outMeta.decimals),
        minOut,
        slippageBps: String(params.slippageBps),
        priceImpactPct: String(quote.data.priceImpactPct),
        recipient: payer ?? "",
      },
    });
  }

  private async decimalsOf(mint: string): Promise<{ decimals: number; symbol: string }> {
    if (mint === WSOL_MINT) return { decimals: SOL_DECIMALS, symbol: "SOL" };
    const meta = await this.tokenData(mint);
    return { decimals: meta.decimals, symbol: meta.symbol ?? mint };
  }

  /**
   * Interact with an approved RWA mint. Uses intent kind "rwa.interact" so the
   * PolicyEngine hard-checks the approved registry — an agent cannot reach
   * arbitrary permissioned assets through this path.
   */
  async rwaInteract(params: {
    id: string;
    mint: string;
    action: "transfer" | "approve";
    counterparty: string;
    amount: bigint;
  }): Promise<ExecutionRecord> {
    requireAddress(params.counterparty, "counterparty");
    const meta = await this.tokenData(params.mint);
    const payer = await this.payer();
    let instructions: SerializedInstruction[] = [];
    if (payer) {
      const { source, destination } = await this.tokenAccounts(payer, params.counterparty, meta);
      const programAddress = { programAddress: meta.tokenProgram as Address };
      const owner = createNoopSigner(payer as Address);
      if (params.action === "transfer") {
        await this.requireTokenAccount(destination, params.counterparty, meta);
        instructions = [
          serializeInstruction(
            getTransferCheckedInstruction(
              { source, mint: params.mint as Address, destination, authority: owner, amount: params.amount, decimals: meta.decimals },
              programAddress,
            ),
          ),
        ];
      } else {
        instructions = [
          serializeInstruction(
            getApproveCheckedInstruction(
              { source, mint: params.mint as Address, delegate: params.counterparty as Address, owner, amount: params.amount, decimals: meta.decimals },
              programAddress,
            ),
          ),
        ];
      }
    }
    const amount = formatUnits(params.amount, meta.decimals);
    const symbol = meta.symbol ?? params.mint;
    return executeIntent(await this.context(), params.id, {
      kind: "rwa.interact",
      summary: `RWA ${params.action}: ${amount} ${symbol} ↔ ${params.counterparty}`,
      to: params.mint,
      instructions,
      spendAsset: params.mint,
      spendAmount: params.amount,
      meta: {
        action: params.action,
        counterparty: params.counterparty,
        ...(params.action === "transfer" ? { recipient: params.counterparty } : { delegate: params.counterparty }),
        mint: params.mint,
        amount,
        symbol,
        decimals: String(meta.decimals),
      },
    });
  }

  /**
   * Resume an execution held at the approval gate. The intent comes from the
   * stored record, so what gets executed is exactly what was approved.
   */
  async resumeApproved(id: string, approvedBy: string): Promise<ExecutionRecord> {
    const record = await this.sink.get(id);
    if (!record) throw new FlightpathConfigError(`no execution record with id ${id}`);
    return resumeApprovedIntent(await this.context(), id, approvedBy);
  }

  txExplorerUrl(signature: string): string {
    return explorerTxUrl(signature, this.target);
  }

  addressExplorerUrl(address: string): string {
    return explorerAddressUrl(address, this.target);
  }
}

function requireAddress(value: string, name: string): void {
  if (!isSolanaAddress(value)) throw new FlightpathConfigError(`${name} "${value}" is not a Solana address`);
}

export function createFlightpath(options: FlightpathOptions = {}): Flightpath {
  return new Flightpath(options);
}
