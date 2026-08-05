export interface Stock {
  ticker: string
  name: string
  /** Robinhood Stock Token (ERC-20, 18 decimals) on Robinhood Chain mainnet.
   *  Canonical registry: https://docs.robinhood.com/chain/contracts */
  address: string
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

/** USDG (Global Dollar, Paxos) — natively issued on Robinhood Chain */
export const USDG_ADDRESS = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'

export const JACKPOT_SEED_USD = 12_430.55
/** Share of every pack purchase routed into the jackpot vault */
export const JACKPOT_CUT = 0.2
/** Protocol fee on every purchase */
export const PROTOCOL_FEE = 0.01
/** Chance a pull is a hidden jackpot card instead of a stock */
export const HIDDEN_CARD_CHANCE = 0.01

export const STOCKS: Stock[] = [
  { ticker: 'NVDA', name: 'NVIDIA', address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', color: '#76b900', logo: '/logos/NVDA.png' },
  { ticker: 'AAPL', name: 'Apple', address: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', color: '#555555', logo: '/logos/AAPL.png' },
  { ticker: 'TSLA', name: 'Tesla', address: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d', color: '#cc0000', logo: '/logos/TSLA.png' },
  { ticker: 'MSFT', name: 'Microsoft', address: '0xe93237C50D904957Cf27E7B1133b510C669c2e74', color: '#0078d4', logo: '/logos/MSFT.png' },
  { ticker: 'AMZN', name: 'Amazon', address: '0x12f190a9F9d7D37a250758b26824B97CE941bF54', color: '#ff9900', logo: '/logos/AMZN.png' },
  { ticker: 'GOOGL', name: 'Alphabet', address: '0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3', color: '#4285f4', logo: '/logos/GOOGL.png' },
  { ticker: 'META', name: 'Meta', address: '0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35', color: '#0064e0', logo: '/logos/META.png' },
  { ticker: 'AMD', name: 'AMD', address: '0x86923f96303D656E4aa86D9d42D1e57ad2023fdC', color: '#111111', logo: '/logos/AMD.png' },
  { ticker: 'PLTR', name: 'Palantir', address: '0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A', color: '#101113', logo: '/logos/PLTR.png' },
  { ticker: 'COIN', name: 'Coinbase', address: '0x6330D8C3178a418788dF01a47479c0ce7CCF450b', color: '#0052ff', logo: '/logos/COIN.png' },
  { ticker: 'MSTR', name: 'Strategy', address: '0xec262a75e413fAfD0dF80480274532C79D42da09', color: '#cf4520', logo: '/logos/MSTR.png' },
  { ticker: 'NFLX', name: 'Netflix', address: '0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8', color: '#e50914', logo: '/logos/NFLX.png' },
  { ticker: 'GME', name: 'GameStop', address: '0x1b0E319c6A659F002271B69dB8A7df2F911c153E', color: '#d81f26', logo: '/logos/GME.png' },
  { ticker: 'SPCX', name: 'SpaceX', address: '0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa', color: '#005288', logo: '/logos/SPCX.svg' },
  { ticker: 'SPY', name: 'S&P 500 ETF', address: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C', color: '#8a0f1f', logo: '/logos/SPY.svg' },
  { ticker: 'QQQ', name: 'Nasdaq-100 ETF', address: '0xD5f3879160bc7c32ebb4dC785F8a4F505888de68', color: '#2b6cb0', logo: '/logos/QQQ.svg' },
  { ticker: 'AVGO', name: 'Broadcom', address: '0x156E175DD063a8cE274C50654eF40e0032b3fbcF', color: '#cc092f', logo: '/logos/AVGO.png' },
  { ticker: 'TSM', name: 'TSMC', address: '0x58FfE4a942d3885bAa22D7520691F611EF09e7AA', color: '#c8102e', logo: '/logos/TSM.png' },
  { ticker: 'INTC', name: 'Intel', address: '0xc72b96e0E48ecd4DC75E1e45396e26300BC39681', color: '#0068b5', logo: '/logos/INTC.png' },
  { ticker: 'ASML', name: 'ASML', address: '0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA', color: '#0f238c', logo: '/logos/ASML.png' },
  { ticker: 'MU', name: 'Micron', address: '0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD', color: '#005dab', logo: '/logos/MU.png' },
  { ticker: 'QCOM', name: 'Qualcomm', address: '0x0f17206447090e464C277571124dD2688E48AEA9', color: '#3253dc', logo: '/logos/QCOM.png' },
  { ticker: 'SMCI', name: 'Supermicro', address: '0xc01aA1fECeC0605b13bc84874ff7256C0f5F562a', color: '#151f6d', logo: '/logos/SMCI.png' },
  { ticker: 'CRWV', name: 'CoreWeave', address: '0x5f10A1C971B69e47e059e1dC91901B59b3fB49C3', color: '#12b5a5', logo: '/logos/CRWV.png' },
  { ticker: 'IONQ', name: 'IonQ', address: '0x558378E000D634A36593E338eBacdd6207640EfE', color: '#101113', logo: '/logos/IONQ.png' },
  { ticker: 'SNDK', name: 'Sandisk', address: '0xB90A19fF0Af67f7779afF50A882A9CfF42446400', color: '#ed1c24', logo: '/logos/SNDK.png' },
  { ticker: 'ORCL', name: 'Oracle', address: '0xb0992820E760d836549ba69BC7598b4af75dEE03', color: '#f80000', logo: '/logos/ORCL.png' },
  { ticker: 'NOW', name: 'ServiceNow', address: '0x0C3260aF4B8f13a69c4c2dFb84fD667890CDFa14', color: '#62d84e', logo: '/logos/NOW.png' },
  { ticker: 'CRWD', name: 'CrowdStrike', address: '0xea72Ecca2d0f6bFA1394DBBCff85b52CD4233931', color: '#e01e37', logo: '/logos/CRWD.png' },
  { ticker: 'INTU', name: 'Intuit', address: '0x56d23beE5f41A7120170b0c603Dae30128e460e9', color: '#365ebf', logo: '/logos/INTU.png' },
  { ticker: 'DELL', name: 'Dell', address: '0x941AE714EC6D8130c7B75d67160Ca08f1e7d11Dd', color: '#007db8', logo: '/logos/DELL.png' },
  { ticker: 'SHOP', name: 'Shopify', address: '0xF53F66751B1Eff985311b693531E3290F600c410', color: '#96bf48', logo: '/logos/SHOP.png' },
  { ticker: 'BABA', name: 'Alibaba', address: '0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4', color: '#ff6a00', logo: '/logos/BABA.png' },
  { ticker: 'RDDT', name: 'Reddit', address: '0x05b37Fb53A299a1b874A619e1c4C404D52C36F4C', color: '#ff4500', logo: '/logos/RDDT.png' },
  { ticker: 'RBLX', name: 'Roblox', address: '0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8', color: '#232527', logo: '/logos/RBLX.png' },
  { ticker: 'SOFI', name: 'SoFi', address: '0x98E75885157C80992A8D41b696D8c9C6Fb30A926', color: '#00b3e3', logo: '/logos/SOFI.png' },
  { ticker: 'CRCL', name: 'Circle', address: '0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5', color: '#0acb8e', logo: '/logos/CRCL.svg' },
  { ticker: 'RIVN', name: 'Rivian', address: '0xB1BF26c1D20ff267A4f93550d1E0d06ac40a114B', color: '#e6a324', logo: '/logos/RIVN.png' },
  { ticker: 'COST', name: 'Costco', address: '0x4EA005168D7F09a7A0Ba9D1DEf21a479950E44C2', color: '#e31837', logo: '/logos/COST.png' },
  { ticker: 'LLY', name: 'Eli Lilly', address: '0x8005d266423c7ea827372c9c864491e5786600ea', color: '#d52b1e', logo: '/logos/LLY.png' },
  { ticker: 'XOM', name: 'ExxonMobil', address: '0xf9B46d3D1B22199D4D1025a9cEDB540A33F1a2d5', color: '#fe000c', logo: '/logos/XOM.png' },
  { ticker: 'BA', name: 'Boeing', address: '0x4D21483a44Bf67a86b77E3dA301411880797D452', color: '#0033a1', logo: '/logos/BA.png' },
  { ticker: 'SOXX', name: 'Semiconductor ETF', address: '0x75742c18BC1f1C5c5f448f4C9D9C6F66dafAAa38', color: '#5c2d91', logo: '/logos/SOXX.svg' },
  { ticker: 'XLK', name: 'Tech Sector ETF', address: '0x15Cd20759CE7F3285c29A319dE2D1A2e098c6f43', color: '#006d9c', logo: '/logos/XLK.svg' },
  { ticker: 'USO', name: 'Oil Fund ETF', address: '0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344', color: '#1f3b73', logo: '/logos/USO.png' },
  { ticker: 'SLV', name: 'Silver Trust ETF', address: '0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f', color: '#8c9196', logo: '/logos/SLV.svg' },
]

export const stockByTicker = (t: string): Stock => STOCKS.find((s) => s.ticker === t)!

/** Only stocks with a live Chainlink feed can sit in pack pools — the contract
 *  prices every card through its feed, so feedless stocks would brick opens.
 *  Mirrors the sets wired in contracts/script/DeployMainnet.s.sol exactly. */
export const FEED_BACKED = [
  'NVDA', 'AAPL', 'TSLA', 'MSFT', 'AMZN', 'GOOGL', 'META', 'AMD', 'PLTR', 'COIN',
  'MSTR', 'GME', 'SPCX', 'SPY', 'QQQ', 'TSM', 'INTC', 'ASML', 'MU', 'CRWV',
  'IONQ', 'SNDK', 'ORCL', 'DELL', 'BABA', 'CRCL', 'USO', 'SLV',
]

export const PACKS: Pack[] = [
  {
    id: 'starter',
    name: 'Starter Pack',
    tagline: 'One random stock from the full board',
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
    tagline: 'Mag-7 heavyweights only',
    priceUsd: 25,
    tint: '#dbe6f6',
    pool: ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'NVDA', 'TSLA', 'ORCL'],
    live: true,
    chainPackId: 1,
    image: '/packs/bluechip.webp',
  },
  {
    id: 'ai',
    name: 'AI Pack',
    tagline: 'Chips and compute',
    priceUsd: 50,
    tint: '#eae2f5',
    pool: ['NVDA', 'AMD', 'TSM', 'MU', 'ASML', 'INTC', 'CRWV', 'IONQ', 'PLTR', 'MSFT'],
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
