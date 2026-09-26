import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getAddressDecoder } from "@solana/kit";
import {
  fetchSwapInstructions,
  jupiterConfig,
  readJupiterTokens,
  readMarketPair,
  readSwapQuote,
  readTokenList,
  readTokenMarkets,
  readTokenPrices,
} from "../src/market.ts";

/**
 * No network: fetch is stubbed with the response shapes observed from
 * lite-api.jup.ag and api.dexscreener.com. The point is the honesty rules —
 * an unpriced mint is absent (not 0), an outage is a failure (not an empty
 * market) — and that swap instructions come back complete and in order.
 */

const realFetch = globalThis.fetch;
const savedEnv = { url: process.env.JUPITER_API_URL, key: process.env.JUPITER_API_KEY };
afterEach(() => {
  globalThis.fetch = realFetch;
  if (savedEnv.url === undefined) delete process.env.JUPITER_API_URL;
  else process.env.JUPITER_API_URL = savedEnv.url;
  if (savedEnv.key === undefined) delete process.env.JUPITER_API_KEY;
  else process.env.JUPITER_API_KEY = savedEnv.key;
});

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const JUPITER_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const addressFrom = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));

type Seen = { url: string; init?: RequestInit };
type Reply = { status?: number; type?: string; body: unknown };

function stubFetch(route: (url: string, init?: RequestInit) => Reply, seen: Seen[] = []) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seen.push({ url, init });
    const reply = route(url, init);
    const body = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    return new Response(body, { status: reply.status ?? 200, headers: { "content-type": reply.type ?? "application/json" } });
  }) as typeof fetch;
}

// ── Prices ────────────────────────────────────────────────────────────────

test("a mint Jupiter does not price is absent from the price map, never 0", async () => {
  stubFetch(() => ({
    body: { [USDC]: { usdPrice: 0.9999, liquidity: 462734918.4, priceChange24h: 0.006, decimals: 6, blockId: 1, createdAt: "2024-06-05T08:55:25.527Z" } },
  }));
  const r = await readTokenPrices([USDC, JUP]);
  assert.equal(r.reachable, true);
  assert.equal(r.data?.[USDC]?.usdPrice, 0.9999);
  assert.equal(r.data?.[USDC]?.liquidityUsd, 462734918.4);
  assert.equal(JUP in (r.data ?? {}), false);
});

test("prices are requested 50 mints at a time, and one failed batch fails the read", async () => {
  const mints = Array.from({ length: 120 }, (_, i) => addressFrom(i + 1));
  const seen: Seen[] = [];
  stubFetch(() => ({ body: {} }), seen);
  const ok = await readTokenPrices(mints);
  assert.equal(ok.reachable, true);
  assert.equal(seen.length, 3);
  assert.equal(new URL(seen[0]!.url).searchParams.get("ids")?.split(",").length, 50);

  let call = 0;
  stubFetch(() => (++call === 2 ? { status: 429, body: { error: "Rate limit exceeded" } } : { body: {} }));
  const partial = await readTokenPrices(mints);
  assert.equal(partial.reachable, false, "a half-priced answer must not pass as complete");
  assert.equal(partial.data, null);
  assert.match(partial.error ?? "", /HTTP 429: Rate limit exceeded/);
});

test("an HTML error page is a failure with a reason, not an empty result", async () => {
  stubFetch(() => ({ status: 403, type: "text/html; charset=UTF-8", body: "<!DOCTYPE html><title>Just a moment...</title>" }));
  const r = await readTokenPrices([USDC]);
  assert.equal(r.reachable, false);
  assert.equal(r.data, null);
  assert.match(r.error ?? "", /HTTP 403.*HTML/);
});

test("JUPITER_API_URL and JUPITER_API_KEY route requests and authenticate them", async () => {
  process.env.JUPITER_API_URL = "https://api.jup.example/";
  process.env.JUPITER_API_KEY = "test-key";
  assert.deepEqual(jupiterConfig(), { baseUrl: "https://api.jup.example", apiKey: "test-key" });
  const seen: Seen[] = [];
  stubFetch(() => ({ body: {} }), seen);
  await readTokenPrices([USDC]);
  assert.ok(seen[0]!.url.startsWith("https://api.jup.example/price/v3?ids="));
  assert.equal((seen[0]!.init?.headers as Record<string, string>)["x-api-key"], "test-key");

  delete process.env.JUPITER_API_URL;
  delete process.env.JUPITER_API_KEY;
  assert.deepEqual(jupiterConfig(), { baseUrl: "https://lite-api.jup.ag" });
});

