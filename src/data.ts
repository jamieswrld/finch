export interface Stock {
  ticker: string
  name: string
  /** ERC-20 on BNB Smart Chain. Every address here was read back from chain
   *  (symbol/name/decimals) and confirmed to have a live PancakeSwap market. */
  address: string
  /** Token decimals — NOT uniformly 18 on BSC (DOGE is 8), so never assume. */
  decimals: number
  /** Chainlink <asset>/USD aggregator on BSC. Settlement derives its minimum
   *  output from this, so a thin or manipulated pool cannot shortchange a buyer. */
  feed: string
  color: string
  /** Self-hosted logo in public/logos/. StockLogo falls back to a colored dot without it. */
  logo?: string
}

export interface Pack {
  id: string
  name: string
  tagline: string
  priceUsd: number
  /** CSS tint for the pack wrapper */
  tint: string
  /** Tickers this pack can pull from */
  pool: string[]
  live: boolean
  /** Ordinal pack id in the PackSale contract (order of addPack calls in the deploy script) */
  chainPackId: number
  /** Real pack artwork (e.g. /packs/starter.webp). Falls back to the CSS placeholder — see PACK-ART.md. */
  image?: string
}

/** Resolve a public/ asset path against the deploy base (GitHub Pages serves under a subpath). */
export const asset = (p: string): string => import.meta.env.BASE_URL + p.replace(/^\//, '')

/** Official finch account on X. */
export const X_HANDLE = 'finchdotfun'
export const X_URL = `https://x.com/${X_HANDLE}`

/** USDT on BNB Smart Chain — the payment leg. Note this is 18 decimals on BSC,
 *  unlike the 6-decimal USDT on Ethereum. */
export const USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955'
export const USDT_DECIMALS = 18

export const JACKPOT_SEED_USD = 12_430.55
/** Share of every pack purchase routed into the jackpot vault */
export const JACKPOT_CUT = 0.2
/** Protocol fee on every purchase */
export const PROTOCOL_FEE = 0.01
/** Chance a pull is a hidden jackpot card instead of an asset */
export const HIDDEN_CARD_CHANCE = 0.01

/** The board, ordered by on-chain liquidity at the time of writing.
 *  Regenerate with `node scripts/verify-assets.mjs`. */
export const STOCKS: Stock[] = [
  { ticker: 'BTCB', name: 'Bitcoin', address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', decimals: 18, feed: '0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf', color: '#f7931a' },
  { ticker: 'WBNB', name: 'BNB', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18, feed: '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE', color: '#f0b90b' },
  { ticker: 'ETH', name: 'Ethereum', address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', decimals: 18, feed: '0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e', color: '#627eea' },
  { ticker: 'CAKE', name: 'PancakeSwap', address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', decimals: 18, feed: '0xB6064eD41d4f67e353768aA239cA86f4F73665a1', color: '#33e0e5' },
  { ticker: 'DOGE', name: 'Dogecoin', address: '0xbA2aE424d960c26247Dd6c32edC70B295c744C43', decimals: 8, feed: '0x3AB0A0d137D4F946fBB19eecc6e92E64660231C8', color: '#c2a633' },
  { ticker: 'XRP', name: 'XRP', address: '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE', decimals: 18, feed: '0x93A67D414896A280bF8FFB3b389fE3686E014fda', color: '#23292f' },
  { ticker: 'SOL', name: 'Solana', address: '0x570A5D26f7765Ecb712C0924E4De545B89fD43dF', decimals: 18, feed: '0x0E8a53DD9c13589df6382F13dA6B3Ec8F919B323', color: '#14f195' },
  { ticker: 'UNI', name: 'Uniswap', address: '0xBf5140A22578168FD562DCcF235E5D43A02ce9B1', decimals: 18, feed: '0xb57f259E7C24e56a1dA00F66b55A5640d9f9E7e4', color: '#ff007a' },
  { ticker: 'LINK', name: 'Chainlink', address: '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD', decimals: 18, feed: '0xca236E327F629f9Fc2c30A4E95775EbF0B89fac8', color: '#2a5ada' },
  { ticker: 'ADA', name: 'Cardano', address: '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47', decimals: 18, feed: '0xa767f745331D267c7751297D982b050c93985627', color: '#0033ad' },
  { ticker: 'XVS', name: 'Venus', address: '0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63', decimals: 18, feed: '0xBF63F430A79D4036A5900C19818aFf1fa710f206', color: '#2c60f5' },
  { ticker: 'LTC', name: 'Litecoin', address: '0x4338665CBB7B2485A8855A139b75D5e34AB0DB94', decimals: 18, feed: '0x74E72F37A8c415c8f1a98Ed42E78Ff997435791D', color: '#345d9d' },
  { ticker: 'SHIB', name: 'Shiba Inu', address: '0x2859e4544C4bB03966803b044A93563Bd2D0DD4D', decimals: 18, feed: '0xA615Be6cb0f3F36A641858dB6F30B9242d0ABeD8', color: '#f00500' },
  { ticker: 'DOT', name: 'Polkadot', address: '0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402', decimals: 18, feed: '0xC333eb0086309a16aa7c8308DfD32c8BBA0a2592', color: '#e6007a' },
  { ticker: 'INJ', name: 'Injective', address: '0xa2B726B1145A4773F68593CF171187d8EBe4d495', decimals: 18, feed: '0x63A9133cd7c611d6049761038C16f238FddA71d7', color: '#00a3ff' },
  { ticker: 'AVAX', name: 'Avalanche', address: '0x1CE0c2827e2eF14D5C4f29a091d735A204794041', decimals: 18, feed: '0x5974855ce31EE8E1fff2e76591CbF83D7110F151', color: '#e84142' },
  { ticker: 'FIL', name: 'Filecoin', address: '0x0D8Ce2A99Bb6e3B7Db580eD848240e4a0F9aE153', decimals: 18, feed: '0xE5dbFD9003bFf9dF5feB2f4F445Ca00fb121fb83', color: '#0090ff' },
  { ticker: 'BCH', name: 'Bitcoin Cash', address: '0x8fF795a6F4D97E7887C79beA79aba5cc76444aDf', decimals: 18, feed: '0x43d80f616DAf0b0B42a928EeD32147dC59027D41', color: '#8dc351' },
]

export const stockByTicker = (t: string): Stock => STOCKS.find((s) => s.ticker === t)!

/** Everything on the board has a Chainlink USD feed — that is the entry requirement. */
export const FEED_BACKED = STOCKS.map((s) => s.ticker)

const MAJORS = ['BTCB', 'ETH', 'WBNB', 'SOL', 'XRP', 'ADA', 'DOT', 'LTC', 'BCH']
const DEFI = ['CAKE', 'UNI', 'LINK', 'XVS', 'INJ', 'AVAX']

export const PACKS: Pack[] = [
  {
    id: 'starter',
    name: 'Starter Pack',
    tagline: 'One random asset from the full board',
    priceUsd: 10,
    tint: '#dfeadb',
    pool: FEED_BACKED,
    live: true,
    chainPackId: 0,
    image: '/packs/starter.webp',
  },
  {
    id: 'bluechip',
    name: 'Blue Chip Pack',
    tagline: 'Majors only',
    priceUsd: 25,
    tint: '#dbe6f6',
    pool: MAJORS,
    live: true,
    chainPackId: 1,
    image: '/packs/bluechip.webp',
  },
  {
    id: 'defi',
    name: 'DeFi Pack',
    tagline: 'Protocols and infrastructure',
    priceUsd: 50,
    tint: '#eae2f5',
    pool: DEFI,
    live: true,
    chainPackId: 2,
    image: '/packs/ai.webp',
  },
  {
    id: 'whale',
    name: 'Whale Pack',
    tagline: 'Max stakes, max upside',
    priceUsd: 100,
    tint: '#f3ead6',
    pool: FEED_BACKED,
    live: true,
    chainPackId: 3,
    image: '/packs/whale.webp',
  },
]

export interface RarityTier {
  key: 'common' | 'rare' | 'epic' | 'legendary'
  label: string
  weight: number
  /** Card value as a multiple of pack price */
  multiplier: number
  color: string
}

export const RARITY_TIERS: RarityTier[] = [
  { key: 'common', label: 'Common', weight: 0.78, multiplier: 0.7, color: '#9ca3af' },
  { key: 'rare', label: 'Rare', weight: 0.15, multiplier: 1.0, color: '#2b6cb0' },
  { key: 'epic', label: 'Epic', weight: 0.05, multiplier: 1.5, color: '#7c3aed' },
  { key: 'legendary', label: 'Legendary', weight: 0.02, multiplier: 3.0, color: '#d97706' },
]
