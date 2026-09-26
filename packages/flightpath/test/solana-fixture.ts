import { createNoopSigner, generateKeyPairSigner, type Address, type KeyPairSigner } from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getApproveCheckedInstruction,
  getTransferCheckedInstruction,
  getTransferInstruction,
} from "@solana-program/token";
import { NATIVE_CURRENCY, type FlightpathTarget } from "../src/chain.ts";
import { serializeInstruction, type SerializedInstruction } from "../src/codec.ts";
import type { ExecutionContext } from "../src/execution.ts";
import { PolicyEngine, TOKEN_PROGRAM, type WalletPolicy } from "../src/policy.ts";
import { MemoryExecutionSink } from "../src/types.ts";

/**
 * A fake Solana RPC for execution tests. Every call is recorded; any method a
 * test did not expect throws, so a code path that quietly starts calling the
 * network shows up as a failure rather than a hang.
 */

/** A syntactically valid blockhash (32 bytes, base58). */
export const BLOCKHASH = "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N";

/** Well-known mainnet mints — only their addresses matter here. */
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

type Handler = (...args: unknown[]) => unknown;

export function fakeRpc(overrides: Record<string, Handler> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const defaults: Record<string, Handler> = {
    getLatestBlockhash: () => ({ context: { slot: 1n }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 1_000n } }),
    simulateTransaction: () => ({ context: { slot: 1n }, value: { err: null, logs: ["Program log: ok"], unitsConsumed: 450n, accounts: null } }),
    getFeeForMessage: () => ({ context: { slot: 1n }, value: 5_000n }),
    sendTransaction: () => "sent",
    getSignatureStatuses: () => ({ context: { slot: 1n }, value: [{ slot: 42n, confirmations: 1n, err: null, confirmationStatus: "confirmed" }] }),
    getBlockHeight: () => 10n,
    getTransaction: () => ({ slot: 42n, meta: { err: null, fee: 5_000n, computeUnitsConsumed: 450n }, transaction: ["", "base64"] }),
  };
  const handlers: Record<string, Handler> = { ...defaults, ...overrides };
  const rpc = new Proxy(
    {},
    {
      get: (_target, method: string) =>
        (...args: unknown[]) => ({
          send: async () => {
            calls.push({ method, args });
            const handler = handlers[method];
            if (!handler) throw new Error(`unexpected rpc call ${method}`);
            return handler(...args);
          },
        }),
    },
  );
  return { rpc, calls, handlers };
}

export function fakeTarget(rpc: unknown): FlightpathTarget {
  return {
    cluster: "devnet",
    chain: "solana:devnet",
    name: "Solana",
    rpcUrl: "http://fake.invalid",
    rpcUrls: ["http://fake.invalid"],
    rpc: rpc as FlightpathTarget["rpc"],
    explorerUrl: "https://solscan.io",
    nativeCurrency: NATIVE_CURRENCY,
    devTarget: true,
    label: "test",
  };
}

export async function keypair(): Promise<KeyPairSigner> {
  return generateKeyPairSigner();
}

export async function addresses(count: number): Promise<string[]> {
  return Promise.all(Array.from({ length: count }, async () => (await generateKeyPairSigner()).address));
}

/** An execution context around a real operator keypair and a fake RPC. */
export async function harness(policy: WalletPolicy, overrides: Record<string, Handler> = {}) {
  const operator = await keypair();
  const { rpc, calls, handlers } = fakeRpc(overrides);
  const sends = () => calls.filter((call) => call.method === "sendTransaction");
  const context: ExecutionContext = {
    target: fakeTarget(rpc),
    signer: operator,
    signing: "server",
    policy: new PolicyEngine(policy),
    sink: new MemoryExecutionSink(),
    confirmationTimeoutMs: 2_000,
  };
  return { context, operator, calls, sends, handlers };
}

// ── Instruction builders ─────────────────────────────────────────────────────

export function solTransfer(from: string, to: string, lamports: bigint): SerializedInstruction {
  return serializeInstruction(
    getTransferSolInstruction({ source: createNoopSigner(from as Address), destination: to as Address, amount: lamports }),
  );
}

export async function ata(owner: string, mint: string, tokenProgram: string = TOKEN_PROGRAM): Promise<string> {
  const [account] = await findAssociatedTokenPda({ owner: owner as Address, mint: mint as Address, tokenProgram: tokenProgram as Address });
  return account;
}

export async function tokenTransfer(
  owner: string,
  recipient: string,
  mint: string,
  amount: bigint,
  options: { destination?: string; decimals?: number } = {},
): Promise<SerializedInstruction> {
  return serializeInstruction(
    getTransferCheckedInstruction({
      source: (await ata(owner, mint)) as Address,
      mint: mint as Address,
      destination: (options.destination ?? (await ata(recipient, mint))) as Address,
      authority: createNoopSigner(owner as Address),
      amount,
      decimals: options.decimals ?? 6,
    }),
  );
}

export async function tokenApprove(owner: string, delegate: string, mint: string, amount: bigint): Promise<SerializedInstruction> {
  return serializeInstruction(
    getApproveCheckedInstruction({
      source: (await ata(owner, mint)) as Address,
      mint: mint as Address,
      delegate: delegate as Address,
      owner: createNoopSigner(owner as Address),
      amount,
      decimals: 6,
    }),
  );
}

// ── Reading back what was broadcast ──────────────────────────────────────────

/** Decode every sendTransaction call into the SOL transfers it carried. */
export async function sentTransfers(calls: Array<{ method: string; args: unknown[] }>): Promise<Array<{ to: string; lamports: bigint }>> {
  const { decompileTransactionMessage, getBase64Encoder, getCompiledTransactionMessageDecoder, getTransactionDecoder } = await import("@solana/kit");
  const { decodeInstruction } = await import("../src/policy.ts");
  const out: Array<{ to: string; lamports: bigint }> = [];
  for (const call of calls.filter((entry) => entry.method === "sendTransaction")) {
    const wire = new Uint8Array(getBase64Encoder().encode(call.args[0] as string));
    const compiled = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(wire).messageBytes);
    const message = decompileTransactionMessage(compiled as Parameters<typeof decompileTransactionMessage>[0]);
    for (const instruction of message.instructions as readonly Parameters<typeof serializeInstruction>[0][]) {
      const decoded = decodeInstruction(serializeInstruction(instruction));
      if (decoded.kind === "move" && decoded.move.kind === "sol.transfer") out.push({ to: decoded.move.to, lamports: decoded.move.lamports });
    }
  }
  return out;
}

/** The unchecked form: moves tokens without naming the mint. */
export async function uncheckedTokenTransfer(owner: string, recipient: string, mint: string, amount: bigint): Promise<SerializedInstruction> {
  return serializeInstruction(
    getTransferInstruction({
      source: (await ata(owner, mint)) as Address,
      destination: (await ata(recipient, mint)) as Address,
      authority: createNoopSigner(owner as Address),
      amount,
    }),
  );
}
