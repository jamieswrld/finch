/**
 * finch token slot.
 *
 * TO GO LIVE: paste the token's contract address into TOKEN_ADDRESS below (or set
 * VITE_TOKEN_ADDRESS in the environment) and deploy. That is the only change needed —
 * the header buy button, the token panel, and the docs entry all light up from it and
 * stay hidden until it is set.
 */

export const TOKEN_ADDRESS = String(import.meta.env.VITE_TOKEN_ADDRESS ?? '').trim()

export const TOKEN_SYMBOL = String(import.meta.env.VITE_TOKEN_SYMBOL ?? 'FINCH').trim()

/** Where the buy button points. Defaults to a Uniswap v4 swap on Robinhood Chain. */
export const tokenBuyUrl = (): string =>
  (import.meta.env.VITE_TOKEN_BUY_URL as string) ??
  `https://app.uniswap.org/swap?chain=4663&outputCurrency=${TOKEN_ADDRESS}`

export const isTokenLive = (): boolean => /^0x[0-9a-fA-F]{40}$/.test(TOKEN_ADDRESS)
