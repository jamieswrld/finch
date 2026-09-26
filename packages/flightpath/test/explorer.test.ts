import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  createSolanaRpcFromTransport,
  generateKeyPairSigner,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
  type RpcTransport,
} from "@solana/kit";
import { NATIVE_CURRENCY, type FlightpathTarget } from "../src/chain.ts";
import {
  decodeMetaplexMetadata,
  readChainStats,
  readMintInfo,
  readProgramVerification,
  readTokenActivity,
  readTokenHolders,
  readTransaction,
  readWalletHoldings,
  readWalletProfile,
  readWalletTransactions,
} from "../src/explorer.ts";

/**
 * These tests never touch the network. The RPC is a real @solana/kit client
 * over a fake transport that answers with the JSON-RPC shapes observed from
 * mainnet; Jupiter and OtterSec are a stubbed fetch. They assert that reads
 * turn those shapes into honest, correctly scaled results — and that every
 * failure is reported as a failure, never as an empty list or a zero.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const SECRET_RPC = "https://rpc.example.test/?api-key=SECRET123";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** USDC's Metaplex metadata PDA, derived and read live from mainnet. */
const USDC_METADATA_PDA = "5x38Kp4hvdomTCnCrAny4UtMUt5rQBdB6px2K1Ui45Wq";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const SYSTEM = "11111111111111111111111111111111";

const addressFrom = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));
const signatureFrom = (fill: number) => getBase58Decoder().decode(new Uint8Array(64).fill(fill));
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

type Handler = (params: unknown[]) => unknown;

/** A FlightpathTarget whose RPC answers from `handlers`; an Error result becomes a transport failure. */
function fakeTarget(handlers: Record<string, Handler>, calls: Array<{ method: string; params: unknown[] }> = []): FlightpathTarget {
  const transport = (async ({ payload }: { payload: unknown }) => {
    const { id, method, params } = payload as { id: unknown; method: string; params: unknown[] };
    calls.push({ method, params });
    const handler = handlers[method];
    if (!handler) return { jsonrpc: "2.0", id, error: { code: -32601, message: `${method} not stubbed` } };
    const result = handler(params);
    if (result instanceof Error) throw result;
    return { jsonrpc: "2.0", id, result };
  }) as unknown as RpcTransport;
  return {
    cluster: "mainnet-beta",
    chain: "solana:mainnet",
    name: "Solana",
    rpcUrl: SECRET_RPC,
    rpcUrls: [SECRET_RPC],
    rpc: createSolanaRpcFromTransport(transport) as unknown as FlightpathTarget["rpc"],
    explorerUrl: "https://solscan.io",
    nativeCurrency: NATIVE_CURRENCY,
    devTarget: false,
    label: "test",
  };
}

const ctx = (value: unknown) => ({ context: { slot: 450_580_000 }, value });

type Route = { status: number; type: string; body: string };
const json = (body: unknown, status = 200): Route => ({ status, type: "application/json", body: JSON.stringify(body) });

function stubFetch(routes: Record<string, Route>, seen: string[] = []) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seen.push(url);
    const hit = Object.entries(routes).find(([fragment]) => url.includes(fragment));
    const route = hit?.[1] ?? { status: 404, type: "text/html", body: "<html>not found</html>" };
    return new Response(route.body, { status: route.status, headers: { "content-type": route.type } });
  }) as typeof fetch;
}

function mintAccount(info: Record<string, unknown>, owner = TOKEN) {
  return {
    data: { parsed: { info: { isInitialized: true, ...info }, type: "mint" }, program: owner === TOKEN ? "spl-token" : "spl-token-2022", space: 82 },
    executable: false,
    lamports: 534808027988,
    owner,
    rentEpoch: 0,
    space: 82,
  };
}

function borshString(value: string, width: number): Uint8Array {
  const out = new Uint8Array(4 + width);
  new DataView(out.buffer).setUint32(0, width, true);
  out.set(new TextEncoder().encode(value), 4); // the rest stays NUL padding, as Metaplex writes it
  return out;
}

