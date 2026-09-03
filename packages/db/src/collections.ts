import type { Collection, Db } from "mongodb";
import { getDb } from "./client.ts";
import type { RunDoc } from "./runs.ts";
import {
  COLLECTIONS,
  type ApiKeyDoc,
  type AviaryListing,
  type CreditEntry,
  type ExecutionDoc,
  type FeeEventDoc,
  type NestDoc,
  type MemoryItemDoc,
  type FinchDoc,
  type ServiceCallDoc,
  type TreasuryLedgerEntry,
} from "./schemas.ts";

export interface FinchCollections {
  finches: Collection<FinchDoc>;
  nests: Collection<NestDoc>;
  aviaryListings: Collection<AviaryListing>;
  executions: Collection<ExecutionDoc>;
  memoryItems: Collection<MemoryItemDoc>;
  feeEvents: Collection<FeeEventDoc>;
  treasuryLedger: Collection<TreasuryLedgerEntry>;
  creditEntries: Collection<CreditEntry>;
  serviceCalls: Collection<ServiceCallDoc>;
  apiKeys: Collection<ApiKeyDoc>;
  runs: Collection<RunDoc>;
}

export function collectionsOf(db: Db): FinchCollections {
  return {
    finches: db.collection<FinchDoc>(COLLECTIONS.finches),
    nests: db.collection<NestDoc>(COLLECTIONS.nests),
    aviaryListings: db.collection<AviaryListing>(COLLECTIONS.aviaryListings),
    executions: db.collection<ExecutionDoc>(COLLECTIONS.executions),
    memoryItems: db.collection<MemoryItemDoc>(COLLECTIONS.memoryItems),
    feeEvents: db.collection<FeeEventDoc>(COLLECTIONS.feeEvents),
    treasuryLedger: db.collection<TreasuryLedgerEntry>(COLLECTIONS.treasuryLedger),
    creditEntries: db.collection<CreditEntry>(COLLECTIONS.creditEntries),
    serviceCalls: db.collection<ServiceCallDoc>(COLLECTIONS.serviceCalls),
    apiKeys: db.collection<ApiKeyDoc>(COLLECTIONS.apiKeys),
    runs: db.collection<RunDoc>(COLLECTIONS.runs),
  };
}

export async function getCollections(): Promise<FinchCollections> {
  return collectionsOf(await getDb());
}
