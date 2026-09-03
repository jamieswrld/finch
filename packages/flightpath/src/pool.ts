import { createPublicClient, erc20Abi, formatUnits, getAddress, http, type Address } from "viem";
import { buildRobinhoodChain, getFlightpathTarget, type FlightpathTarget } from "./chain.ts";

/**
 * Uniswap V3 pool state, read straight off the chain.
 *
 * Liquidity is the fact a token-risk read most needs and least often has. The
 * explorer can tell a finch WHICH contracts hold a token; this tells it what
 * the one that is a pool actually contains. Depth is reported as the two
 * token balances the pool holds, which is the number that answers "how much
 * can be sold into this before the price moves" — the raw `liquidity` word
 * a V3 pool exposes is an internal quantity and is passed through labelled
 * as such, not dressed up as depth.
 *
 * No USD is computed here. A finch that wants USD combines this with a price
 * it read elsewhere and cites both.
 */

const V3_POOL_ABI = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { type: "uint160", name: "sqrtPriceX96" },
      { type: "int24", name: "tick" },
      { type: "uint16", name: "observationIndex" },
      { type: "uint16", name: "observationCardinality" },
      { type: "uint16", name: "observationCardinalityNext" },
      { type: "uint8", name: "feeProtocol" },
      { type: "bool", name: "unlocked" },
    ],
  },
] as const;

export interface PoolSide {
  token: Address;
  symbol: string | null;
  decimals: number;
  /** Human-unit balance the pool holds — the depth figure. */
  balance: string;
}

export interface PoolState {
  pool: Address;
  kind: "uniswap-v3";
  token0: PoolSide;
  token1: PoolSide;
  /** Fee tier in basis points of a percent, e.g. 10000 = 1%. */
  feeTier: number;
  feePercent: number;
  /** Spot price: how many token1 per one token0, decimals-adjusted. */
  priceToken1PerToken0: string;
  priceToken0PerToken1: string;
  /** V3's internal liquidity quantity, passed through and labelled. Not depth. */
  internalLiquidity: string;
}

export interface PoolResult {
  reachable: boolean;
  data: PoolState | null;
  error?: string;
  source: "rpc";
}

function client(target: FlightpathTarget) {
  return createPublicClient({ chain: buildRobinhoodChain(), transport: http(target.rpcUrl, { timeout: 10_000, retryCount: 1 }) });
}

/** Read one V3 pool. A contract that does not answer the V3 interface is reported as unreadable. */
export async function readPoolState(poolAddress: string, target = getFlightpathTarget()): Promise<PoolResult> {
  const source = "rpc" as const;
  try {
    const pool = getAddress(poolAddress);
    const c = client(target);
    const base = { address: pool, abi: V3_POOL_ABI } as const;

    const [token0, token1, feeTier, liquidity, slot0] = await Promise.all([
      c.readContract({ ...base, functionName: "token0" }),
      c.readContract({ ...base, functionName: "token1" }),
      c.readContract({ ...base, functionName: "fee" }),
      c.readContract({ ...base, functionName: "liquidity" }),
      c.readContract({ ...base, functionName: "slot0" }),
    ]);

    const side = async (token: Address): Promise<PoolSide> => {
      const erc = { address: token, abi: erc20Abi } as const;
      const [decimals, symbol, balance] = await Promise.all([
        c.readContract({ ...erc, functionName: "decimals" }).catch(() => 18),
        c.readContract({ ...erc, functionName: "symbol" }).catch(() => null),
        c.readContract({ ...erc, functionName: "balanceOf", args: [pool] }),
      ]);
      return { token, symbol, decimals, balance: formatUnits(balance, decimals) };
    };

    const [s0, s1] = await Promise.all([side(token0), side(token1)]);

    // price = (sqrtPriceX96 / 2^96)^2 gives token1-per-token0 in raw units;
    // adjust by the decimal difference to get a human ratio. Done in bigint
    // scaled by 1e18 so the 160-bit price never passes through a double.
    const sqrt = slot0[0];
    const Q96 = 2n ** 96n;
    const SCALE = 10n ** 18n;
    const rawRatioScaled = (sqrt * sqrt * SCALE) / (Q96 * Q96);
    const decimalShift = BigInt(s0.decimals) - BigInt(s1.decimals);
    const adjusted =
      decimalShift >= 0n ? rawRatioScaled * 10n ** decimalShift : rawRatioScaled / 10n ** -decimalShift;
    const priceToken1PerToken0 = formatUnits(adjusted, 18);
    const priceToken0PerToken1 = adjusted > 0n ? formatUnits((SCALE * SCALE) / adjusted, 18) : "0";

    return {
      reachable: true,
      source,
      data: {
        pool,
        kind: "uniswap-v3",
        token0: s0,
        token1: s1,
        feeTier: Number(feeTier),
        feePercent: Number(feeTier) / 10_000,
        priceToken1PerToken0,
        priceToken0PerToken1,
        internalLiquidity: liquidity.toString(),
      },
    };
  } catch (error) {
    return {
      reachable: false,
      source,
      data: null,
      error: error instanceof Error ? error.message.slice(0, 160) : "pool read failed",
    };
  }
}
