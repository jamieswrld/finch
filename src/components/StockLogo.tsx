import { useState } from 'react'
import { asset, type Stock } from '../data'

/** Real ticker logo with a colored-dot fallback if the image is missing or fails. */
export function StockLogo({ stock, size = 20 }: { stock: Stock; size?: number }) {
  const [failed, setFailed] = useState(false)

  if (failed || !stock.logo) {
    return (
      <span
        className="ticker-dot"
        style={{ background: stock.color, width: size, height: size, flexShrink: 0 }}
      />
    )
  }

  return (
    <img
      className="stock-logo"
      src={asset(stock.logo)}
      width={size}
      height={size}
      alt={stock.ticker}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}
