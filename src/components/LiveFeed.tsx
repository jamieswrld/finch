import { bnbChain } from '../chain'
import { STOCKS } from '../data'
import { fmtUsd, shortAddr } from '../rng'
import { isOnchainEnabled } from '../onchain'
import { useLivePulls } from '../useChainData'
import { StockLogo } from './StockLogo'

const explorer = bnbChain.blockExplorers.default.url
const stockByAddress = (a?: string) =>
  a ? STOCKS.find((s) => s.address.toLowerCase() === a.toLowerCase()) : undefined

/** Real pack openings, read from PackSale events on-chain. */
export function LiveFeed() {
  const pulls = useLivePulls()

  if (!isOnchainEnabled()) {
    return (
      <div className="feed">
        <div className="feed-header">
          <span className="dot" style={{ background: 'var(--muted)' }} /> Live openings
        </div>
        <p className="feed-empty muted small">Contracts not configured.</p>
      </div>
    )
  }

  return (
    <div className="feed">
      <div className="feed-header">
        <span className="dot dot-green pulse" /> Live openings
        <span className="feed-header-note muted small">on-chain</span>
      </div>
      {pulls.length === 0 ? (
        <p className="feed-empty muted small">
          No packs opened yet — the first pull on finch shows up here.
        </p>
      ) : (
        <ul>
          {pulls.map((p) => {
            const stock = stockByAddress(p.stock)
            return (
              <li key={p.id} className="feed-row">
                <a
                  className="mono muted"
                  href={`${explorer}/address/${p.buyer}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortAddr(p.buyer)}
                </a>
                <span className="feed-pull">
                  pulled{' '}
                  {p.kind === 'stock' && stock && <StockLogo stock={stock} size={16} />}
                  <strong>
                    {p.kind === 'jackpot'
                      ? `HIDDEN ${((p.pctBps ?? 0) / 100).toFixed(2)}%`
                      : p.kind === 'refund'
                        ? 'REFUND'
                        : (stock?.ticker ?? 'STOCK')}
                  </strong>
                </span>
                <span className={`feed-value ${p.kind === 'jackpot' ? 'feed-value-gold' : ''}`}>
                  {fmtUsd(p.valueUsd)}
                </span>
                <a className="feed-tx muted small" href={`${explorer}/tx/${p.txHash}`} target="_blank" rel="noreferrer">
                  ↗
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
