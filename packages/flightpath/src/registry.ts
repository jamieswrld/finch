import { createPublicClient, keccak256, toHex, type Address, type Hex, type PublicClient } from "viem";
import { explorerAddressUrl, getFlightpathTarget, type FlightpathTarget } from "./chain.ts";

/**
 * FinchRegistry — the canonical public identity layer on Robinhood Chain.
 *
 * Registration is permissionless: an id, an owner, a manifest hash, a manifest
 * URI, a version and a status, all event-emitting. The manifest body lives
 * offchain where large data belongs; the hash onchain is what makes it
 * verifiable. MongoDB indexes these events for search — it is a cache, and if
 * it vanished the registry could be rebuilt from chain 4663 alone.
 *
 * Every accessor reports unconfigured until FINCH_REGISTRY_ADDRESS is set.
 * Nothing here invents a registration that does not exist.
 */

export const FINCH_REGISTRY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "kind", type: "uint8" },
      { name: "manifestHash", type: "bytes32" },
      { name: "manifestURI", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "updateManifest",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "manifestHash", type: "bytes32" },
      { name: "manifestURI", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setStatus",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "status", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "transferRecord",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "newOwner", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "get",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "owner", type: "address" },
          { name: "kind", type: "uint8" },
          { name: "status", type: "uint8" },
          { name: "version", type: "uint64" },
          { name: "updatedAt", type: "uint64" },
          { name: "manifestHash", type: "bytes32" },
          { name: "manifestURI", type: "string" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "exists",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "Registered",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "kind", type: "uint8", indexed: true },
      { name: "manifestHash", type: "bytes32", indexed: false },
      { name: "manifestURI", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ManifestUpdated",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "version", type: "uint64", indexed: false },
      { name: "manifestHash", type: "bytes32", indexed: false },
      { name: "manifestURI", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "StatusChanged",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "status", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OwnerChanged",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "previousOwner", type: "address", indexed: true },
      { name: "newOwner", type: "address", indexed: true },
    ],
  },
] as const;

export const RegistryKind = { FINCH: 0, NEST: 1 } as const;
export type RegistryKindName = keyof typeof RegistryKind;

export const RegistryStatus = { ACTIVE: 0, DEPRECATED: 1, REVOKED: 2 } as const;
export type RegistryStatusName = keyof typeof RegistryStatus;

const KIND_NAMES: RegistryKindName[] = ["FINCH", "NEST"];
const STATUS_NAMES: RegistryStatusName[] = ["ACTIVE", "DEPRECATED", "REVOKED"];

export interface RegistryRecord {
  id: Hex;
  owner: Address;
  kind: RegistryKindName;
  status: RegistryStatusName;
  version: number;
  updatedAt: string;
  manifestHash: Hex;
  manifestURI: string;
}

export interface RegistryConfig {
  configured: boolean;
  address?: Address;
  explorerUrl?: string | null;
}

export function getRegistryConfig(target: FlightpathTarget = getFlightpathTarget()): RegistryConfig {
  const address = (typeof process !== "undefined" ? process.env.FINCH_REGISTRY_ADDRESS : undefined) as
    | Address
    | undefined;
  const valid = Boolean(address && /^0x[a-fA-F0-9]{40}$/.test(address));
  return {
    configured: valid,
    address: valid ? address : undefined,
    explorerUrl: valid ? explorerAddressUrl(address as string, target) : null,
  };
}

/**
 * Registry ids are namespaced so a finch and a nest can share a handle without
 * colliding: keccak256 over "finch:market-scout".
 */
export function registryId(kind: RegistryKindName, handle: string): Hex {
  return keccak256(toHex(`${kind.toLowerCase()}:${handle}`));
}

/** The hash that anchors a manifest. Callers must hash the exact bytes they publish. */
export function manifestHash(manifestJson: string): Hex {
  return keccak256(toHex(manifestJson));
}

interface RawRecord {
  owner: Address;
  kind: number;
  status: number;
  version: bigint;
  updatedAt: bigint;
  manifestHash: Hex;
  manifestURI: string;
}

function decodeRecord(id: Hex, raw: RawRecord): RegistryRecord {
  return {
    id,
    owner: raw.owner,
    kind: KIND_NAMES[raw.kind] ?? "FINCH",
    status: STATUS_NAMES[raw.status] ?? "ACTIVE",
    version: Number(raw.version),
    updatedAt: new Date(Number(raw.updatedAt) * 1000).toISOString(),
    manifestHash: raw.manifestHash,
    manifestURI: raw.manifestURI,
  };
}

