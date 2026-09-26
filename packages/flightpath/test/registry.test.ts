import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REGISTRY_MEMO_PREFIX,
  getRegistryConfig,
  indexRegistrations,
  manifestHash,
  parseRegistryMemo,
  registryId,
  registryMemo,
  verifyManifestAgainstRegistry,
} from "../src/registry.ts";
import { addresses, fakeRpc, fakeTarget } from "./solana-fixture.ts";

const [AUTHORITY, IMPOSTOR] = await addresses(2);
const HASH = "a".repeat(64);

function withAuthority<T>(value: string | undefined, run: () => Promise<T> | T): Promise<T> {
  const previous = process.env.FINCH_REGISTRY_AUTHORITY;
  if (value === undefined) delete process.env.FINCH_REGISTRY_AUTHORITY;
  else process.env.FINCH_REGISTRY_AUTHORITY = value;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (previous === undefined) delete process.env.FINCH_REGISTRY_AUTHORITY;
      else process.env.FINCH_REGISTRY_AUTHORITY = previous;
    });
}

test("registry ids are namespaced so a finch and a nest can share a handle", () => {
  assert.equal(registryId("FINCH", "market-scout"), "finch:market-scout");
  assert.equal(registryId("NEST", "market-scout"), "nest:market-scout");
});

test("manifest hashing is deterministic and change-sensitive", async () => {
  const a = await manifestHash('{"schema":"finch.manifest/0.1"}');
  assert.equal(a, await manifestHash('{"schema":"finch.manifest/0.1"}'));
  assert.notEqual(a, await manifestHash('{"schema":"finch.manifest/0.2"}'));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("a registration memo round-trips exactly, and nothing else parses as one", () => {
  const memo = registryMemo({ kind: "FINCH", handle: "market-scout", manifestHash: HASH, uri: "https://finch.fun/m/market-scout.json" });
  assert.equal(memo, `${REGISTRY_MEMO_PREFIX} register finch:market-scout sha256:${HASH} https://finch.fun/m/market-scout.json`);
  assert.deepEqual(parseRegistryMemo(memo), {
    kind: "FINCH",
    handle: "market-scout",
    manifestHash: HASH,
    uri: "https://finch.fun/m/market-scout.json",
  });
  for (const junk of [
    "hello",
    `${REGISTRY_MEMO_PREFIX} register finch:market-scout sha256:xyz`,
    `${REGISTRY_MEMO_PREFIX} revoke finch:market-scout sha256:${HASH}`,
    `${REGISTRY_MEMO_PREFIX} register robot:x sha256:${HASH}`,
    `${REGISTRY_MEMO_PREFIX} register finch:Market sha256:${HASH}`,
  ]) {
    assert.equal(parseRegistryMemo(junk), null, `"${junk}" must not parse as a registration`);
  }
  assert.throws(() => registryMemo({ kind: "NEST", handle: "x y", manifestHash: HASH }));
});

test("the registry reports unconfigured rather than guessing an authority", async () => {
  await withAuthority(undefined, () => assert.equal(getRegistryConfig(fakeTarget(fakeRpc().rpc)).configured, false));
  await withAuthority("not-an-address", () =>
    assert.equal(getRegistryConfig(fakeTarget(fakeRpc().rpc)).configured, false, "a malformed address must not count as configured"),
  );
  await withAuthority(AUTHORITY, () => assert.equal(getRegistryConfig(fakeTarget(fakeRpc().rpc)).configured, true));
});

test("REGRESSION: a memo that merely mentions the authority is not a registration", async () => {
  // Anyone can send a transaction that touches the authority's address with a
  // lookalike memo; it shows up in the authority's signature history. Only a
  // transaction the authority SIGNED may count.
  const genuine = registryMemo({ kind: "FINCH", handle: "market-scout", manifestHash: HASH });
  const forged = registryMemo({ kind: "FINCH", handle: "market-scout", manifestHash: "b".repeat(64) });
  const { rpc } = fakeRpc({
    getSignaturesForAddress: () => [
      { signature: "forged-sig", slot: 20n, blockTime: 1_790_000_100n, err: null, memo: `[${forged.length}] ${forged}` },
      { signature: "genuine-sig", slot: 10n, blockTime: 1_790_000_000n, err: null, memo: `[${genuine.length}] ${genuine}` },
    ],
    getTransaction: (signature: unknown) => ({
      meta: { err: null },
      transaction: {
        message: {
          accountKeys:
            signature === "genuine-sig"
              ? [{ pubkey: AUTHORITY, signer: true }]
              : [{ pubkey: IMPOSTOR, signer: true }, { pubkey: AUTHORITY, signer: false }],
          instructions: [{ program: "spl-memo", parsed: signature === "genuine-sig" ? genuine : forged }],
        },
      },
    }),
  });
  await withAuthority(AUTHORITY, async () => {
    const target = fakeTarget(rpc);
    const index = await indexRegistrations(target);
    assert.equal(index.scanned, 2);
    assert.deepEqual(index.events.map((event) => event.signature), ["genuine-sig"]);
    assert.equal(index.events[0]!.manifestHash, HASH);
  });
});

test("verification compares the manifest against the anchored hash", async () => {
  const manifest = '{"schema":"finch.manifest/0.1","identity":{"handle":"watchtower"}}';
  const hash = await manifestHash(manifest);
  const memo = registryMemo({ kind: "FINCH", handle: "watchtower", manifestHash: hash });
  const { rpc } = fakeRpc({
    getSignaturesForAddress: () => [{ signature: "anchor-sig", slot: 5n, blockTime: null, err: null, memo: `[${memo.length}] ${memo}` }],
    getTransaction: () => ({
      meta: { err: null },
      transaction: { message: { accountKeys: [{ pubkey: AUTHORITY, signer: true }], instructions: [{ program: "spl-memo", parsed: memo }] } },
    }),
  });
  await withAuthority(AUTHORITY, async () => {
    // A distinct cluster label keeps this index out of the other test's cache.
    const target = { ...fakeTarget(rpc), chain: "solana:testnet" as const };
    const same = await verifyManifestAgainstRegistry("FINCH", "watchtower", manifest, target);
    assert.equal(same.registered, true);
    assert.equal(same.matches, true);
    const edited = await verifyManifestAgainstRegistry("FINCH", "watchtower", manifest.replace("watchtower", "watchtower "), target);
    assert.equal(edited.matches, false);
    const unknown = await verifyManifestAgainstRegistry("NEST", "watchtower", manifest, target);
    assert.equal(unknown.registered, false, "the namespace matters: a finch anchor is not a nest anchor");
  });
});
