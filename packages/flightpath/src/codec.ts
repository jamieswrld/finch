import {
  AccountRole,
  getBase64Decoder,
  getBase64Encoder,
  isAddress,
  isSignature,
  type AccountMeta,
  type Address,
  type Instruction,
} from "@solana/kit";

/**
 * Small, dependency-free conversions shared by every Flightpath module.
 *
 * Solana addresses and signatures are base58 and CASE-SENSITIVE. Nothing in
 * Flightpath lowercases an address: two base58 strings that differ only in
 * case are two different accounts.
 */

export const SOL_DECIMALS = 9;
export const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * The wrapped-SOL mint. Jupiter, DEX pools and price feeds name native SOL
 * by this mint; an allowance keyed "native" covers it.
 */
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

export function isSolanaAddress(value: unknown): value is Address {
  return typeof value === "string" && isAddress(value);
}

export function isSolanaSignature(value: unknown): value is string {
  return typeof value === "string" && isSignature(value);
}

/**
 * Human decimal string → smallest units. Refuses more fractional digits than
 * the token has rather than silently rounding someone's amount.
 */
export function parseUnits(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) throw new Error(`"${value}" is not a decimal amount`);
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(`"${value}" has more than ${decimals} decimal places, which this asset cannot represent`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/** Smallest units → human decimal string, trailing zeros trimmed. */
export function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = decimals > 0 ? (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  return `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

export function formatSol(lamports: bigint): string {
  return formatUnits(lamports, SOL_DECIMALS);
}

// ── Serialized instructions ────────────────────────────────────────────────
// An execution record must survive JSON (MongoDB, HTTP, a wallet round trip)
// and still describe exactly one transaction. These are that wire shape.

export type AccountRoleName = "readonly" | "writable" | "readonly_signer" | "writable_signer";

export interface SerializedAccountMeta {
  address: string;
  role: AccountRoleName;
}

export interface SerializedInstruction {
  programAddress: string;
  accounts: SerializedAccountMeta[];
  /** Instruction data, base64. */
  data: string;
}

const ROLE_NAMES: Record<AccountRole, AccountRoleName> = {
  [AccountRole.READONLY]: "readonly",
  [AccountRole.WRITABLE]: "writable",
  [AccountRole.READONLY_SIGNER]: "readonly_signer",
  [AccountRole.WRITABLE_SIGNER]: "writable_signer",
};

const ROLE_VALUES: Record<AccountRoleName, AccountRole> = {
  readonly: AccountRole.READONLY,
  writable: AccountRole.WRITABLE,
  readonly_signer: AccountRole.READONLY_SIGNER,
  writable_signer: AccountRole.WRITABLE_SIGNER,
};

export function isSignerRole(role: AccountRoleName): boolean {
  return role === "readonly_signer" || role === "writable_signer";
}

export function isWritableRole(role: AccountRoleName): boolean {
  return role === "writable" || role === "writable_signer";
}

export function roleName(role: AccountRole): AccountRoleName {
  return ROLE_NAMES[role];
}

export function bytesToBase64(bytes: Uint8Array | ReadonlyUint8ArrayLike): string {
  return getBase64Decoder().decode(bytes as Uint8Array);
}

export function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(getBase64Encoder().encode(value));
}

type ReadonlyUint8ArrayLike = { readonly length: number; readonly [index: number]: number };

export function serializeInstruction(instruction: Instruction): SerializedInstruction {
  return {
    programAddress: instruction.programAddress,
    accounts: (instruction.accounts ?? []).map((meta: AccountMeta) => ({ address: meta.address, role: ROLE_NAMES[meta.role] })),
    data: bytesToBase64(instruction.data ?? new Uint8Array()),
  };
}

export function deserializeInstruction(instruction: SerializedInstruction): Instruction {
  if (!isSolanaAddress(instruction.programAddress)) throw new Error(`invalid program address ${instruction.programAddress}`);
  return {
    programAddress: instruction.programAddress,
    accounts: instruction.accounts.map((meta) => {
      if (!isSolanaAddress(meta.address)) throw new Error(`invalid account address ${meta.address}`);
      const role = ROLE_VALUES[meta.role];
      if (role === undefined) throw new Error(`invalid account role ${meta.role}`);
      return { address: meta.address, role };
    }),
    data: base64ToBytes(instruction.data),
  };
}

/** Byte-for-byte equality of program, account list (address and role) and data. */
export function sameInstruction(a: SerializedInstruction, b: SerializedInstruction): boolean {
  if (a.programAddress !== b.programAddress || a.data !== b.data) return false;
  if (a.accounts.length !== b.accounts.length) return false;
  return a.accounts.every((meta, index) => meta.address === b.accounts[index]!.address && meta.role === b.accounts[index]!.role);
}

/** Little-endian unsigned integer from instruction data. */
export function readU64(bytes: Uint8Array, offset: number): bigint | null {
  if (bytes.length < offset + 8) return null;
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, true);
}

export function readU32(bytes: Uint8Array, offset: number): number | null {
  if (bytes.length < offset + 4) return null;
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}
