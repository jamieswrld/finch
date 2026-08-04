import { useEffect, useMemo, useState } from 'react'
import { robinhoodChain } from '../chain'
import { getPulls } from '../history'
import { fetchHiddenCards, isOnchainEnabled, type HiddenCardWin } from '../onchain'
import { fmtUsd, shortAddr } from '../rng'

interface Props {
  address: `0x${string}`
  onClose: () => void
  onDisconnect: () => void
}

export function WalletDrawer({ address, onClose, onDisconnect }: Props) {
  const pulls = useMemo(() => getPulls(address), [address])
  const [chainWins, setChainWins] = useState<HiddenCardWin[] | null>(null)
  const [copied, setCopied] = useState(false)

  // On-chain events are the source of truth once contracts are live.
  useEffect(() => {
    if (!isOnchainEnabled()) return
    fetchHiddenCards(address)
      .then(setChainWins)
      .catch(() => {})
  }, [address])

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
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <span className="dot dot-green" />
          <button className="mono drawer-addr" onClick={copy} title="Copy address">
            {copied ? 'copied ✓' : shortAddr(address)}
          </button>
          <a
            className="drawer-link"
            href={`${robinhoodChain.blockExplorers.default.url}/address/${address}`}
            target="_blank"
            rel="noreferrer"
            title="View on Blockscout"
          >
            ↗
          </a>
          <button className="drawer-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="drawer-stats">
          <div className="drawer-stat">
            <span className="drawer-stat-value">{pulls.length}</span>
            <span className="drawer-stat-label">Packs opened</span>
          </div>
          <div className="drawer-stat drawer-stat-gold">
            <span className="drawer-stat-value">{wins.length}</span>
            <span className="drawer-stat-label">Hidden cards</span>
          </div>
          <div className="drawer-stat">
            <span className="drawer-stat-value">{fmtUsd(totalPulled)}</span>
            <span className="drawer-stat-label">Total pulled</span>
          </div>
        </div>

        <div className="drawer-section">
          <p className="eyebrow">Hidden cards found</p>
          {wins.length === 0 ? (
            <p className="muted small">
              None yet — 1 in 100 packs hides a card worth up to 25% of the jackpot vault.
            </p>
          ) : (
            <>
              <ul className="drawer-wins">
                {wins.map((w, i) => (
                  <li key={i}>
                    <span className="drawer-win-pct">{w.jackpotPct.toFixed(2)}%</span>
                    <span className="muted small">of the vault</span>
                    <span className="drawer-win-value">{fmtUsd(w.valueUsd)}</span>
                    {w.txHash && (
                      <a
                        className="drawer-link"
                        href={`${robinhoodChain.blockExplorers.default.url}/tx/${w.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        ↗
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              <p className="muted small">Won {fmtUsd(totalWon)} from hidden cards, paid in USDG.</p>
            </>
          )}
        </div>

        {pulls.length > 0 && (
          <div className="drawer-section">
            <p className="eyebrow">Recent pulls</p>
            <ul className="drawer-pulls">
              {pulls.slice(0, 8).map((p, i) => (
                <li key={i}>
                  <strong>{p.kind === 'jackpot' ? 'HIDDEN' : p.kind === 'refund' ? 'REFUND' : p.ticker}</strong>
                  <span className="muted small">{p.packName}</span>
                  <span className="drawer-pull-value">{fmtUsd(p.valueUsd)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button className="btn btn-ghost btn-full" onClick={onDisconnect}>
          Disconnect
        </button>
      </aside>
    </div>
  )
}