// ── Token records ─────────────────────────────────────────────────────────

test("Jupiter token records: 24h volume is buys plus sells, a missing verified flag is false, strays are dropped", async () => {
  stubFetch(() => ({
    body: [
      {
        id: JUP,
        name: "Jupiter",
        symbol: "JUP",
        decimals: 6,
        holderCount: 838880,
        usdPrice: 0.348,
        mcap: 1156283774.7,
        fdv: 2390160631.5,
        liquidity: 5680621.7,
        stats24h: { buyVolume: 8481740.36, sellVolume: 8008348.28 },
        isVerified: true,
        organicScore: 98.57,
        tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      },
      { id: addressFrom(7), name: "Unverified", symbol: "UNV", decimals: 9, holderCount: 12, organicScore: 3 },
      { id: addressFrom(8), name: "Fuzzy match nobody asked for", symbol: "JUPX" },
    ],
  }));
  const r = await readJupiterTokens([JUP, addressFrom(7)]);
  assert.equal(r.data?.length, 2);
  assert.equal(r.data?.[0]?.volume24hUsd, 8481740.36 + 8008348.28);
  assert.equal(r.data?.[0]?.isVerified, true);
  assert.equal(r.data?.[1]?.isVerified, false);
  assert.equal(r.data?.[1]?.usdPrice, null, "no price in the record means no price, not 0");
  assert.equal(r.data?.[1]?.volume24hUsd, null);
});

test("the top-traded list keeps Jupiter's order and reads the same fields", async () => {
  const seen: Seen[] = [];
  stubFetch(
    () => ({
      body: [
        { id: USDC, name: "USD Coin", symbol: "USDC", usdPrice: 1, mcap: 8.6e9, liquidity: 4.6e8, holderCount: 5248202, stats24h: { buyVolume: 1, sellVolume: 2 }, isVerified: true },
        { id: WSOL, name: "Wrapped SOL", symbol: "SOL", usdPrice: 120.5 },
      ],
    }),
    seen,
  );
  const r = await readTokenList(500);
  assert.match(seen[0]!.url, /\/tokens\/v2\/toptraded\/24h\?limit=100$/, "the category endpoint caps at 100");
  assert.equal(r.data?.[0]?.symbol, "USDC");
  assert.equal(r.data?.[0]?.volume24hUsd, 3);
  assert.equal(r.data?.[1]?.marketCapUsd, null);
  assert.equal(r.data?.[1]?.verified, false);
});

// ── DEX markets ───────────────────────────────────────────────────────────

const pair = (pairAddress: string, liquidityUsd: number | undefined, dexId = "orca") => ({
  chainId: "solana",
  dexId,
  url: `https://dexscreener.com/solana/${pairAddress.toLowerCase()}`,
  pairAddress,
  labels: ["wp"],
  baseToken: { address: JUP, name: "Jupiter", symbol: "JUP" },
  quoteToken: { address: WSOL, name: "Wrapped SOL", symbol: "SOL" },
  priceNative: "0.002889",
  priceUsd: "0.3481",
  txns: { h24: { buys: 13582, sells: 17919 } },
  volume: { h24: 4337338.87 },
  liquidity: liquidityUsd === undefined ? undefined : { usd: liquidityUsd, base: 1, quote: 1 },
  fdv: 2436707735,
  marketCap: 1155479643,
  pairCreatedAt: 1706675725000,
});

