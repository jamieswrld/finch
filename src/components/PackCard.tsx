import { useCallback, useState } from 'react'
import { asset, stockByTicker, type Pack } from '../data'
import { fmtUsd } from '../rng'
import { StockLogo } from './StockLogo'

/** Real pack artwork when the pack has an `image` (see PACK-ART.md), CSS foil otherwise.
 *  White image backgrounds are multiply-blended away against light surfaces. */
export function PackVisual({ pack, size = 'md' }: { pack: Pack; size?: 'md' | 'lg' }) {
  if (pack.image) {
    return (
      <div className={`pack-visual pack-${size}`}>
        <img className="pack-visual-img" src={asset(pack.image)} alt={pack.name} draggable={false} />
      </div>
    )
  }
  return (
    <div className={`pack-visual pack-${size}`} style={{ '--tint': pack.tint } as React.CSSProperties}>
      <div className="pack-crimp pack-crimp-top" />
      <div className="pack-body">
        <div className="pack-sheen" />
        <span className="pack-brand">finch</span>
        <span className="pack-name">{pack.name}</span>
        <span className="pack-sub">{pack.tagline}</span>
      </div>
      <div className="pack-crimp pack-crimp-bottom" />
    </div>
  )
}

/** Pointer-tracked 3D tilt, Magic Eden-style. Returns handlers + a style for the media box. */
function useTilt() {
  const [style, setStyle] = useState<React.CSSProperties>({})

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    setStyle({
      transform: `perspective(700px) rotateY(${(px - 0.5) * 14}deg) rotateX(${(py - 0.5) * -14}deg) scale(1.03)`,
    })
  }, [])

  const onMouseLeave = useCallback(() => {
    setStyle({ transform: 'perspective(700px) rotateY(0deg) rotateX(0deg) scale(1)' })
  }, [])

  return { style, onMouseMove, onMouseLeave }
}

const MAX_LOGOS = 6

export function PackCard({ pack, onOpen }: { pack: Pack; onOpen: (p: Pack) => void }) {
  const tilt = useTilt()
  const shown = pack.pool.slice(0, MAX_LOGOS)
  const extra = pack.pool.length - shown.length

  return (
    <div className="pack-card">
      <div className="pack-media" onMouseMove={tilt.onMouseMove} onMouseLeave={tilt.onMouseLeave}>
        <div className="pack-media-inner" style={tilt.style}>
          <PackVisual pack={pack} />
        </div>
        <span className={`pack-badge ${pack.live ? 'pack-badge-live' : ''}`}>
          {pack.live && <span className="dot dot-green pulse" />}
          {pack.live ? 'Live' : 'Coming Soon'}
        </span>
      </div>
      <div className="pack-card-info">
        <div className="pack-card-row">
          <strong>{pack.name}</strong>
          <span className="pack-price">{fmtUsd(pack.priceUsd)}</span>
        </div>
        <p className="muted small">
          {pack.tagline} · 1 of {pack.pool.length} stocks
        </p>
        <div className="pack-logos" title={pack.pool.join(' · ')}>
          {shown.map((t) => (
            <span className="pack-logo-slot" key={t}>
              <StockLogo stock={stockByTicker(t)} size={24} />
            </span>
          ))}
          {extra > 0 && <span className="pack-logo-slot pack-logo-more">+{extra}</span>}
        </div>
        <button className="btn btn-green btn-full" disabled={!pack.live} onClick={() => onOpen(pack)}>
          {pack.live ? 'Buy & Open' : 'Coming Soon'}
        </button>
      </div>
    </div>
  )
}
