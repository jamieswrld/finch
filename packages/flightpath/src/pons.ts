import { parseAbiItem, type Address, type PublicClient } from "viem";

/**
 * Pons integration — $FINCH launches through Pons with a 3% creator tax.
 *
 * Accounting boundary (do not blur it):
 *   · Pons charges its own underlying protocol fee on trades. That fee is
 *     Pons revenue, not Finch's, and is never counted here.
 *   · Finch's revenue stream is the CREATOR-SIDE TAX configured for our
 *     launch (300 bps), paid to the team-controlled Finch fee wallet.
 *
 * Launch guard (enforced before any launch signing): verify the Robinhood
 * network, the expected Pons version, launcher authorization, that 300 bps is
 * currently permitted, and the fee recipient — if the deployed Pons contracts
 * do not allow 3%, BLOCK the launch and surface the reason. Never silently
 * fall back to a different rate or version.
 *
 * Contract addresses and the exact event ABI ship from Pons; both are supplied
 * via configuration once published. Nothing here fabricates live data — every
 * accessor reports `configured: false` until real params exist.
 */

/** Finch's creator tax on $FINCH Pons trading, in basis points. */
export const FINCH_CREATOR_TAX_BPS = 300n;
export const BPS_DENOMINATOR = 10_000n;

/** Expected creator-fee event shape; confirm against Pons' published ABI before indexing mainnet. */
export const PONS_CREATOR_FEE_EVENT = parseAbiItem(
  "event CreatorFeePaid(address indexed token, address indexed creator, address indexed recipient, uint256 amount)",
);

export interface PonsConfig {
  configured: boolean;
  factory?: Address;
  /** Address receiving Finch's creator tax — the Finch Treasury FeeVault. */
  feeRecipient?: Address;
  /** A launcher contract observed onchain. Not confirmed by Pons; never used for the 300 bps gate. */
  factoryCandidate?: Address;
  candidateNote?: string;
}

/**
 * The contract that deployed the PONS token, found by reading the chain:
 * the creation tx was a 0.1005 ETH call INTO this address, it has 1,800+
 * transactions of which nearly all are the same paid launch method, and it
 * exposes setLaunchEnabled. That is a launcher. It is UNVERIFIED — no ABI
 * is published — so it cannot back the 300 bps check, and it is reported
 * as a candidate rather than set as PONS_FACTORY_ADDRESS.
 */
export const PONS_LAUNCHER_CANDIDATE = "0x0c37a24F5D23A486FA692d1500881d698B1F77a4" as Address;

export function getPonsConfig(): PonsConfig {
  const factory = (typeof process !== "undefined" ? process.env.PONS_FACTORY_ADDRESS : undefined) as Address | undefined;
  const feeRecipient = (typeof process !== "undefined"
    ? process.env.FINCH_FEE_VAULT_ADDRESS ?? process.env.FINCH_FEE_WALLET_ADDRESS
    : undefined) as Address | undefined;
  return {
    configured: Boolean(factory && feeRecipient),
    factory,
    feeRecipient,
    factoryCandidate: PONS_LAUNCHER_CANDIDATE,
    candidateNote:
      "Launcher contract observed onchain (deployer of PONS; 1,800+ paid launch calls). Unverified source, so the 3% creator-tax guarantee cannot be checked against it yet.",
  };
}

/** Creator tax owed on a gross trade volume, in the same units as `volume`. */
export function creatorTaxOn(volume: bigint): bigint {
  return (volume * FINCH_CREATOR_TAX_BPS) / BPS_DENOMINATOR;
}

export interface CreatorFeeEvent {
  token: Address;
  creator: Address;
  recipient: Address;
  amount: string;
  txHash: string;
  blockNumber: string;
  logIndex: number;
}

export interface CreatorFeeIndexResult {
  configured: boolean;
  fromBlock?: string;
  toBlock?: string;
  events: CreatorFeeEvent[];
}

/**
 * Pull creator-fee events for the treasury ledger. The caller (indexer job)
 * persists results via @finch/db `fee_events` with (txHash, logIndex) as the
 * idempotency key.
 */
export async function indexCreatorFees(
  client: PublicClient,
  range: { fromBlock: bigint; toBlock: bigint },
): Promise<CreatorFeeIndexResult> {
  const config = getPonsConfig();
  if (!config.configured || !config.factory) {
    return { configured: false, events: [] };
  }
  const logs = await client.getLogs({
    address: config.factory,
    event: PONS_CREATOR_FEE_EVENT,
    args: { recipient: config.feeRecipient },
    fromBlock: range.fromBlock,
    toBlock: range.toBlock,
  });
  return {
    configured: true,
    fromBlock: range.fromBlock.toString(),
    toBlock: range.toBlock.toString(),
    events: logs.map((log) => ({
      token: log.args.token as Address,
      creator: log.args.creator as Address,
      recipient: log.args.recipient as Address,
      amount: (log.args.amount as bigint).toString(),
      txHash: log.transactionHash,
      blockNumber: log.blockNumber.toString(),
      logIndex: log.logIndex,
    })),
  };
}