test("markets come back deepest first; unknown liquidity sorts last instead of as zero", async () => {
  stubFetch(() => ({ body: [pair(addressFrom(1), 91838.45, "meteora"), pair(addressFrom(2), undefined), pair(addressFrom(3), 2246754.07, "meteora"), pair(addressFrom(4), 819135.02)] }));
  const r = await readTokenMarkets(JUP, 10);
  assert.deepEqual(
    r.data?.map((m) => m.liquidityUsd),
    [2246754.07, 819135.02, 91838.45, null],
  );
  const top = r.data?.[0];
  assert.equal(top?.priceUsd, 0.3481);
  assert.equal(top?.priceNative, 0.002889);
  assert.deepEqual(top?.txns24h, { buys: 13582, sells: 17919 });
  assert.equal(top?.pairCreatedAt, "2024-01-31T04:35:25.000Z");
  assert.deepEqual(top?.quoteToken, { address: WSOL, symbol: "SOL" });
});

test("a DexScreener outage is a failure, never an empty market list", async () => {
  stubFetch(() => ({ status: 500, type: "text/html", body: "<html>error</html>" }));
  const r = await readTokenMarkets(JUP);
  assert.equal(r.reachable, false);
  assert.equal(r.data, null);
});

test("an unknown pair is a definite answer from a working DexScreener", async () => {
  stubFetch(() => ({ body: { schemaVersion: "1.0.0", pairs: null, pair: null } }));
  const r = await readMarketPair(addressFrom(9));
  assert.equal(r.reachable, true);
  assert.equal(r.data, null);
  assert.match(r.error ?? "", /no pair/);

  stubFetch(() => ({ body: { schemaVersion: "1.0.0", pairs: [pair(addressFrom(9), 5)], pair: pair(addressFrom(9), 5) } }));
  const found = await readMarketPair(addressFrom(9));
  assert.equal(found.data?.pairAddress, addressFrom(9));
});

// ── Swaps ─────────────────────────────────────────────────────────────────

const QUOTE = {
  inputMint: WSOL,
  inAmount: "100000000",
  outputMint: USDC,
  outAmount: "12043541",
  otherAmountThreshold: "11983324",
  swapMode: "ExactIn",
  slippageBps: 50,
  platformFee: null,
  priceImpactPct: "0.0123",
  routePlan: [
    { swapInfo: { ammKey: addressFrom(20), label: "Orca", inputMint: WSOL, outputMint: JUP, inAmount: "100000000", outAmount: "1" }, percent: 100, bps: null },
    { swapInfo: { ammKey: addressFrom(21), label: "Meteora DLMM", inputMint: JUP, outputMint: USDC, inAmount: "1", outAmount: "12043541" }, percent: null, bps: 10000 },
  ],
  contextSlot: 450580319,
  timeTaken: 0.0016,
};

test("a quote reports amounts as integer strings and price impact in percent", async () => {
  const seen: Seen[] = [];
  stubFetch(() => ({ body: QUOTE }), seen);
  const r = await readSwapQuote({ inputMint: WSOL, outputMint: USDC, amount: 100_000_000n, slippageBps: 50 });
  const url = new URL(seen[0]!.url);
  assert.equal(url.pathname, "/swap/v1/quote");
  assert.equal(url.searchParams.get("amount"), "100000000");
  assert.equal(r.data?.outAmount, "12043541");
  assert.equal(r.data?.otherAmountThreshold, "11983324");
  assert.equal(r.data?.priceImpactPct, 1.23, "Jupiter's fraction is scaled to percent");
  assert.deepEqual(r.data?.route, [
    { label: "Orca", inputMint: WSOL, outputMint: JUP, percent: 100 },
    { label: "Meteora DLMM", inputMint: JUP, outputMint: USDC, percent: 100 },
  ]);
  assert.equal(r.data?.contextSlot, "450580319");
  assert.deepEqual(r.data?.raw, QUOTE);
});

test("Jupiter's own reason for refusing a quote is passed through", async () => {
  stubFetch(() => ({ status: 400, body: { error: "The token 11111111111111111111111111111111 is not tradable", errorCode: "TOKEN_NOT_TRADABLE" } }));
  const r = await readSwapQuote({ inputMint: WSOL, outputMint: "11111111111111111111111111111111", amount: 1n, slippageBps: 50 });
  assert.equal(r.reachable, false);
  assert.match(r.error ?? "", /HTTP 400: The token .* is not tradable/);
  const bad = await readSwapQuote({ inputMint: WSOL, outputMint: USDC, amount: 0n, slippageBps: 50 });
  assert.equal(bad.reachable, false, "a zero amount is refused before any request");
});

