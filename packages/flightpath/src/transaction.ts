import {
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  decompileTransactionMessageFetchingLookupTables,
  fetchAddressesForLookupTables,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
  type TransactionSigner,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import { deserializeInstruction, serializeInstruction, sameInstruction, type SerializedInstruction } from "./codec.ts";
import { describeRpcError } from "./network.ts";
import { COMPUTE_BUDGET_PROGRAM } from "./policy.ts";

/**
 * Transaction plumbing shared by server-signed and wallet-signed execution.
 *
 * Every transaction Flightpath builds is a v0 message: the fee payer is the
 * signer, the instructions are exactly the intent's, optionally preceded by a
 * compute-unit limit sized from simulation. Nothing else is ever added.
 */

/** Lighthouse: assertion-only instructions some wallets append to guard what they sign. */
export const LIGHTHOUSE_PROGRAM = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";

/** Programs a wallet may add around a prepared transaction without changing what it does. */
const WALLET_TOLERATED_PROGRAMS = new Set([COMPUTE_BUDGET_PROGRAM, LIGHTHOUSE_PROGRAM]);

const MAX_COMPUTE_UNITS = 1_400_000;

type CompilableMessage = Parameters<typeof compileTransaction>[0];

/** Headroom over the simulated figure: state can shift between simulation and landing. */
export function computeUnitLimitFor(simulatedUnits: bigint | number | null | undefined): number | null {
  if (simulatedUnits === null || simulatedUnits === undefined) return null;
  const units = Math.ceil(Number(simulatedUnits) * 1.15) + 300;
  return Math.min(Math.max(units, 1_000), MAX_COMPUTE_UNITS);
}

/** Optional priority fee, micro-lamports per compute unit. Off unless configured. */
function priorityFee(): bigint | null {
  const raw = typeof process !== "undefined" ? process.env.FLIGHTPATH_PRIORITY_MICROLAMPORTS : undefined;
  if (!raw || !/^[0-9]+$/.test(raw)) return null;
  const value = BigInt(raw);
  return value > 0n ? value : null;
}

export interface BuildInput {
  rpc: Rpc<SolanaRpcApi>;
  /** The fee payer: a signer for server-signed sends, a bare address when a wallet signs. */
  feePayer: TransactionSigner | string;
  instructions: SerializedInstruction[];
  addressLookupTables?: string[];
  computeUnitLimit?: number | null;
  blockhash?: { blockhash: string; lastValidBlockHeight: bigint };
  /** Configured endpoints, so error text can be scrubbed of credentials. */
  rpcUrls?: readonly string[];
}

export async function latestBlockhash(rpc: Rpc<SolanaRpcApi>): Promise<{ blockhash: string; lastValidBlockHeight: bigint }> {
  const { value } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  return { blockhash: value.blockhash, lastValidBlockHeight: value.lastValidBlockHeight };
}

/** Assemble the v0 message for an intent. */
export async function buildMessage(input: BuildInput) {
  const lifetime = input.blockhash ?? (await latestBlockhash(input.rpc));
  const prelude: Instruction[] = [];
  if (input.computeUnitLimit) prelude.push(getSetComputeUnitLimitInstruction({ units: input.computeUnitLimit }));
  const price = priorityFee();
  if (price !== null) prelude.push(getSetComputeUnitPriceInstruction({ microLamports: price }));
  const instructions = [...prelude, ...input.instructions.map(deserializeInstruction)];

  const base = pipe(
    createTransactionMessage({ version: 0 }),
    (message) =>
      typeof input.feePayer === "string"
        ? setTransactionMessageFeePayer(input.feePayer as Address, message)
        : setTransactionMessageFeePayerSigner(input.feePayer, message),
    (message) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: lifetime.blockhash as never, lastValidBlockHeight: lifetime.lastValidBlockHeight },
        message,
      ),
    (message) => appendTransactionMessageInstructions(instructions, message),
  );

  const tables = input.addressLookupTables ?? [];
  const message =
    tables.length > 0
      ? compressTransactionMessageUsingAddressLookupTables(
          base,
          await fetchAddressesForLookupTables(tables as Address[], input.rpc),
        )
      : base;
  return { message, lifetime };
}

export interface SimulationOutcome {
  ok: boolean;
  unitsConsumed: bigint | null;
  feeLamports: bigint | null;
  logs: string[];
  error?: string;
}

/**
 * Simulate exactly what would be signed, as the fee payer that would sign it.
 * No signature is needed or checked; the node substitutes a fresh blockhash.
 */
