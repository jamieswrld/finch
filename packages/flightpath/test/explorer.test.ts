import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  readChainStats,
  readContractVerification,
  readTokenHolders,
  readTokenProfile,
  readWalletHoldings,
  readWalletProfile,
} from "../src/explorer.ts";
import { getFlightpathTarget } from "../src/chain.ts";

/**
 * These tests never touch the network. They replay the exact response shapes
 * observed from robinhoodchain.blockscout.com and assert that the readers
 * turn them into honest, correctly-scaled results — and that the two failure
 * modes the real host exhibits (a Cloudflare challenge page, a 404 for an
 * unverified contract) are reported as what they are.
 */

const target = getFlightpathTarget();
const realFetch = globalThis.fetch;

type Route = { status: number; type: string; body: string };

function stubFetch(routes: Record<string, Route>) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const hit = Object.entries(routes).find(([suffix]) => url.includes(suffix));
    const route = hit?.[1] ?? { status: 404, type: "application/json", body: '{"message":"Not found"}' };
    return new Response(route.body, { status: route.status, headers: { "content-type": route.type } });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (body: unknown): Route => ({ status: 200, type: "application/json; charset=utf-8", body: JSON.stringify(body) });

test("a Cloudflare challenge page is reported as unreachable, never as empty data", async () => {
  stubFetch({
    "/api/v2/stats": { status: 403, type: "text/html; charset=UTF-8", body: "<!DOCTYPE html><title>Just a moment...</title>" },
  });
  const r = await readChainStats(target);
  assert.equal(r.reachable, false);
  assert.equal(r.data, null);
  assert.match(r.error ?? "", /challenge|HTML/i);
});

test("chain stats parse the observed Blockscout payload", async () => {
  stubFetch({
    "/api/v2/stats": json({
      total_blocks: "53606778",
      total_transactions: "593172267",
      total_addresses: "18785307",
      transactions_today: "12323987",
      average_block_time: 101.0,
      gas_prices: { slow: 0.29, average: 0.37, fast: 0.58 },
      coin_price: "2511.31",
    }),
  });
  const r = await readChainStats(target);
  assert.equal(r.reachable, true);
  assert.equal(r.data?.totalTransactions, 593_172_267);
  assert.equal(r.data?.transactionsToday, 12_323_987);
  assert.equal(r.data?.gasPricesGwei.fast, 0.58);
  assert.equal(r.data?.ethPriceUsd, 2511.31);
});

test("wallet profile merges summary and counters, scaling wei to ETH", async () => {
  stubFetch({
    "/addresses/0xabc/counters": json({ transactions_count: "13", token_transfers_count: "0" }),
    "/addresses/0xabc": json({
      hash: "0xabc",
      coin_balance: "18632076255444000",
      is_contract: false,
      is_verified: false,
      is_scam: false,
      name: null,
      has_tokens: false,
    }),
  });
  const r = await readWalletProfile("0xabc", target);
  assert.equal(r.reachable, true);
  assert.equal(r.data?.nativeBalanceEth, "0.018632");
  assert.equal(r.data?.transactionCount, 13);
  assert.equal(r.data?.isContract, false);
});

test("holdings accept Blockscout's bare-array shape and price what has a rate", async () => {
  stubFetch({
    "/token-balances": json([
      {
        token: { address_hash: "0xpons", symbol: "PONS", name: "Pons", decimals: "18", type: "ERC-20", exchange_rate: "0.41071" },
        value: "16680378605100000000000000",
      },
      { token: { address_hash: "0xlambo", symbol: "LAMBO", name: "Lambo", decimals: "18", type: "ERC-20", exchange_rate: null }, value: "2000000000000000000000" },
    ]),
  });
  const r = await readWalletHoldings("0xholder", target);
  assert.equal(r.reachable, true);
  assert.equal(r.data?.length, 2);
  assert.equal(r.data?.[0]?.balance, "16680378.6051");
  assert.equal(r.data?.[0]?.valueUsd, Number((16680378.6051 * 0.41071).toFixed(2)));
  assert.equal(r.data?.[1]?.priceUsd, null, "no rate means no invented USD value");
  assert.equal(r.data?.[1]?.valueUsd, null);
});

test("token profile reads holders, supply and market data", async () => {
  stubFetch({
    "/tokens/0xpons": json({
      address_hash: "0xpons",
      name: "Pons",
      symbol: "PONS",
      decimals: "18",
      type: "ERC-20",
      holders_count: "68573",
      total_supply: "1000000000000000000000000000",
      exchange_rate: "0.41071",
      circulating_market_cap: "292421152.0896474",
      volume_24h: "93708308.98850918",
    }),
  });
  const r = await readTokenProfile("0xpons", target);
  assert.equal(r.data?.holders, 68_573);
  assert.equal(r.data?.totalSupply, "1000000000");
  assert.equal(r.data?.marketCapUsd, 292421152.0896474);
});

test("holder share of supply is computed from the token's real supply", async () => {
  stubFetch({
    "/tokens/0xidx/holders": json({
      items: [
        { address: { hash: "0xwhale", is_contract: false }, value: "20658200000000000000000000" },
        { address: { hash: "0xdead", is_contract: false }, value: "19465484000000000000000000" },
      ],
      next_page_params: {},
    }),
    "/tokens/0xidx": json({ decimals: "18", total_supply: "1000000000000000000000000000", holders_count: "22651" }),
  });
  const r = await readTokenHolders("0xidx", 10, target);
  assert.equal(r.data?.totalHolders, 22_651);
  assert.equal(r.data?.holders[0]?.balance, "20658200");
  // 20,658,200 / 1,000,000,000 = 2.06582%
  assert.equal(r.data?.holders[0]?.supplyPct, 2.0658);
});

test("an unverified contract is a definite 'no', not an outage", async () => {
  stubFetch({}); // every route 404s
  const r = await readContractVerification("0x4211", target);
  assert.equal(r.reachable, true, "404 from smart-contracts means unverified, and the explorer answered");
  assert.equal(r.data?.verified, false);
});