function metaplexAccountBytes(mint: string, name: string, symbol: string, uri: string): Uint8Array {
  const parts = [
    Uint8Array.of(4),
    new Uint8Array(getAddressEncoder().encode(addressFrom(9))),
    new Uint8Array(getAddressEncoder().encode(mint as never)),
    borshString(name, 32),
    borshString(symbol, 10),
    borshString(uri, 200),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// ── Failure is failure ────────────────────────────────────────────────────

test("an RPC outage is reported as unreachable with a reason, and the endpoint key never leaks", async () => {
  const target = fakeTarget({
    getEpochInfo: () => new Error(`HTTP error (429): Too Many Requests for ${SECRET_RPC}`),
  });
  const r = await readChainStats(target);
  assert.equal(r.reachable, false);
  assert.equal(r.data, null);
  assert.match(r.error ?? "", /429/);
  assert.doesNotMatch(r.error ?? "", /SECRET123/, "RPC credentials must be scrubbed from errors");
});

test("chain stats read the node's counters and price SOL through Jupiter", async () => {
  stubFetch({ "/price/v3": json({ So11111111111111111111111111111111111111112: { usdPrice: 120.57, liquidity: 959737732.8, priceChange24h: 3.5, decimals: 9 } }) });
  const target = fakeTarget({
    getEpochInfo: () => ({ absoluteSlot: 450580000, blockHeight: 428600000, epoch: 1043, slotIndex: 108000, slotsInEpoch: 432000, transactionCount: null }),
    getTransactionCount: () => 523_000_000_000,
    // Beyond 2^53: the real transport parses these losslessly into bigint, so the fake hands bigint over.
    getSupply: () => ctx({ total: 634764251960871784n, circulating: 587713291760280269n, nonCirculating: 47050960200591515n, nonCirculatingAccounts: [] }),
    getRecentPerformanceSamples: () => [
      { slot: 450580000, numSlots: 150, numTransactions: 600000, numNonVoteTransactions: 120000, samplePeriodSecs: 60 },
      { slot: 450579850, numSlots: 150, numTransactions: 540000, numNonVoteTransactions: 108000, samplePeriodSecs: 60 },
    ],
  });
  const r = await readChainStats(target);
  assert.equal(r.reachable, true);
  assert.equal(r.data?.slot, "450580000");
  assert.equal(r.data?.epochProgressPct, 25);
  assert.equal(r.data?.transactionCount, "523000000000");
  assert.equal(r.data?.tps, 9500);
  assert.equal(r.data?.nonVoteTps, 1900);
  assert.equal(r.data?.slotTimeMs, 400);
  assert.equal(r.data?.supply?.totalSol, "634764251.960871784");
  assert.equal(r.data?.solPriceUsd, 120.57);
  assert.deepEqual(r.data?.notes, []);
});

test("an unreadable SOL price is null with a note, never 0", async () => {
  stubFetch({ "/price/v3": { status: 503, type: "text/html", body: "<html>down</html>" } });
  const target = fakeTarget({
    getEpochInfo: () => ({ absoluteSlot: 1, blockHeight: 1, epoch: 1, slotIndex: 1, slotsInEpoch: 2 }),
    getTransactionCount: () => 1,
    getSupply: () => ctx({ total: 1, circulating: 1, nonCirculating: 0, nonCirculatingAccounts: [] }),
    getRecentPerformanceSamples: () => [],
  });
  const r = await readChainStats(target);
  assert.equal(r.reachable, true);
  assert.equal(r.data?.solPriceUsd, null);
  assert.match(r.data?.notes.join(" ") ?? "", /SOL price unavailable.*503/);
});

// ── Mints and metadata ────────────────────────────────────────────────────

test("Metaplex metadata is decoded by hand, NUL padding trimmed, empty uri null", async () => {
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const target = fakeTarget(
    {
      getAccountInfo: ([address]) => {
        if (address === USDC) {
          return ctx(mintAccount({ decimals: 6, supply: "8598572627378412", mintAuthority: addressFrom(1), freezeAuthority: addressFrom(2) }));
        }
        return ctx({
          data: [b64(metaplexAccountBytes(USDC, "USD Coin", "USDC", "")), "base64"],
          executable: false,
          lamports: 5616720,
          owner: METADATA_PROGRAM,
          rentEpoch: 0,
          space: 679,
        });
      },
    },
    calls,
  );
  const r = await readMintInfo(USDC, target);
  assert.equal(r.reachable, true);
  assert.equal(r.data?.name, "USD Coin");
  assert.equal(r.data?.symbol, "USDC");
  assert.equal(r.data?.uri, null);
  assert.equal(r.data?.metadataSource, "metaplex");
  assert.equal(r.data?.supplyFormatted, "8598572627.378412");
  assert.equal(r.data?.tokenProgram, TOKEN);
  assert.equal(calls[1]?.params[0], USDC_METADATA_PDA, "metadata is read from the canonical PDA");
});

test("the Metaplex decoder rejects accounts that are not MetadataV1", () => {
  const bytes = metaplexAccountBytes(USDC, "USD Coin", "USDC", "https://example.test/usdc.json");
  assert.equal(decodeMetaplexMetadata(bytes)?.uri, "https://example.test/usdc.json");
  const wrongKey = bytes.slice();
  wrongKey[0] = 7;
  assert.equal(decodeMetaplexMetadata(wrongKey), null);
  assert.equal(decodeMetaplexMetadata(bytes.slice(0, 70)), null, "a truncated account is not decoded into garbage");
});

test("Token-2022 metadata comes from the mint's own extension, with no second read", async () => {
  const mint = addressFrom(3);
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const target = fakeTarget(
    {
      getAccountInfo: () =>
        ctx(
          mintAccount(
            {
              decimals: 6,
              supply: "778691265009151",
              mintAuthority: null,
              freezeAuthority: null,
              extensions: [{ extension: "tokenMetadata", state: { name: "PayPal USD", symbol: "PYUSD", uri: "https://example.test/pyusd.json", additionalMetadata: [] } }],
            },
            TOKEN_2022,
          ),
        ),
    },
    calls,
  );
  const r = await readMintInfo(mint, target);
  assert.equal(r.data?.symbol, "PYUSD");
  assert.equal(r.data?.metadataSource, "token-2022");
  assert.equal(r.data?.mintAuthority, null);
  assert.equal(calls.length, 1);
});

test("a non-mint account is a definite answer from a working RPC, not an outage", async () => {
  const target = fakeTarget({
    getAccountInfo: () => ctx({ data: ["", "base64"], executable: false, lamports: 1000000, owner: SYSTEM, rentEpoch: 0, space: 0 }),
  });
  const r = await readMintInfo(addressFrom(4), target);
  assert.equal(r.reachable, true);
  assert.equal(r.data, null);
  assert.match(r.error ?? "", /not an SPL token mint/);
});

// ── Holders ───────────────────────────────────────────────────────────────

test("holder share of supply is exact, and PDA owners are flagged as program-controlled", async () => {
  const wallet = (await generateKeyPairSigner()).address; // on the curve: a key someone holds
  const mint = addressFrom(5);
  const [acctA, acctB] = [addressFrom(6), addressFrom(7)];
  stubFetch({ "/tokens/v2/search": json([{ id: mint, name: "Test", symbol: "TST", decimals: 6, holderCount: 22651 }]) });
  const target = fakeTarget({
    getAccountInfo: () => ctx(mintAccount({ decimals: 6, supply: "1000000000000000", mintAuthority: null, freezeAuthority: null })),
    getTokenLargestAccounts: () =>
      ctx([
        { address: acctA, amount: "206582000000000", decimals: 6, uiAmount: 206582000, uiAmountString: "206582000" },
        { address: acctB, amount: "19465484000000", decimals: 6, uiAmount: 19465484, uiAmountString: "19465484" },
      ]),
    getMultipleAccounts: () =>
      ctx([
        { data: { parsed: { info: { mint, owner: USDC_METADATA_PDA, tokenAmount: {} }, type: "account" }, program: "spl-token", space: 165 }, executable: false, lamports: 2039280, owner: TOKEN, rentEpoch: 0, space: 165 },
        { data: { parsed: { info: { mint, owner: wallet, tokenAmount: {} }, type: "account" }, program: "spl-token", space: 165 }, executable: false, lamports: 2039280, owner: TOKEN, rentEpoch: 0, space: 165 },
      ]),
  });
  const r = await readTokenHolders(mint, 10, target);
  assert.equal(r.reachable, true);
  assert.equal(r.data?.holderCount, 22_651);
  const [first, second] = r.data?.holders ?? [];
  // 206,582,000 of 1,000,000,000 = 20.6582%
  assert.equal(first?.sharePct, 20.6582);
  assert.equal(first?.amount, "206582000");
  assert.equal(first?.ownerIsProgramDerived, true);
  assert.equal(second?.sharePct, 1.9465);
  assert.equal(second?.owner, wallet);
  assert.equal(second?.ownerIsProgramDerived, false);
});

test("a refused largest-accounts read fails the holder read instead of returning an empty list", async () => {
  stubFetch({ "/tokens/v2/search": json([]) });
  const target = fakeTarget({
    getAccountInfo: () => ctx(mintAccount({ decimals: 6, supply: "1", mintAuthority: null, freezeAuthority: null })),
    getTokenLargestAccounts: () => new Error("HTTP error (429): Too Many Requests"),
  });
  const r = await readTokenHolders(addressFrom(5), 10, target);
  assert.equal(r.reachable, false);
  assert.equal(r.data, null);
  assert.match(r.error ?? "", /largest accounts unavailable.*429/);
});

// ── Transactions and activity ─────────────────────────────────────────────

function parsedTx(opts: {
  signature: string;
  keys: Array<{ pubkey: string; signer?: boolean }>;
  pre: number[];
  post: number[];
  preTokens?: unknown[];
  postTokens?: unknown[];
  err?: unknown;
  logs?: string[];
  programs?: string[];
  inner?: string[];
}) {
  return {
    slot: 450580873,
    blockTime: 1790400622,
    version: 0,
    meta: {
      err: opts.err ?? null,
      status: opts.err ? { Err: opts.err } : { Ok: null },
      fee: 5000,
      computeUnitsConsumed: 52673,
      preBalances: opts.pre,
      postBalances: opts.post,
      preTokenBalances: opts.preTokens ?? [],
      postTokenBalances: opts.postTokens ?? [],
      logMessages: opts.logs ?? [],
      innerInstructions: [{ index: 0, instructions: (opts.inner ?? []).map((programId) => ({ programId, accounts: [], data: "" })) }],
      rewards: [],
    },
    transaction: {
      signatures: [opts.signature],
      message: {
        accountKeys: opts.keys.map((k) => ({ pubkey: k.pubkey, signer: k.signer ?? false, writable: true, source: "transaction" })),
        instructions: (opts.programs ?? []).map((programId) => ({ programId, accounts: [], data: "" })),
        recentBlockhash: addressFrom(8),
      },
    },
  };
}

const tokenBalance = (accountIndex: number, mint: string, owner: string, amount: string, decimals = 6) => ({
  accountIndex,
  mint,
  owner,
  programId: TOKEN,
  uiTokenAmount: { amount, decimals, uiAmount: null, uiAmountString: "" },
});

test("token activity reports each account's change in this mint only, and marks unreadable rows", async () => {
  const mint = addressFrom(10);
  const other = addressFrom(11);
  const [payer, acctA, acctB, acctC] = [addressFrom(12), addressFrom(13), addressFrom(14), addressFrom(15)];
  const [ownerA, ownerB] = [addressFrom(16), addressFrom(17)];
  const [sig1, sig2] = [signatureFrom(1), signatureFrom(2)];
  const target = fakeTarget({
    getSignaturesForAddress: () => [
      { signature: sig1, slot: 450580873, blockTime: 1790400622, err: null, memo: null, confirmationStatus: "finalized" },
      { signature: sig2, slot: 450580870, blockTime: 1790400621, err: null, memo: null, confirmationStatus: "finalized" },
    ],
    getTransaction: ([signature]) => {
      if (signature === sig2) return new Error("HTTP error (429): Too Many Requests");
      return parsedTx({
        signature: sig1,
        keys: [{ pubkey: payer, signer: true }, { pubkey: acctA }, { pubkey: acctB }, { pubkey: acctC }],
        pre: [1_000_000_000, 2039280, 0, 2039280],
        post: [997_955_720, 2039280, 2039280, 2039280],
        // A: 150 → 87.5; B created with 62.5; C moves a different mint and is ignored.
        preTokens: [tokenBalance(1, mint, ownerA, "150000000"), tokenBalance(3, other, ownerA, "5")],
        postTokens: [tokenBalance(1, mint, ownerA, "87500000"), tokenBalance(2, mint, ownerB, "62500000"), tokenBalance(3, other, ownerA, "1")],
      });
    },
  });
  const r = await readTokenActivity(mint, 10, target);
  assert.equal(r.reachable, true);
  assert.deepEqual(r.data?.[0]?.changes, [
    { owner: ownerA, tokenAccount: acctA, delta: "-62.5" },
    { owner: ownerB, tokenAccount: acctB, delta: "62.5" },
  ]);
  assert.equal(r.data?.[1]?.changes, null, "an unreadable transaction is not shown as 'no changes'");
  assert.match(r.data?.[1]?.detailError ?? "", /429/);
  assert.match(r.error ?? "", /1 of 2/);
});

test("wallet transactions compute the SOL change for the address asked about", async () => {
  const [payer, recipient] = [addressFrom(20), addressFrom(21)];
  const sig = signatureFrom(3);
  const target = fakeTarget({
    getSignaturesForAddress: () => [{ signature: sig, slot: 450580873, blockTime: 1790400622, err: null, memo: "[5] hello", confirmationStatus: "finalized" }],
    getTransaction: () =>
      parsedTx({
        signature: sig,
        keys: [{ pubkey: payer, signer: true }, { pubkey: recipient }, { pubkey: SYSTEM }],
        pre: [2_000_000_000, 0, 1],
        post: [1_899_995_000, 100_000_000, 1],
        programs: [SYSTEM, "ComputeBudget111111111111111111111111111111"],
      }),
  });
  const r = await readWalletTransactions(recipient, 50, target);
  assert.equal(r.data?.length, 1);
  assert.equal(r.data?.[0]?.solChange, "0.1");
  assert.equal(r.data?.[0]?.feeSol, "0.000005");
  assert.equal(r.data?.[0]?.memo, "[5] hello");
  assert.deepEqual(r.data?.[0]?.programs, [SYSTEM, "ComputeBudget111111111111111111111111111111"]);
  assert.equal(r.data?.[0]?.explorerUrl, `https://solscan.io/tx/${sig}`);
});

test("a transaction the RPC does not have is a definite 'not found', not an outage", async () => {
  const target = fakeTarget({ getTransaction: () => null });
  const r = await readTransaction(signatureFrom(4), target);
  assert.equal(r.reachable, true);
  assert.equal(r.data, null);
  assert.equal(r.error, "transaction not found");
});

test("a failed transaction keeps its error, balance changes and only the last 12 log lines", async () => {
  const mint = addressFrom(30);
  const [payer, acct] = [addressFrom(31), addressFrom(32)];
  const sig = signatureFrom(5);
  const logs = Array.from({ length: 20 }, (_, i) => `Program log: line ${i + 1}`);
  const target = fakeTarget({
    getTransaction: () =>
      parsedTx({
        signature: sig,
        keys: [{ pubkey: payer, signer: true }, { pubkey: acct }],
        pre: [1_000_000_000, 2039280],
        post: [999_995_000, 2039280],
        preTokens: [tokenBalance(1, mint, payer, "1000")],
        postTokens: [tokenBalance(1, mint, payer, "1000")],
        err: { InstructionError: [2, { Custom: 6001 }] },
        logs,
        programs: ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"],
        inner: [TOKEN],
      }),
  });
  const r = await readTransaction(sig, target);
  assert.equal(r.data?.status, "failed");
  assert.equal(r.data?.error, '{"InstructionError":[2,{"Custom":6001}]}');
  assert.deepEqual(r.data?.solChanges, [{ address: payer, delta: "-0.000005" }]);
  assert.deepEqual(r.data?.tokenChanges, [], "a balance that did not move is not a change");
  assert.equal(r.data?.logTail.length, 12);
  assert.equal(r.data?.logTail[11], "Program log: line 20");
  assert.deepEqual(r.data?.programs, ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", TOKEN]);
  assert.equal(r.data?.feePayer, payer);
  assert.equal(r.data?.computeUnits, "52673");
});

// ── Holdings ──────────────────────────────────────────────────────────────

test("holdings price what Jupiter prices; unpriced tokens are null, never 0", async () => {
  const owner = addressFrom(40);
  const [priced, unpriced, empty] = [addressFrom(41), addressFrom(42), addressFrom(43)];
  const tokenAccount = (mint: string, amount: string, decimals: number, program = "spl-token") => ({
    pubkey: addressFrom(amount.length + decimals + 50),
    account: {
      data: { parsed: { info: { mint, owner, state: "initialized", tokenAmount: { amount, decimals, uiAmount: 0, uiAmountString: "" } }, type: "account" }, program, space: 165 },
      executable: false,
      lamports: 2039280,
      owner: program === "spl-token" ? TOKEN : TOKEN_2022,
      rentEpoch: 0,
      space: 165,
    },
  });
  stubFetch({
    "/price/v3": json({ [priced]: { usdPrice: 0.5, liquidity: 1000, priceChange24h: 1, decimals: 6 } }),
    "/tokens/v2/search": json([{ id: priced, name: "Priced", symbol: "PRC", decimals: 6 }]),
  });
  const target = fakeTarget({
    getTokenAccountsByOwner: ([, filter]) =>
      (filter as { programId: string }).programId === TOKEN
        ? ctx([tokenAccount(unpriced, "5000", 2), tokenAccount(empty, "0", 6)])
        : ctx([tokenAccount(priced, "12500000", 6, "spl-token-2022")]),
  });
  const r = await readWalletHoldings(owner, target);
  assert.equal(r.reachable, true);
  assert.equal(r.data?.length, 2, "zero balances are left out");
  assert.equal(r.data?.[0]?.mint, priced, "priced holdings sort first by value");
  assert.equal(r.data?.[0]?.valueUsd, 6.25);
  assert.equal(r.data?.[0]?.tokenProgram, TOKEN_2022);
  assert.equal(r.data?.[1]?.amount, "50");
  assert.equal(r.data?.[1]?.priceUsd, null);
  assert.equal(r.data?.[1]?.valueUsd, null);
});

test("holdings stay readable when Jupiter is down, with prices null and the reason attached", async () => {
  stubFetch({ "jup.ag": { status: 502, type: "text/html", body: "<html>bad gateway</html>" } });
  const mint = addressFrom(44);
  const target = fakeTarget({
    getTokenAccountsByOwner: ([, filter]) =>
      (filter as { programId: string }).programId === TOKEN
        ? ctx([
            {
              pubkey: addressFrom(45),
              account: {
                data: { parsed: { info: { mint, tokenAmount: { amount: "1", decimals: 0 } }, type: "account" }, program: "spl-token", space: 165 },
                executable: false,
                lamports: 1,
                owner: TOKEN,
                rentEpoch: 0,
                space: 165,
              },
            },
          ])
        : ctx([]),
  });
  const r = await readWalletHoldings(addressFrom(46), target);
  assert.equal(r.reachable, true);
  assert.equal(r.data?.[0]?.priceUsd, null);
  assert.match(r.error ?? "", /prices unavailable.*502/);
});

// ── Addresses and programs ────────────────────────────────────────────────

test("a wallet profile says what the address is and what RPC cannot tell", async () => {
  const wallet = addressFrom(50);
  const target = fakeTarget({
    getAccountInfo: () => ctx({ data: ["", "base64"], executable: false, lamports: 1_500_000_000, owner: SYSTEM, rentEpoch: 0, space: 0 }),
    getSignaturesForAddress: () => [
      { signature: signatureFrom(6), slot: 2, blockTime: 1790400622, err: null, memo: null },
      { signature: signatureFrom(7), slot: 1, blockTime: 1790000000, err: null, memo: null },
    ],
    getTokenAccountsByOwner: ([, filter]) =>
      ctx((filter as { programId: string }).programId === TOKEN ? [{ pubkey: addressFrom(51), account: {} }, { pubkey: addressFrom(52), account: {} }] : [{ pubkey: addressFrom(53), account: {} }]),
  });
  const r = await readWalletProfile(wallet, target);
  assert.equal(r.data?.kind, "wallet");
  assert.equal(r.data?.sol, "1.5");
  assert.equal(r.data?.tokenAccounts, 3);
  assert.equal(r.data?.recentActivity?.signatures, 2);
  assert.equal(r.data?.recentActivity?.windowFull, false);
  assert.equal(r.data?.recentActivity?.oldest, new Date(1790000000 * 1000).toISOString());
  assert.match(r.data?.activityNote ?? "", /no lifetime transaction count/);
});

function programAccounts(authority: string | null, slot: bigint) {
  const programData = addressFrom(60);
  const head = new Uint8Array(36);
  new DataView(head.buffer).setUint32(0, 2, true);
  head.set(getAddressEncoder().encode(programData), 4);
  const header = new Uint8Array(45);
  const view = new DataView(header.buffer);
  view.setUint32(0, 3, true);
  view.setBigUint64(4, slot, true);
  if (authority) {
    header[12] = 1;
    header.set(getAddressEncoder().encode(authority as never), 13);
  }
  return { programData, head, header };
}

test("program verification follows the upgradeable loader to the upgrade authority", async () => {
  const program = addressFrom(61);
  const authority = addressFrom(62);
  const { programData, head, header } = programAccounts(authority, 449_280_566n);
  stubFetch({
    "verify.osec.io/status/": json({
      is_verified: true,
      message: "On chain program verified",
      on_chain_hash: "435d",
      executable_hash: "435d",
      repo_url: "https://github.com/example/program",
      commit: "a94dd197",
      last_verified_at: "2026-06-04T03:10:01.260080",
      is_frozen: false,
      is_closed: false,
    }),
  });
  const target = fakeTarget({
    getAccountInfo: ([address]) =>
      address === programData
        ? ctx({ data: [b64(header), "base64"], executable: false, lamports: 1, owner: UPGRADEABLE_LOADER, rentEpoch: 0, space: 2892269 })
        : ctx({ data: [b64(head), "base64"], executable: true, lamports: 1, owner: UPGRADEABLE_LOADER, rentEpoch: 0, space: 36 }),
  });
  const r = await readProgramVerification(program, target);
  assert.equal(r.reachable, true);
  assert.equal(r.data?.loader, "bpf-upgradeable-loader");
  assert.equal(r.data?.upgradeable, true);
  assert.equal(r.data?.upgradeAuthority, authority);
  assert.equal(r.data?.immutable, false);
  assert.equal(r.data?.lastDeploySlot, "449280566");
  assert.equal(r.data?.verifiedBuild?.verified, true);
  assert.equal(r.data?.verifiedBuild?.commit, "a94dd197");
});

test("an immutable program with an unreachable verifier reports both facts separately", async () => {
  const program = addressFrom(63);
  const { programData, head, header } = programAccounts(null, 10n);
  stubFetch({ "verify.osec.io": { status: 500, type: "text/plain", body: "internal error" } });
  const target = fakeTarget({
    getAccountInfo: ([address]) =>
      address === programData
        ? ctx({ data: [b64(header), "base64"], executable: false, lamports: 1, owner: UPGRADEABLE_LOADER, rentEpoch: 0, space: 45 })
        : ctx({ data: [b64(head), "base64"], executable: true, lamports: 1, owner: UPGRADEABLE_LOADER, rentEpoch: 0, space: 36 }),
  });
  const r = await readProgramVerification(program, target);
  assert.equal(r.data?.immutable, true);
  assert.equal(r.data?.upgradeAuthority, null);
  assert.equal(r.data?.verifiedBuild, null, "no verifier answer is not 'unverified'");
  assert.match(r.data?.verifiedBuildError ?? "", /ottersec HTTP 500/);
});
