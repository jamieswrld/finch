import { createPublicClient, erc20Abi, formatUnits, getAddress, http } from "viem";
import { buildRobinhoodChain, explorerTokenUrl, getFlightpathTarget, type FlightpathTarget } from "./chain.ts";

/**
 * Tracked token contracts on Robinhood Chain.
 *
 * Every field displayed for these is read from the contract itself at request
 * time. Nothing is hardcoded from a spec sheet, because a spec sheet can be
 * wrong and a contract cannot: if the chain says the supply is X, the supply
 * is X.
 *
 * `relation` is deliberately narrow. Listing a contract here means Finch reads
 * it, nothing more — it is not a claim of partnership, endorsement, listing, or
 * affiliation with whoever deployed it.
 */

export interface TrackedToken {
  address: `0x${string}`;
  /** What Finch's actual relationship to this contract is. Keep it literal. */
  relation: string;
}

export const TRACKED_TOKENS: TrackedToken[] = [
  {
    address: "0x56910d4409F3a0C78c64dd8d0545Ff0705389870",
    relation: "tracked contract",
  },
];

export interface TokenReadout {
  address: string;
  relation: string;
  /** Null when the read failed — never a guess, never a cached value. */
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
  totalSupplyFormatted: string | null;
  explorerUrl: string | null;
  reachable: boolean;
  error?: string;
}

function clientFor(target: FlightpathTarget) {
  return createPublicClient({
    chain: buildRobinhoodChain(),
    transport: http(target.rpcUrl, { timeout: 8_000, retryCount: 1 }),
  });
}

/** Read one ERC20's metadata straight off the chain. */
export async function readToken(
  token: TrackedToken,
  target: FlightpathTarget = getFlightpathTarget(),
): Promise<TokenReadout> {
  const base: TokenReadout = {
    address: token.address,
    relation: token.relation,
    name: null,
    symbol: null,
    decimals: null,
    totalSupply: null,
    totalSupplyFormatted: null,
    explorerUrl: explorerTokenUrl(token.address, target),
    reachable: false,
  };

  try {
    const client = clientFor(target);
    const address = getAddress(token.address);
    const contract = { address, abi: erc20Abi } as const;

    const [name, symbol, decimals, totalSupply] = await Promise.all([
      client.readContract({ ...contract, functionName: "name" }),
      client.readContract({ ...contract, functionName: "symbol" }),
      client.readContract({ ...contract, functionName: "decimals" }),
      client.readContract({ ...contract, functionName: "totalSupply" }),
    ]);

    return {
      ...base,
      reachable: true,
      name,
      symbol,
      decimals,
      totalSupply: totalSupply.toString(),
      totalSupplyFormatted: formatUnits(totalSupply, decimals),
    };
  } catch (error) {
    // A contract that does not answer ERC20 calls is reported as unreadable.
    // Rendering a plausible name here would be inventing data.
    return { ...base, error: error instanceof Error ? error.message.slice(0, 160) : "unknown" };
  }
}

export async function readTrackedTokens(
  target: FlightpathTarget = getFlightpathTarget(),
): Promise<TokenReadout[]> {
  return Promise.all(TRACKED_TOKENS.map((token) => readToken(token, target)));
}