const ix = (programId: string, data: string, accounts: Array<[string, boolean, boolean]> = []) => ({
  programId,
  accounts: accounts.map(([pubkey, isSigner, isWritable]) => ({ pubkey, isSigner, isWritable })),
  data,
});

test("swap instructions are ordered compute budget, setup, swap, cleanup, other — with roles mapped", async () => {
  const user = addressFrom(30);
  const ata = addressFrom(31);
  const pool = addressFrom(32);
  const seen: Seen[] = [];
  stubFetch(
    () => ({
      body: {
        tokenLedgerInstruction: null,
        computeBudgetInstructions: [ix("ComputeBudget111111111111111111111111111111", "AsBcFQA="), ix("ComputeBudget111111111111111111111111111111", "AxQXAQAAAAAA")],
        setupInstructions: [ix("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", "AQ==", [[user, true, true], [ata, false, true]])],
        swapInstruction: ix(JUPITER_PROGRAM, "5RfLl3rjrSo=", [[user, true, false], [ata, false, true], [pool, false, false]]),
        cleanupInstruction: ix("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "CQ==", [[ata, false, true], [user, false, true], [user, true, false]]),
        otherInstructions: [ix("11111111111111111111111111111111", "AgAAAA==", [[user, true, true], [addressFrom(33), false, true]])],
        addressLookupTableAddresses: [addressFrom(34)],
        prioritizationFeeLamports: 99999,
        computeUnitLimit: 1400000,
        simulationError: null,
      },
    }),
    seen,
  );
  const built = await fetchSwapInstructions(QUOTE, user);
  const body = JSON.parse(String(seen[0]!.init?.body)) as Record<string, unknown>;
  assert.equal(seen[0]!.init?.method, "POST");
  assert.equal(body.wrapAndUnwrapSol, true);
  assert.equal(body.dynamicComputeUnitLimit, true);
  assert.deepEqual(body.quoteResponse, QUOTE);

  assert.deepEqual(
    built.instructions.map((i) => i.programAddress),
    [
      "ComputeBudget111111111111111111111111111111",
      "ComputeBudget111111111111111111111111111111",
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      JUPITER_PROGRAM,
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "11111111111111111111111111111111",
    ],
  );
  assert.deepEqual(
    built.instructions[3]!.accounts.map((a) => a.role),
    ["readonly_signer", "writable", "readonly"],
  );
  assert.equal(built.instructions[2]!.accounts[0]!.role, "writable_signer");
  assert.equal(built.instructions[3]!.data, "5RfLl3rjrSo=");
  assert.deepEqual(built.addressLookupTables, [addressFrom(34)]);
  assert.equal(built.prioritizationFeeLamports, 99999);
  assert.equal(built.simulationError, null);
});

test("swap instructions throw rather than hand a write path something partial", async () => {
  const user = addressFrom(40);
  stubFetch(() => ({ status: 422, body: { error: "Failed to deserialize the JSON body into the target type: quoteResponse: missing field `inputMint`" } }));
  await assert.rejects(fetchSwapInstructions(QUOTE, user), /HTTP 422: Failed to deserialize/);

  stubFetch(() => ({ body: { computeBudgetInstructions: [], setupInstructions: [], otherInstructions: [], addressLookupTableAddresses: [] } }));
  await assert.rejects(fetchSwapInstructions(QUOTE, user), /no swap instruction/);

  stubFetch(() => ({
    body: { computeBudgetInstructions: [], setupInstructions: [], otherInstructions: [], addressLookupTableAddresses: [], swapInstruction: ix("not-a-program", "AA==") },
  }));
  await assert.rejects(fetchSwapInstructions(QUOTE, user), /no valid program id/);

  stubFetch(() => ({
    body: {
      tokenLedgerInstruction: ix(JUPITER_PROGRAM, "AA=="),
      computeBudgetInstructions: [],
      setupInstructions: [],
      otherInstructions: [],
      addressLookupTableAddresses: [],
      swapInstruction: ix(JUPITER_PROGRAM, "AA=="),
    },
  }));
  await assert.rejects(fetchSwapInstructions(QUOTE, user), /not requested/);

  await assert.rejects(fetchSwapInstructions(QUOTE, "not-an-address"), /userPublicKey/);
});
