import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FINCH_REGISTRY_ABI,
  RegistryKind,
  RegistryStatus,
  getRegistryConfig,
  manifestHash,
  registryId,
} from "../src/registry.ts";

test("registry ids are namespaced so a finch and a nest can share a handle", () => {
  const finch = registryId("FINCH", "market-scout");
  const nest = registryId("NEST", "market-scout");
  assert.notEqual(finch, nest, "the same handle must not collide across kinds");
  assert.match(finch, /^0x[0-9a-f]{64}$/);
});

test("registry ids are deterministic", () => {
  assert.equal(registryId("FINCH", "market-scout"), registryId("FINCH", "market-scout"));
});

test("manifest hashing is deterministic and change-sensitive", () => {
  const manifest = JSON.stringify({ schema: "finch.manifest/0.1", identity: { handle: "a" } });
  const edited = JSON.stringify({ schema: "finch.manifest/0.1", identity: { handle: "b" } });
  assert.equal(manifestHash(manifest), manifestHash(manifest));
  assert.notEqual(manifestHash(manifest), manifestHash(edited));
  assert.match(manifestHash(manifest), /^0x[0-9a-f]{64}$/);
});

test("the registry reports unconfigured rather than guessing an address", () => {
  const previous = process.env.FINCH_REGISTRY_ADDRESS;
  delete process.env.FINCH_REGISTRY_ADDRESS;
  assert.equal(getRegistryConfig().configured, false);

  process.env.FINCH_REGISTRY_ADDRESS = "not-an-address";
  assert.equal(getRegistryConfig().configured, false, "a malformed address must not count as configured");

  process.env.FINCH_REGISTRY_ADDRESS = "0x1111111111111111111111111111111111111111";
  assert.equal(getRegistryConfig().configured, true);

  if (previous === undefined) delete process.env.FINCH_REGISTRY_ADDRESS;
  else process.env.FINCH_REGISTRY_ADDRESS = previous;
});

test("the ABI matches the deployed contract surface", () => {
  const names = FINCH_REGISTRY_ABI.map((entry) => entry.name);
  for (const required of [
    "register",
    "updateManifest",
    "setStatus",
    "transferRecord",
    "get",
    "exists",
    "Registered",
    "ManifestUpdated",
    "StatusChanged",
    "OwnerChanged",
  ]) {
    assert.ok(names.includes(required as never), `ABI is missing ${required}`);
  }
  assert.deepEqual(RegistryKind, { FINCH: 0, NEST: 1 });
  assert.deepEqual(RegistryStatus, { ACTIVE: 0, DEPRECATED: 1, REVOKED: 2 });
});
