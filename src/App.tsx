import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { ConnectButton } from './components/ConnectButton'
import { LiveFeed } from './components/LiveFeed'
import { OpenPackModal } from './components/OpenPackModal'
import { PackCard, PackVisual } from './components/PackCard'
import { StockLogo } from './components/StockLogo'
import {
  JACKPOT_CUT,
  JACKPOT_SEED_USD,
  PACKS,
  RARITY_TIERS,
  STOCKS,
  asset,
  type Pack,
} from './data'
import { fmtUsd, shortAddr, type Card } from './rng'
import { robinhoodChain } from './chain'
import { recordPull } from './history'
import { isOnchainEnabled } from './onchain'
import { TOKEN_ADDRESS, TOKEN_SYMBOL, isTokenLive, tokenBuyUrl } from './token'
import { useChainStats } from './useChainData'

// Docs is its own screen — split it out of the main bundle.
const DocsPage = lazy(() => import('./components/Docs').then((m) => ({ default: m.DocsPage })))

export default function App() {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const [openingPack, setOpeningPack] = useState<Pack | null>(null)
  const [demoJackpotUsd, setDemoJackpotUsd] = useState(JACKPOT_SEED_USD)
  const [route, setRoute] = useState(window.location.hash)
  const wrongNetwork = isConnected && chainId !== robinhoodChain.id

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Everything below is read live from chain once contracts are configured.
  const stats = useChainStats()
  const jackpotUsd = isOnchainEnabled() ? stats.jackpotUsd : demoJackpotUsd

  const handlePulled = useCallback(
    (card: Card, pack: Pack) => {
      recordPull(address, card, pack)
      setDemoJackpotUsd((j) => {
        const afterContribution = j + pack.priceUsd * JACKPOT_CUT
        return card.kind === 'jackpot' ? afterContribution - card.valueUsd : afterContribution
      })
    },
    [address],
  )

  if (route.startsWith('#/docs')) {
    return (
      <Suspense fallback={null}>
        <DocsPage />
      </Suspense>
    )
  }

  return (
    <div className="page">
      <header className="header">
        <a className="wordmark" href="#top">
          <img className="brand-mark" src={asset('/brand/mark.webp')} alt="" />
          finch<span className="wordmark-accent">.</span>
        </a>
        <nav className="nav">
          <a href="#packs">Packs</a>
          <a href="#jackpot">Jackpot</a>
          <a href="#stocks">Stocks</a>
          <a href="#/docs">Docs</a>
        </nav>
        <div className="header-actions">
          {isTokenLive() && (
            <a className="btn btn-token" href={tokenBuyUrl()} target="_blank" rel="noreferrer">
              Buy ${TOKEN_SYMBOL}
            </a>
          )}
          <ConnectButton />
        </div>
      </header>

      {wrongNetwork && (
        <div className="net-banner">
          <span>Wrong network — finch runs on {robinhoodChain.name}.</span>
          <button className="btn btn-dark btn-sm" onClick={() => switchChain({ chainId: robinhoodChain.id })}>
            Switch network
          </button>
        </div>
      )}

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <h1>
              Open a pack.
              <br />
              Own real stocks.
            </h1>
            <p className="hero-sub">
              Every pack holds a real tokenized stock, settled straight to your wallet. Every pack
              feeds the jackpot — and hidden cards claim a slice of it.
            </p>
            <div className="hero-actions">
              <a className="btn btn-green btn-lg" href="#packs">
                Browse Packs
              </a>
              <a className="btn btn-ghost btn-lg" href="#/docs">
                Read the docs
              </a>
            </div>
          </div>
          <div className="hero-fan" aria-hidden>
            {PACKS.slice(0, 3).map((p, i) => (
              <div className={`fan fan-${i}`} key={p.id}>
                <PackVisual pack={p} />
              </div>
            ))}
          </div>
        </section>

        <div className="stats-bar">
          <div className="stat">
            <span className="stat-value">{fmtUsd(jackpotUsd)}</span>
            <span className="stat-label">Jackpot vault</span>
          </div>
          <div className="stat">
            <span className="stat-value">{isOnchainEnabled() ? stats.packsOpened : '—'}</span>
            <span className="stat-label">Packs opened</span>
          </div>
          <div className="stat">
            <span className="stat-value">{isOnchainEnabled() ? fmtUsd(stats.volumeUsd) : '—'}</span>
            <span className="stat-label">Total volume</span>
          </div>
          <div className="stat">
            <span className="stat-value">{STOCKS.length}</span>
            <span className="stat-label">Tokenized stocks</span>
          </div>
        </div>

        <div className="ticker-strip">
          <div className="ticker-track">
            {[...STOCKS, ...STOCKS].map((s, i) => (
              <span className="ticker-item" key={`${s.ticker}-${i}`}>
                <StockLogo stock={s} size={18} />
                {s.ticker}
              </span>
            ))}
          </div>
        </div>

        <section className="section" id="packs">
          <div className="section-head">
            <div>
              <p className="eyebrow">Collection</p>
              <h2>Packs</h2>
            </div>
            <a className="section-link" href="#/docs">
              Odds &amp; mechanics →
            </a>
          </div>
          <div className="pack-grid">
            {PACKS.map((p) => (
              <PackCard key={p.id} pack={p} onOpen={setOpeningPack} />
            ))}
          </div>
        </section>

        <section className="section" id="jackpot">
          <div className="jackpot-card">
            <div>
              <p className="eyebrow">Jackpot Vault</p>
              <p className="jackpot-amount">{fmtUsd(jackpotUsd)}</p>
              <p className="muted">
                {Math.round(JACKPOT_CUT * 100)}% of every pack purchase accrues here on-chain — this
                is the vault's live balance. Hidden cards pay out of it instantly and automatically;
                the rest is distributed by the finch team at its discretion.
              </p>
            </div>
          </div>
        </section>

        <section className="section section-split">
          <div>
            <div className="section-head">
              <div>
                <p className="eyebrow">Activity</p>
                <h2>Live feed</h2>
              </div>
            </div>
            <LiveFeed />
          </div>
          <div>
            <div className="section-head">
              <div>
                <p className="eyebrow">Transparency</p>
                <h2>Odds</h2>
              </div>
            </div>
            <ul className="odds-list">
              {RARITY_TIERS.map((t) => (
                <li key={t.key}>
                  <span className="odds-label" style={{ color: t.color }}>
                    {t.label}
                  </span>
                  <span className="muted">{(t.weight * 100).toFixed(0)}%</span>
                  <span>{t.multiplier}× pack price</span>
                </li>
              ))}
              <li>
                <span className="odds-label odds-hidden">Hidden Card</span>
                <span className="muted">1%</span>
                <span>0.5–25% of the jackpot vault</span>
              </li>
            </ul>
          </div>
        </section>

        {isTokenLive() && (
          <section className="section" id="token">
            <div className="token-card">
              <div>
                <p className="eyebrow">${TOKEN_SYMBOL}</p>
                <h2>The finch token</h2>
                <p className="muted">
                  Trades on {robinhoodChain.name}. Contract{' '}
                  <a
                    className="mono"
                    href={`${robinhoodChain.blockExplorers.default.url}/token/${TOKEN_ADDRESS}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddr(TOKEN_ADDRESS)}
                  </a>{' '}
                  — always verify the address before you buy.
                </p>
              </div>
              <a className="btn btn-token btn-lg" href={tokenBuyUrl()} target="_blank" rel="noreferrer">
                Buy ${TOKEN_SYMBOL}
              </a>
            </div>
          </section>
        )}

        <section className="section" id="stocks">
          <div className="section-head">
            <div>
              <p className="eyebrow">The board</p>
              <h2>Tokenized stocks</h2>
            </div>
            <a
              className="section-link"
              href={`${robinhoodChain.blockExplorers.default.url}/tokens`}
              target="_blank"
              rel="noreferrer"
            >
              Blockscout →
            </a>
          </div>
          <p className="muted section-sub">
            Official Robinhood Stock Tokens — real equities as ERC-20s on {robinhoodChain.name}.
          </p>
          <div className="stock-grid">
            {STOCKS.map((s) => (
              <a
                className="stock-cell"
                key={s.ticker}
                href={`${robinhoodChain.blockExplorers.default.url}/token/${s.address}`}
                target="_blank"
                rel="noreferrer"
              >
                <StockLogo stock={s} size={30} />
                <div>
                  <strong>{s.ticker}</strong>
                  <p className="muted small">{s.name}</p>
                </div>
                <span className="mono muted small stock-addr" title={s.address}>
                  {shortAddr(s.address)}
                </span>
              </a>
            ))}
          </div>
        </section>

        <section className="section" id="how">
          <div className="section-head">
            <div>
              <p className="eyebrow">Process</p>
              <h2>How it works</h2>
            </div>
          </div>
          <div className="steps">
            {[
              ['Connect', 'Any EVM wallet on Robinhood Chain.'],
              ['Buy a pack', 'Pay in USDG. A cut goes to the jackpot vault.'],
              ['Provable RNG', 'On-chain randomness picks your card and rarity.'],
              ['Own it', 'The tokenized stock settles to your wallet. Hidden cards claim vault %.'],
            ].map(([title, body], i) => (
              <div className="step" key={title}>
                <span className="step-num">{i + 1}</span>
                <strong>{title}</strong>
                <p className="muted">{body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="footer">
        <span className="muted small">
          finch · <a href="#/docs">docs</a> · not investment advice · tokenized stocks carry risk
        </span>
      </footer>

      {openingPack && (
        <OpenPackModal
          pack={openingPack}
          jackpotUsd={jackpotUsd}
          onClose={() => setOpeningPack(null)}
          onPulled={handlePulled}
        />
      )}
    </div>
  )
}
