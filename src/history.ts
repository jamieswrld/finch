import type { Pack } from './data'
import type { Card } from './rng'

/** Per-wallet pull history, persisted locally. On-chain events are the source of
 *  truth once contracts are live; this covers demo mode and instant UI. */
export interface PullRecord {
  kind: 'stock' | 'jackpot' | 'refund'
  ticker?: string
  jackpotPct?: number
  valueUsd: number
  packName: string
  ts: number
}

const keyFor = (address?: string) => `finch.pulls.${(address ?? 'demo').toLowerCase()}`

export function getPulls(address?: string): PullRecord[] {
  try {
    return JSON.parse(localStorage.getItem(keyFor(address)) ?? '[]') as PullRecord[]
  } catch {
    return []
  }
}

export function recordPull(address: string | undefined, card: Card, pack: Pack): void {
  const record: PullRecord = {
    kind: card.kind,
    ticker: card.kind === 'stock' ? card.stock.ticker : undefined,
    jackpotPct: card.kind === 'jackpot' ? card.jackpotPct : undefined,
    valueUsd: card.valueUsd,
    packName: pack.name,
    ts: Date.now(),
  }
  const pulls = getPulls(address)
  pulls.unshift(record)
  localStorage.setItem(keyFor(address), JSON.stringify(pulls.slice(0, 200)))
}
