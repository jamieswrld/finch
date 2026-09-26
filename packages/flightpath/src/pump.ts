import { getAddressDecoder, getAddressEncoder, getProgramDerivedAddress, type Address } from "@solana/kit";
import { explorerAddressUrl, getFlightpathTarget, type FlightpathTarget } from "./chain.ts";
import { base64ToBytes, formatUnits, isSolanaAddress, readU64, SOL_DECIMALS } from "./codec.ts";
import { describeRpcError } from "./network.ts";

/**
 * pump.fun — the launchpad $FINCH launches through.
 *
 * A pump.fun token trades against a bonding-curve account until the curve
 * completes, then graduates to pump.fun's AMM. Both facts live on chain:
 *
 *   curve   PDA ["bonding-curve", mint] under the pump.fun program —
 *           virtual and real reserves, total supply, `complete`, creator
 *   global  PDA ["global"] — the launch parameters every curve starts from,
 *           including the real token reserves a curve sells before it
 *           completes. Progress is measured against that, read live, not
 *           against a remembered constant.
 *
 * Layouts verified against live mainnet accounts (discriminators below). A
 * curve whose discriminator does not match is reported as unreadable rather
 * than decoded on a guess.
 */

export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

const CURVE_DISCRIMINATOR = "17b7f83760d8ac60";
const GLOBAL_DISCRIMINATOR = "a7e8e8b1c86c727f";

export type LaunchPhase = "not_launched" | "bonding_curve" | "graduated" | "not_on_pump";

export interface PumpCurve {
  mint: string;
  curve: string;
  phase: LaunchPhase;
  /** Share of the curve's sellable tokens already bought, 0–100. 100 once complete. */
  progressPct: number | null;
  /** SOL paid into the curve so far. */
  solInCurve: string | null;
  /** Spot price on the curve in SOL per token (virtual reserves), while bonding. */
  priceSol: string | null;
  tokensLeftOnCurve: string | null;
  creator: string | null;
  raw: {
    virtualTokenReserves: string;
    virtualSolReserves: string;
    realTokenReserves: string;
    realSolReserves: string;
    tokenTotalSupply: string;
    initialRealTokenReserves: string | null;
  } | null;
  explorerUrl: string;
}

export interface PumpResult {
  reachable: boolean;
  data: PumpCurve | null;
  error?: string;
  source: "rpc:pump.fun";
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function pumpCurveAddress(mint: string): Promise<string> {
  const [address] = await getProgramDerivedAddress({
    programAddress: PUMP_PROGRAM as Address,
    seeds: [new TextEncoder().encode("bonding-curve"), getAddressEncoder().encode(mint as Address)],
  });
  return address;
}

async function globalAddress(): Promise<string> {
  const [address] = await getProgramDerivedAddress({
    programAddress: PUMP_PROGRAM as Address,
    seeds: [new TextEncoder().encode("global")],
  });
  return address;
}

/** SOL per token from virtual reserves, as a decimal string with 12 significant decimals of headroom. */
function spotPrice(virtualSol: bigint, virtualToken: bigint, tokenDecimals: number): string | null {
  if (virtualToken === 0n) return null;
  const scale = 12;
  const scaled = (virtualSol * 10n ** BigInt(tokenDecimals) * 10n ** BigInt(scale)) / virtualToken;
  return formatUnits(scaled, SOL_DECIMALS + scale);
}

/**
 * Read a mint's pump.fun curve. `not_launched` when the mint account itself
 * does not exist; `not_on_pump` when the mint exists but has no pump.fun
 * curve; otherwise the curve's live state.
 */
export async function readPumpCurve(
  mint: string,
  target: FlightpathTarget = getFlightpathTarget(),
  options: { tokenDecimals?: number } = {},
): Promise<PumpResult> {
  const source = "rpc:pump.fun" as const;
  if (!isSolanaAddress(mint)) return { reachable: false, data: null, error: "not a Solana address", source };
  try {
    const [curve, global] = await Promise.all([pumpCurveAddress(mint), globalAddress()]);
    const empty = (phase: LaunchPhase): PumpCurve => ({
      mint,
      curve,
      phase,
      progressPct: null,
      solInCurve: null,
      priceSol: null,
      tokensLeftOnCurve: null,
      creator: null,
      raw: null,
      explorerUrl: explorerAddressUrl(curve, target),
    });

    const { value: accounts } = await target.rpc
      .getMultipleAccounts([mint as Address, curve as Address, global as Address], { encoding: "base64", commitment: "confirmed" })
      .send();
    const [mintAccount, curveAccount, globalAccount] = accounts;
    if (!mintAccount) return { reachable: true, data: empty("not_launched"), source };
    if (!curveAccount || curveAccount.owner !== PUMP_PROGRAM) return { reachable: true, data: empty("not_on_pump"), source };

    const bytes = base64ToBytes((curveAccount.data as unknown as [string, string])[0]);
    if (bytes.length < 49 || hex(bytes.subarray(0, 8)) !== CURVE_DISCRIMINATOR) {
      return { reachable: false, data: null, error: "pump.fun curve account has an unrecognised layout", source };
    }
    const virtualToken = readU64(bytes, 8)!;
    const virtualSol = readU64(bytes, 16)!;
    const realToken = readU64(bytes, 24)!;
    const realSol = readU64(bytes, 32)!;
    const supply = readU64(bytes, 40)!;
    const complete = bytes[48] === 1;
    const creator = bytes.length >= 81 ? getAddressDecoder().decode(bytes.subarray(49, 81)) : null;

    let initialReal: bigint | null = null;
    if (globalAccount) {
      const globalBytes = base64ToBytes((globalAccount.data as unknown as [string, string])[0]);
      if (globalBytes.length >= 97 && hex(globalBytes.subarray(0, 8)) === GLOBAL_DISCRIMINATOR) initialReal = readU64(globalBytes, 89);
    }

    // pump.fun mints have 6 decimals; the caller's own mint read wins when it has one.
    const decimals = options.tokenDecimals ?? 6;
    const progressPct = complete
      ? 100
      : initialReal && initialReal > 0n && realToken <= initialReal
        ? Number(((initialReal - realToken) * 10_000n) / initialReal) / 100
        : null;

    return {
      reachable: true,
      data: {
        mint,
        curve,
        phase: complete ? "graduated" : "bonding_curve",
        progressPct,
        solInCurve: formatUnits(realSol, SOL_DECIMALS),
        priceSol: complete ? null : spotPrice(virtualSol, virtualToken, decimals),
        tokensLeftOnCurve: formatUnits(realToken, decimals),
        creator,
        raw: {
          virtualTokenReserves: virtualToken.toString(),
          virtualSolReserves: virtualSol.toString(),
          realTokenReserves: realToken.toString(),
          realSolReserves: realSol.toString(),
          tokenTotalSupply: supply.toString(),
          initialRealTokenReserves: initialReal?.toString() ?? null,
        },
        explorerUrl: explorerAddressUrl(curve, target),
      },
      source,
    };
  } catch (error) {
    return { reachable: false, data: null, error: `rpc: ${describeRpcError(error, target.rpcUrls).slice(0, 200)}`, source };
  }
}
