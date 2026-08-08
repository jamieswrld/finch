import { useCallback, useEffect, useState } from 'react'
import { bnbChain } from '../chain'
import { TOKEN_ADDRESS, TOKEN_SYMBOL, isTokenLive, tokenBuyUrl } from './../token'

/** The canonical place to find the contract address. Stays hidden until the
 *  token is live, so nothing renders as an empty slot before launch. */
export function TokenBar() {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(TOKEN_ADDRESS)
      setCopied(true)
    } catch {
      /* clipboard blocked — the address is selectable on screen anyway */
    }
  }, [])

  if (!isTokenLive()) return null

  return (
    <div className="ca-bar">
      <span className="ca-label">${TOKEN_SYMBOL} contract</span>
      <code className="ca-addr" title={TOKEN_ADDRESS}>
        {TOKEN_ADDRESS}
      </code>
      <div className="ca-actions">
        <button className="ca-btn" onClick={copy} aria-label="Copy contract address">
          {copied ? 'Copied' : 'Copy'}
        </button>
        <a
          className="ca-btn"
          href={`${bnbChain.blockExplorers.default.url}/token/${TOKEN_ADDRESS}`}
          target="_blank"
          rel="noreferrer"
        >
          Verify
        </a>
        <a className="btn btn-token btn-sm" href={tokenBuyUrl()} target="_blank" rel="noreferrer">
          Buy ${TOKEN_SYMBOL}
        </a>
      </div>
    </div>
  )
}