function client(target: FlightpathTarget): PublicClient {
  return createPublicClient({ chain: target.chain, transport: target.transport }) as PublicClient;
}

/** Read one record. Null when the registry is unconfigured or the id is unregistered. */
export async function readRegistryRecord(
  id: Hex,
  target: FlightpathTarget = getFlightpathTarget(),
): Promise<RegistryRecord | null> {
  const config = getRegistryConfig(target);
  if (!config.configured || !config.address) return null;
  try {
    const raw = await client(target).readContract({
      address: config.address,
      abi: FINCH_REGISTRY_ABI,
      functionName: "get",
      args: [id],
    });
    return decodeRecord(id, raw as unknown as RawRecord);
  } catch {
    // `get` reverts with NotRegistered for unknown ids — that is a real answer.
    return null;
  }
}

export async function isRegistered(id: Hex, target: FlightpathTarget = getFlightpathTarget()): Promise<boolean> {
  const config = getRegistryConfig(target);
  if (!config.configured || !config.address) return false;
  try {
    return (await client(target).readContract({
      address: config.address,
      abi: FINCH_REGISTRY_ABI,
      functionName: "exists",
      args: [id],
    })) as boolean;
  } catch {
    return false;
  }
}

export interface RegistrationEvent {
  id: Hex;
  owner: Address;
  kind: RegistryKindName;
  manifestHash: Hex;
  manifestURI: string;
  blockNumber: string;
  txHash: string;
  logIndex: number;
}

/** Minimal shape of a decoded Registered log, so viem generics stay out of the way. */
interface RawLog {
  args: Record<string, unknown>;
  blockNumber?: bigint;
  transactionHash?: string;
  logIndex?: number;
}

export interface RegistryIndexResult {
  configured: boolean;
  fromBlock?: string;
  toBlock?: string;
  events: RegistrationEvent[];
}

/**
 * Pull Registered events for the indexer. Callers persist with (txHash,
 * logIndex) as the idempotency key, exactly like the Pons fee indexer.
 */
export async function indexRegistrations(
  range: { fromBlock: bigint; toBlock: bigint },
  target: FlightpathTarget = getFlightpathTarget(),
): Promise<RegistryIndexResult> {
  const config = getRegistryConfig(target);
  if (!config.configured || !config.address) return { configured: false, events: [] };

  const registeredEvent = FINCH_REGISTRY_ABI.find(
    (entry) => entry.type === "event" && entry.name === "Registered",
  ) as (typeof FINCH_REGISTRY_ABI)[number];

  const logs = await client(target).getLogs({
    address: config.address,
    event: registeredEvent as never,
    fromBlock: range.fromBlock,
    toBlock: range.toBlock,
  });

  return {
    configured: true,
    fromBlock: range.fromBlock.toString(),
    toBlock: range.toBlock.toString(),
    events: (logs as unknown as RawLog[]).map((log) => ({
      id: log.args.id as Hex,
      owner: log.args.owner as Address,
      kind: KIND_NAMES[Number(log.args.kind ?? 0)] ?? "FINCH",
      manifestHash: log.args.manifestHash as Hex,
      manifestURI: (log.args.manifestURI as string) ?? "",
      blockNumber: log.blockNumber?.toString() ?? "0",
      txHash: log.transactionHash ?? "",
      logIndex: log.logIndex ?? 0,
    })),
  };
}

/**
 * Does the manifest at hand match what was registered onchain?
 * This is the check that makes an Aviary listing independently verifiable —
 * anyone can run it without trusting our index.
 */
export async function verifyManifestAgainstRegistry(
  kind: RegistryKindName,
  handle: string,
  manifestJson: string,
  target: FlightpathTarget = getFlightpathTarget(),
): Promise<{ registered: boolean; matches: boolean; expected?: Hex; actual: Hex; record?: RegistryRecord }> {
  const actual = manifestHash(manifestJson);
  const record = await readRegistryRecord(registryId(kind, handle), target);
  if (!record) return { registered: false, matches: false, actual };
  return { registered: true, matches: record.manifestHash === actual, expected: record.manifestHash, actual, record };
}
