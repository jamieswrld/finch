import { useEffect, useRef, useState } from 'react'
import { PACKS, STOCKS } from '../data'
import { fmtUsd, randomAddr, shortAddr } from '../rng'
import { StockLogo } from './StockLogo'

export interface FeedEntry {
  id: number
  addr: string
  ticker: string
  valueUsd: number
  packName: string
}

let nextId = 1

export function makeFeedEntry(overrides?: Partial<FeedEntry>): FeedEntry {
  const stock = STOCKS[Math.floor(Math.random() * STOCKS.length)]
  const pack = PACKS[Math.floor(Math.random() * PACKS.length)]
  return {
    id: nextId++,
    addr: randomAddr(),
    ticker: stock.ticker,
    valueUsd: pack.priceUsd * (0.6 + Math.random() * 1.2),
    packName: pack.name,
    ...overrides,
  }
}

export function LiveFeed({ pinned }: { pinned: FeedEntry[] }) {
  const [entries, setEntries] = useState<FeedEntry[]>(() =>
    Array.from({ length: 4 }, () => makeFeedEntry()),
  )
  const pinnedCount = useRef(0)

  useEffect(() => {
    const id = setInterval(() => {
      setEntries((prev) => [makeFeedEntry(), ...prev].slice(0, 6))
    }, 6000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (pinned.length > pinnedCount.current) {
      const fresh = pinned.slice(pinnedCount.current)
      pinnedCount.current = pinned.length
      setEntries((prev) => [...fresh.reverse(), ...prev].slice(0, 6))
    }
  }, [pinned])

  return (
    <div className="feed">
      <div className="feed-header">
        <span className="dot dot-green pulse" /> Live openings
      </div>
      <ul>
        {entries.map((e) => (
          <li key={e.id} className="feed-row">
            <span className="mono muted">{shortAddr(e.addr)}</span>
            <span className="feed-pull">
              pulled{' '}
              {(() => {
                const stock = STOCKS.find((s) => s.ticker === e.ticker)
                return stock ? <StockLogo stock={stock} size={16} /> : null
              })()}
              <strong>{e.ticker}</strong>
            </span>
            <span className="feed-value">{fmtUsd(e.valueUsd)}</span>
            <span className="muted small">{e.packName}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
