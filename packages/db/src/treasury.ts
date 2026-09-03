import type { TreasuryCategory, TreasuryLedgerEntry } from "./schemas.ts";

/**
 * Pure treasury math — identical over seed rows and indexed onchain rows, so
 * The Nest dashboard renders the same shapes in demo and live modes.
 */

export interface TreasurySummary {
  cumulativeCreatorFees: number;
  totalIn: number;
  totalOut: number;
  reserve: number;
  byCategory: Array<{ category: TreasuryCategory; direction: "in" | "out"; total: number }>;
  weeklyFees: Array<{ weekStart: string; amount: number }>;
  asset: string;
}

export function summarizeLedger(entries: TreasuryLedgerEntry[]): TreasurySummary {
  let totalIn = 0;
  let totalOut = 0;
  let creatorFees = 0;
  const byCategory = new Map<string, { category: TreasuryCategory; direction: "in" | "out"; total: number }>();
  const weekly = new Map<string, number>();

  for (const entry of entries) {
    const amount = Number(entry.amount);
    if (!Number.isFinite(amount)) continue;
    if (entry.direction === "in") totalIn += amount;
    else totalOut += amount;
    if (entry.category === "creator-fees" && entry.direction === "in") {
      creatorFees += amount;
      const date = new Date(entry.at);
      // Bucket by ISO week start (Monday).
      const day = date.getUTCDay();
      const diff = (day + 6) % 7;
      date.setUTCDate(date.getUTCDate() - diff);
      date.setUTCHours(0, 0, 0, 0);
      const key = date.toISOString().slice(0, 10);
      weekly.set(key, (weekly.get(key) ?? 0) + amount);
    }
    const catKey = `${entry.category}:${entry.direction}`;
    const existing = byCategory.get(catKey);
    if (existing) existing.total += amount;
    else byCategory.set(catKey, { category: entry.category, direction: entry.direction, total: amount });
  }

  return {
    cumulativeCreatorFees: round6(creatorFees),
    totalIn: round6(totalIn),
    totalOut: round6(totalOut),
    reserve: round6(totalIn - totalOut),
    byCategory: [...byCategory.values()]
      .map((row) => ({ ...row, total: round6(row.total) }))
      .sort((a, b) => b.total - a.total),
    weeklyFees: [...weekly.entries()]
      .map(([weekStart, amount]) => ({ weekStart, amount: round6(amount) }))
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
    asset: "ETH",
  };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
