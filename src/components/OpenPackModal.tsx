import { useEffect, useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { robinhoodChain } from '../chain'
import { JACKPOT_CUT, PROTOCOL_FEE, asset, type Pack } from '../data'
import { buyAndOpenOnchain, isOnchainEnabled } from '../onchain'
import { fmtUsd, openPack, shortAddr, type Card } from '../rng'
import { PackVisual } from './PackCard'
import { StockLogo } from './StockLogo'

type Stage = 'confirm' | 'charging' | 'rip' | 'reveal'
type Tier = 'common' | 'rare' | 'epic' | 'legendary' | 'jackpot' | 'refund'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const OPEN_STEPS: Array<[string, string]> = [
  ['Payment', 'USDG in · jackpot cut split'],
  ['Randomness', 'outcome locked on-chain'],
  ['Settlement', 'card assigned to you'],
]

/** Rotating while transactions confirm — the wait itself teaches the protocol. */
const CHARGE_FACTS = [
  'Randomness commits to a future blockhash — nobody can pick your card, including us.',
  '20% of this pack is flowing into the jackpot vault right now.',
  'Your stock settles as a real ERC-20 to your wallet. Self-custody from block one.',
  '1 in 100 packs hides a jackpot card worth up to 25% of the vault.',
  'Prices come from Chainlink equity feeds, updated 24/5.',
  'Every contract we run is verified on Blockscout — check the docs.',
]

const TIER_FX: Record<Tier, { glow: string; particles: number; rays: boolean; shake: boolean }> = {
  common: { glow: '#9ca3af', particles: 14, rays: false, shake: false },
  rare: { glow: '#2b6cb0', particles: 20, rays: true, shake: false },
  epic: { glow: '#7c3aed', particles: 28, rays: true, shake: false },
  legendary: { glow: '#d97706', particles: 40, rays: true, shake: true },
  jackpot: { glow: '#b3903f', particles: 44, rays: true, shake: true },
  refund: { glow: '#9c9cab', particles: 10, rays: false, shake: false },
}

const tierOf = (card: Card | null): Tier =>
  !card ? 'common' : card.kind === 'jackpot' ? 'jackpot' : card.kind === 'refund' ? 'refund' : card.rarity.key

/** rAF count-up with cubic ease-out — the card value ticks up like a settled trade. */
function useCountUp(target: number, duration = 750) {
  const [v, setV] = useState(0)
  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration)
      setV(target * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return v
}

/** Radial particle explosion — count/color scale with rarity. */
function Burst({ color, count }: { color: string; count: number }) {
  const parts = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        angle: (i / count) * 360 + Math.random() * 14,
        dist: 100 + Math.random() * 160,
        size: 3 + Math.random() * 5,
        delay: Math.random() * 0.07,
        dur: 0.45 + Math.random() * 0.4,
      })),
    [count],
  )
  return (
    <div className="fx-burst" aria-hidden>
      {parts.map((p, i) => (
        <span
          key={i}
          style={
            {
              '--a': `${p.angle}deg`,
              '--d': `${p.dist}px`,
              width: p.size,
              height: p.size,
              background: color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.dur}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}

/** Slow-drifting ambient specks behind the revealed card. */
function Ambient({ color, count }: { color: string; count: number }) {
  const parts = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        x: Math.random() * 100,
        y: 25 + Math.random() * 60,
        size: 2 + Math.random() * 3,
        delay: Math.random() * 3,
        dur: 3.4 + Math.random() * 3,
      })),
    [count],
  )
  return (
    <div className="fx-ambient" aria-hidden>
      {parts.map((p, i) => (
        <span
          key={i}
          style={
            {
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: p.size,
              height: p.size,
              background: color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.dur}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}

function Sparkline({ color }: { color: string }) {
  const points = useMemo(() => {
    const pts: string[] = []
    let y = 44
    for (let x = 0; x <= 200; x += 10) {
      y = Math.min(52, Math.max(6, y + (Math.random() - 0.58) * 9))
      pts.push(`${x},${y.toFixed(1)}`)
    }
    return pts.join(' ')
  }, [])
  const last = points.split(' ').at(-1)!.split(',')
  return (
    <svg className="sparkline" viewBox="0 0 200 58" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={color} />
    </svg>
  )
}

function CardFace({ card, value }: { card: Card; value: number }) {
  if (card.kind === 'stock') {
    return (
      <div className="reveal-card" style={{ '--stock-color': card.stock.color } as React.CSSProperties}>
        <div>
          <div className="stock-card-top">
            <div className="reveal-id">
              <StockLogo stock={card.stock} size={34} />
              <span className="reveal-ticker">{card.stock.ticker}</span>
            </div>
            <span className="rarity-chip" style={{ color: card.rarity.color }}>
              {card.rarity.label}
            </span>
          </div>
          <p className="reveal-name">{card.stock.name} · Stock Token</p>
        </div>
        <Sparkline color={card.stock.color} />
        <div>
          <div className="stock-card-bottom">
            <span className="reveal-value">{fmtUsd(value)}</span>
            <span className="reveal-delta">▲ SETTLED</span>
          </div>
          <p className="reveal-foot">delivered to your wallet · Robinhood Chain</p>
        </div>
      </div>
    )
  }
  if (card.kind === 'jackpot') {
    return (
      <div className="reveal-card reveal-jackpot">
        <div>
          <div className="stock-card-top">
            <span className="reveal-ticker">{card.jackpotPct.toFixed(2)}%</span>
            <span className="rarity-chip" style={{ color: 'var(--gold-dark)' }}>
              Hidden
            </span>
          </div>
          <p className="reveal-name">of the Jackpot Vault</p>
        </div>
        <Sparkline color="#b3903f" />
        <div>
          <div className="stock-card-bottom">
            <span className="reveal-value">{fmtUsd(value)}</span>
            <span className="reveal-delta">▲ JACKPOT</span>
          </div>
          <p className="reveal-foot">paid instantly in USDG</p>
        </div>
      </div>
    )
  }
  return (
    <div className="reveal-card">
      <div>
        <div className="stock-card-top">
          <span className="reveal-ticker">USDG</span>
          <span className="rarity-chip">Refund</span>
        </div>
        <p className="reveal-name">inventory restocking</p>
      </div>
      <Sparkline color="#9c9cab" />
      <div>
        <div className="stock-card-bottom">
          <span className="reveal-value">{fmtUsd(value)}</span>
          <span className="reveal-delta">RETURNED</span>
        </div>
        <p className="reveal-foot">card value returned in USDG</p>
      </div>
    </div>
  )
}

/** Flip-in card with pointer 3D tilt + tracked glare highlight after it lands. */
function RevealCard3D({ card }: { card: Card }) {
  const value = useCountUp(card.valueUsd)
  const [tilt, setTilt] = useState<React.CSSProperties>({})
  const [glare, setGlare] = useState({ x: 50, y: 25, o: 0 })

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    setTilt({ transform: `rotateY(${(px - 0.5) * 22}deg) rotateX(${(py - 0.5) * -22}deg)` })
    setGlare({ x: px * 100, y: py * 100, o: 0.5 })
  }
  const onLeave = () => {
    setTilt({ transform: 'rotateY(0deg) rotateX(0deg)' })
    setGlare({ x: 50, y: 25, o: 0 })
  }

  return (
    <div className="card3d" onMouseMove={onMove} onMouseLeave={onLeave}>
      <div className="card3d-tilt" style={tilt}>
        <div className="card-flip">
          <div className="card-face card-front">
            <CardFace card={card} value={value} />
            <div
              className="card-glare"
              style={
                {
                  '--gx': `${glare.x}%`,
                  '--gy': `${glare.y}%`,
                  opacity: glare.o,
                } as React.CSSProperties
              }
            />
            <div className="card-shine" />
          </div>
          <div className="card-face card-back">
            <img className="card-back-mark-img" src={asset('/brand/mark.webp')} alt="" />
          </div>
        </div>
      </div>
    </div>
  )
}

interface Props {
  pack: Pack
  jackpotUsd: number
  onClose: () => void
  onPulled: (card: Card, pack: Pack) => void
}

export function OpenPackModal({ pack, jackpotUsd, onClose, onPulled }: Props) {
  const { isConnected } = useAccount()
  const [stage, setStage] = useState<Stage>('confirm')
  const [step, setStep] = useState(0)
  const [card, setCard] = useState<Card | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [factIdx, setFactIdx] = useState(0)

  const onchain = isOnchainEnabled() && isConnected
  const tier = tierOf(card)
  const fx = TIER_FX[tier]

  useEffect(() => {
    if (stage !== 'charging') return
    const t0 = Date.now()
    const timer = setInterval(() => setElapsed((Date.now() - t0) / 1000), 100)
    const facts = setInterval(() => setFactIdx((i) => (i + 1) % CHARGE_FACTS.length), 3200)
    return () => {
      clearInterval(timer)
      clearInterval(facts)
    }
  }, [stage])

  const handleOpen = async () => {
    setError(null)
    setStep(0)
    setCard(null)
    setTxHash(null)
    setElapsed(0)
    setFactIdx(Math.floor(Math.random() * CHARGE_FACTS.length))
    setStage('charging')
    try {
      let pulled: Card
      if (onchain) {
        pulled = await buyAndOpenOnchain(pack, (s, hash) => {
          setStep(s)
          if (hash) setTxHash(hash)
        })
      } else {
        for (let i = 1; i <= OPEN_STEPS.length; i++) {
          await sleep(320)
          setStep(i)
        }
        await sleep(140)
        pulled = openPack(pack, jackpotUsd)
      }
      setCard(pulled)
      onPulled(pulled, pack)
      setStage('rip')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transaction failed')
      setStage('confirm')
    }
  }

  if (stage === 'confirm') {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <PackVisual pack={pack} size="lg" />
          <h3>{pack.name}</h3>
          <ul className="modal-facts">
            <li>
              <span className="muted">Price</span>
              <span>{fmtUsd(pack.priceUsd)} USDG</span>
            </li>
            <li>
              <span className="muted">You receive</span>
              <span>a random tokenized stock, avg ~{fmtUsd(pack.priceUsd * 0.8)}</span>
            </li>
            <li>
              <span className="muted">To jackpot vault</span>
              <span>{fmtUsd(pack.priceUsd * JACKPOT_CUT)}</span>
            </li>
            <li>
              <span className="muted">Protocol fee</span>
              <span>
                {PROTOCOL_FEE * 100}% · {fmtUsd(pack.priceUsd * PROTOCOL_FEE)}
              </span>
            </li>
            <li>
              <span className="muted">Hidden card odds</span>
              <span>1 in 100 — wins a % of the vault</span>
            </li>
          </ul>
          {error && <p className="small error">{error}</p>}
          {!onchain && (
            <p className="muted small">
              {isConnected
                ? 'Contracts not configured — opening in demo mode.'
                : 'Wallet not connected — opening in demo mode.'}
            </p>
          )}
          <button className="btn btn-green btn-full" onClick={handleOpen}>
            {onchain ? 'Buy & Open Pack' : 'Open Pack (demo)'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`cinema ${stage === 'reveal' && fx.shake ? 'cinema-shake' : ''}`}
      style={{ '--glow': fx.glow, '--pack-glow': pack.tint } as React.CSSProperties}
    >
      {stage === 'charging' && (
        <div className="charge-scene">
          <div className="charge-aura" />
          <div className="charge-ring" />
          <div className="charge-ring charge-ring-2" />
          <div className="charge-pack">
            <PackVisual pack={pack} size="lg" />
          </div>
          <div className="charge-bar">
            <div className="charge-bar-fill" style={{ width: `${(step / OPEN_STEPS.length) * 100}%` }} />
          </div>
          <ul className="charge-steps">
            {OPEN_STEPS.map(([title, detail], i) => (
              <li key={title} className={i < step ? 'done' : i === step ? 'active' : ''}>
                <span className="charge-dot">{i < step ? '✓' : ''}</span>
                <span className="charge-text">
                  <strong>{title}</strong>
                  <span>{detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="charge-meta">
            <span className="mono muted small">{elapsed.toFixed(1)}s</span>
            {onchain && !txHash && <span className="muted small">confirm in your wallet…</span>}
            {txHash && (
              <a
                className="mono small charge-tx"
                href={`${robinhoodChain.blockExplorers.default.url}/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                tx {shortAddr(txHash)} ↗
              </a>
            )}
          </div>
          <p className="charge-fact" key={factIdx}>
            {CHARGE_FACTS[factIdx]}
          </p>
        </div>
      )}

      {stage === 'rip' && (
        <div className="rip-scene">
          <div className="rip-half rip-top" onAnimationEnd={() => setStage('reveal')}>
            <PackVisual pack={pack} size="lg" />
          </div>
          <div className="rip-half rip-bottom">
            <PackVisual pack={pack} size="lg" />
          </div>
          <div className="fx-shockwave" />
          <Burst color={fx.glow} count={fx.particles} />
          <div className="rip-flash" />
        </div>
      )}

      {stage === 'reveal' && card && (
        <div className="reveal-scene">
          {fx.rays && <div className="fx-rays" />}
          <Ambient color={fx.glow} count={Math.round(fx.particles / 2)} />
          <Burst color={fx.glow} count={fx.particles} />
          <p className={`reveal-title reveal-title-${tier}`}>
            {tier === 'jackpot'
              ? 'HIDDEN CARD'
              : tier === 'refund'
                ? 'REFUNDED'
                : card.kind === 'stock'
                  ? card.rarity.label.toUpperCase()
                  : ''}
          </p>
          <RevealCard3D card={card} />
          <div className="reveal-actions">
            <button className="btn btn-green btn-lg" onClick={() => setStage('confirm')}>
              Open Another
            </button>
            <button className="btn btn-ghost btn-lg" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
