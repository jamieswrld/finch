import {
  HIDDEN_CARD_CHANCE,
  RARITY_TIERS,
  stockByTicker,
  type Pack,
  type RarityTier,
  type Stock,
} from './data'

export type Card =
  | { kind: 'stock'; stock: Stock; valueUsd: number; rarity: RarityTier }
  | { kind: 'jackpot'; jackpotPct: number; valueUsd: number }
  | { kind: 'refund'; valueUsd: number }

function rollRarity(): RarityTier {
  let r = Math.random()
  for (const tier of RARITY_TIERS) {
    if (r < tier.weight) return tier
    r -= tier.weight
  }
  return RARITY_TIERS[0]
}

/**
 * Hidden jackpot cards pay a luck-weighted % of the current vault.
 * Most pulls land small; the tail is rare and fat.
 */
function rollJackpotPct(): number {
  const r = Math.random()
  if (r < 0.7) return 0.5 + Math.random() * 1.5 // 0.5% – 2%
  if (r < 0.95) return 2 + Math.random() * 3 // 2% – 5%
  if (r < 0.995) return 5 + Math.random() * 5 // 5% – 10%
  return 10 + Math.random() * 15 // 10% – 25%
}

export function openPack(pack: Pack, jackpotUsd: number): Card {
  if (Math.random() < HIDDEN_CARD_CHANCE) {
    const pct = rollJackpotPct()
    return { kind: 'jackpot', jackpotPct: pct, valueUsd: (pct / 100) * jackpotUsd }
  }
  const rarity = rollRarity()
  const ticker = pack.pool[Math.floor(Math.random() * pack.pool.length)]
  // jitter so identical pulls don't repeat to the cent
  const jitter = 0.95 + Math.random() * 0.1
  return {
    kind: 'stock',
    stock: stockByTicker(ticker),
    valueUsd: pack.priceUsd * rarity.multiplier * jitter,
    rarity,
  }
}

export const fmtUsd = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export const shortAddr = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`

export function randomAddr(): string {
  const hex = '0123456789abcdef'
  let out = '0x'
  for (let i = 0; i < 40; i++) out += hex[Math.floor(Math.random() * 16)]
  return out
}