export async function simulate(input: BuildInput): Promise<SimulationOutcome> {
  const { message } = await buildMessage({ ...input, feePayer: typeof input.feePayer === "string" ? input.feePayer : input.feePayer.address });
  const compiled = compileTransaction(message as CompilableMessage);
  const wire = getBase64EncodedWireTransaction(compiled);
  const { value } = await input.rpc
    .simulateTransaction(wire, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" })
    .send();
  const logs = (value.logs ?? []).slice(-12);
  let feeLamports: bigint | null = null;
  try {
    const encodedMessage = getBase64Decoder().decode(compiled.messageBytes);
    const fee = await input.rpc.getFeeForMessage(encodedMessage as never, { commitment: "confirmed" }).send();
    feeLamports = fee.value === null ? null : BigInt(fee.value);
  } catch {
    feeLamports = null;
  }
  if (value.err) {
    return {
      ok: false,
      unitsConsumed: value.unitsConsumed ?? null,
      feeLamports,
      logs,
      error: `simulation failed: ${JSON.stringify(value.err, (_key, v) => (typeof v === "bigint" ? v.toString() : v))}${logs.length ? ` — ${logs.slice(-3).join(" | ")}` : ""}`,
    };
  }
  return { ok: true, unitsConsumed: value.unitsConsumed ?? null, feeLamports, logs };
}

/**
 * The unsigned wire transaction a visitor's wallet signs: exactly the
 * prepared instructions, the prepared fee payer, a fresh blockhash.
 */
export async function buildUnsignedTransaction(
  prepared: { feePayer: string; instructions: SerializedInstruction[]; addressLookupTables?: string[]; computeUnits?: string },
  rpc: Rpc<SolanaRpcApi>,
): Promise<{ transaction: string; blockhash: string; lastValidBlockHeight: string }> {
  const units = prepared.computeUnits && /^[0-9]+$/.test(prepared.computeUnits) ? Number(prepared.computeUnits) : null;
  const { message, lifetime } = await buildMessage({
    rpc,
    feePayer: prepared.feePayer,
    instructions: prepared.instructions,
    addressLookupTables: prepared.addressLookupTables,
    computeUnitLimit: units,
  });
  const compiled = compileTransaction(message as CompilableMessage);
  return {
    transaction: getBase64EncodedWireTransaction(compiled),
    blockhash: lifetime.blockhash,
    lastValidBlockHeight: lifetime.lastValidBlockHeight.toString(),
  };
}

/** Sign with the server's operator key and hand to the network. */
export async function signAndSend(
  input: BuildInput & { feePayer: TransactionSigner },
): Promise<{ signature: Signature; lastValidBlockHeight: bigint; sendError?: string }> {
  const { message, lifetime } = await buildMessage(input);
  const signed = await signTransactionMessageWithSigners(message as Parameters<typeof signTransactionMessageWithSigners>[0]);
  const signature = getSignatureFromTransaction(signed);
  try {
    await input.rpc
      .sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64", preflightCommitment: "confirmed" })
      .send();
    return { signature, lastValidBlockHeight: lifetime.lastValidBlockHeight };
  } catch (error) {
    // The signature is known before sending. A transport error after the node
    // accepted the bytes can still land, so the caller checks the signature
    // rather than assuming nothing went out.
    return {
      signature,
      lastValidBlockHeight: lifetime.lastValidBlockHeight,
      sendError: describeRpcError(error, input.rpcUrls ?? []),
    };
  }
}

export type SignatureOutcome =
  | { status: "confirmed"; slot: bigint; err: unknown | null }
  | { status: "expired" }
  | { status: "timeout" };

/**
 * Wait for a signature to reach `confirmed`. "expired" means the blockhash
 * aged out with nothing landed — a definite answer that nothing happened.
 * "timeout" is not: the transaction may still land.
 */
export async function waitForSignature(
  rpc: Rpc<SolanaRpcApi>,
  signature: string,
  options: { lastValidBlockHeight?: bigint; timeoutMs?: number; pollMs?: number } = {},
): Promise<SignatureOutcome> {
  const deadline = Date.now() + (options.timeoutMs ?? 90_000);
  const pollMs = options.pollMs ?? 1_000;
  while (Date.now() < deadline) {
    try {
      const { value } = await rpc.getSignatureStatuses([signature as Signature], { searchTransactionHistory: false }).send();
      const status = value[0];
      if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) {
        return { status: "confirmed", slot: status.slot, err: status.err ?? null };
      }
      if (!status && options.lastValidBlockHeight !== undefined) {
        const height = await rpc.getBlockHeight({ commitment: "confirmed" }).send();
        if (height > options.lastValidBlockHeight) {
          // One last look with history: it may have landed between polls.
          const late = await rpc.getSignatureStatuses([signature as Signature], { searchTransactionHistory: true }).send();
          const landed = late.value[0];
          if (landed) return { status: "confirmed", slot: landed.slot, err: landed.err ?? null };
          return { status: "expired" };
        }
      }
    } catch {
      // A failed poll is not an answer; keep asking until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return { status: "timeout" };
}

export interface LandedReceipt {
  status: "success" | "failed";
  slot: string;
  feeLamports: string;
  computeUnits?: string;
  error?: string;
}

/** Read what the chain recorded for a confirmed signature. Null when the node has no record yet. */
export async function readReceipt(rpc: Rpc<SolanaRpcApi>, signature: string): Promise<LandedReceipt | null> {
  const tx = await rpc
    .getTransaction(signature as Signature, { encoding: "base64", maxSupportedTransactionVersion: 1, commitment: "confirmed" })
    .send();
  if (!tx || !tx.meta) return null;
  return {
    status: tx.meta.err ? "failed" : "success",
    slot: tx.slot.toString(),
    feeLamports: tx.meta.fee.toString(),
    computeUnits: tx.meta.computeUnitsConsumed !== undefined ? tx.meta.computeUnitsConsumed.toString() : undefined,
    error: tx.meta.err ? JSON.stringify(tx.meta.err, (_key, v) => (typeof v === "bigint" ? v.toString() : v)) : undefined,
  };
}

export interface LandedTransaction {
  feePayer: string;
  signers: string[];
  instructions: SerializedInstruction[];
  receipt: LandedReceipt;
}

/**
 * Fetch a landed transaction and decompile it back into instructions, with
 * lookup-table accounts resolved, so it can be compared to what was prepared.
 */
export async function readLandedTransaction(rpc: Rpc<SolanaRpcApi>, signature: string): Promise<LandedTransaction | null> {
  const tx = await rpc
    .getTransaction(signature as Signature, { encoding: "base64", maxSupportedTransactionVersion: 1, commitment: "confirmed" })
    .send();
  if (!tx || !tx.meta) return null;
  const [encoded] = tx.transaction as unknown as [string, "base64"];
  const decoded = getTransactionDecoder().decode(new Uint8Array(getBase64Encoder().encode(encoded)));
  const compiled = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
  const message = await decompileTransactionMessageFetchingLookupTables(
    compiled as Parameters<typeof decompileTransactionMessageFetchingLookupTables>[0],
    rpc,
  );
  const signerCount = compiled.header.numSignerAccounts;
  return {
    feePayer: message.feePayer.address,
    signers: compiled.staticAccounts.slice(0, signerCount),
    instructions: (message.instructions as readonly Instruction[]).map((instruction) => serializeInstruction(instruction)),
    receipt: {
      status: tx.meta.err ? "failed" : "success",
      slot: tx.slot.toString(),
      feeLamports: tx.meta.fee.toString(),
      computeUnits: tx.meta.computeUnitsConsumed !== undefined ? tx.meta.computeUnitsConsumed.toString() : undefined,
      error: tx.meta.err ? JSON.stringify(tx.meta.err, (_key, v) => (typeof v === "bigint" ? v.toString() : v)) : undefined,
    },
  };
}

/**
 * Is the landed transaction the prepared one?
 *
 * The fee payer must be the prepared signer and the ONLY signer. The prepared
 * instructions must appear in order with identical program, accounts and
 * data. Anything else in the transaction must be a compute-budget or
 * Lighthouse assertion instruction — wallets add those, and neither can move
 * value. Account roles are not compared: the message-level role of an account
 * (the fee payer is always a writable signer) legitimately differs from the
 * role one instruction asked for, and with one signer a role cannot grant
 * anyone new authority.
 */
export function matchSignedTransaction(
  prepared: { feePayer: string; instructions: SerializedInstruction[] },
  landed: Pick<LandedTransaction, "feePayer" | "signers" | "instructions">,
): { ok: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  if (landed.feePayer !== prepared.feePayer) mismatches.push("fee payer");
  if (landed.signers.length !== 1 || landed.signers[0] !== prepared.feePayer) mismatches.push("signers");

  const core = landed.instructions.filter((ix) => !WALLET_TOLERATED_PROGRAMS.has(ix.programAddress));
  const expected = prepared.instructions.filter((ix) => !WALLET_TOLERATED_PROGRAMS.has(ix.programAddress));
  const sameIgnoringRoles = (a: SerializedInstruction, b: SerializedInstruction) =>
    sameInstruction(
      { ...a, accounts: a.accounts.map((meta) => ({ ...meta, role: "readonly" as const })) },
      { ...b, accounts: b.accounts.map((meta) => ({ ...meta, role: "readonly" as const })) },
    );
  if (core.length !== expected.length) {
    mismatches.push(`instruction count (${core.length} landed, ${expected.length} prepared)`);
  } else {
    core.forEach((ix, index) => {
      if (!sameIgnoringRoles(ix, expected[index]!)) mismatches.push(`instruction ${index + 1}`);
    });
  }
  return { ok: mismatches.length === 0, mismatches };
}
