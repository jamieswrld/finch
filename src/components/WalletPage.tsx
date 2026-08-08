import { useEffect, useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { bnbChain } from '../chain'
import { STOCKS } from '../data'
import { getPulls } from '../history'
import { fetchHiddenCards, isOnchainEnabled, type HiddenCardWin } from '../onchain'
import { fmtUsd, shortAddr } from '../rng'
import { StockLogo } from './StockLogo'

const explorer = bnbChain.blockExplorers.default.url

/** Full-page wallet / profile view (tab, not an overlay). */
export function WalletPage() {
  const { address, isConnected } = useAccount()
  const pulls = useMemo(() => (address ? getPulls(address) : []), [address])
  const [chainWins, setChainWins] = useState<HiddenCardWin[] | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!isOnchainEnabled() || !address) return
    fetchHiddenCards(address)
      .then(setChainWins)
      .catch(() => {})
  }, [address])

  if (!isConnected || !address) {
    return (
      <section className="section">
        <div className="section-head">
          <div>
            <p className="eyebrow">Profile</p>
            <h2>Your wallet</h2>
          </div>
        </div>
        <div className="wallet-empty">
          <p className="muted">Connect a wallet to see your pulls, cards, and hidden-card wins.</p>
        </div>
      </section>
    )
  }

  const localWins = pulls
    .filter((p) => p.kind === 'jackpot')
    .map((p) => ({ jackpotPct: p.jackpotPct ?? 0, valueUsd: p.valueUsd, txHash: '' }))
  const wins = chainWins ?? localWins
  const totalWon = wins.reduce((s, w) => s + w.valueUsd, 0)
  const totalPulled = pulls.reduce((s, p) => s + p.valueUsd, 0)

  const copy = () => {
    navigator.clipboard.writeText(address).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <section className="section">
      <div className="section-head">
        <div>
          <p className="eyebrow">Profile</p>
          <h2>Your wallet</h2>
        </div>
        <div className="wallet-id">
          <button className="mono wallet-addr" onClick={copy} title="Copy address">
            {copied ? 'copied ✓' : shortAddr(address)}
          </button>
          <a
            className="section-link"
            href={`${explorer}/address/${address}`}
            target="_blank"
            rel="noreferrer"
          >
            BscScan →
          </a>
        </div>
      </div>

      <div className="stats-bar">
        <div className="stat">
          <span className="stat-value">{pulls.length}</span>
          <span className="stat-label">Packs opened</span>
        </div>
        <div className="stat">
          <span className="stat-value" style={{ color: 'var(--gold-dark)' }}>
            {wins.length}
          </span>
          <span className="stat-label">Hidden cards</span>
        </div>
        <div className="stat">
          <span className="stat-value">{fmtUsd(totalPulled)}</span>
          <span className="stat-label">Total pulled</span>
        </div>
        <div className="stat">
          <span className="stat-value">{fmtUsd(totalWon)}</span>
          <span className="stat-label">Jackpot winnings</span>
        </div>
      </div>

      <div className="section-split wallet-split">
        <div>
          <p className="eyebrow">Hidden cards found</p>
          {wins.length === 0 ? (
            <p className="muted small wallet-none">
              None yet — 1 in 100 packs hides a card worth up to 25% of the jackpot vault.
            </p>
          ) : (
            <ul className="drawer-wins">
              {wins.map((w, i) => (
                <li key={i}>
                  <span className="drawer-win-pct">{w.jackpotPct.toFixed(2)}%</span>
                  <span className="muted small">of the vault</span>
                  <span className="drawer-win-value">{fmtUsd(w.valueUsd)}</span>
                  {w.txHash && (
                    <a className="section-link" href={`${explorer}/tx/${w.txHash}`} target="_blank" rel="noreferrer">
                      ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="eyebrow">Your pulls</p>
          {pulls.length === 0 ? (
            <p className="muted small wallet-none">No packs opened yet.</p>
          ) : (
            <ul className="drawer-pulls">
              {pulls.slice(0, 12).map((p, i) => {
                const stock = STOCKS.find((s) => s.ticker === p.ticker)
                return (
                  <li key={i}>
                    {stock && <StockLogo stock={stock} size={18} />}
                    <strong>
                      {p.kind === 'jackpot' ? 'HIDDEN' : p.kind === 'refund' ? 'REFUND' : p.ticker}
                    </strong>
                    <span className="muted small">{p.packName}</span>
                    <span className="drawer-pull-value">{fmtUsd(p.valueUsd)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
