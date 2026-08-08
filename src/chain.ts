import { defineChain, fallback, http } from 'viem'
import { createConfig } from 'wagmi'
import { injected } from 'wagmi/connectors'

// BNB Smart Chain — the assets in every pack trade on PancakeSwap here.
// Docs: https://docs.bnbchain.org
export const bnbChain = defineChain({
  id: 56,
  name: 'BNB Chain',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://bsc-rpc.publicnode.com'] },
  },
  blockExplorers: {
    default: { name: 'BscScan', url: 'https://bscscan.com' },
  },
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
})

export const bnbChainTestnet = defineChain({
  id: 97,
  name: 'BNB Chain Testnet',
  nativeCurrency: { name: 'tBNB', symbol: 'tBNB', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://bsc-testnet-rpc.publicnode.com'] },
  },
  blockExplorers: {
    default: { name: 'BscScan', url: 'https://testnet.bscscan.com' },
  },
  testnet: true,
})

/** Alchemy is used first when a key is configured — dedicated capacity, higher rate limits —
 *  with public endpoints behind it. `fallback` ranks by latency and fails over automatically,
 *  so one endpoint going down never takes the site with it. */
const ALCHEMY_KEY = import.meta.env.VITE_ALCHEMY_KEY as string | undefined

const mainnetTransport = fallback(
  [
    ...(ALCHEMY_KEY
      ? [http(`https://bnb-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`, { batch: true })]
      : []),
    http('https://bsc-rpc.publicnode.com', { batch: true }),
    http('https://bsc-dataseed.binance.org', { batch: true }),
    http('https://bsc-dataseed1.defibit.io'),
  ],
  { rank: { interval: 30_000 }, retryCount: 3, retryDelay: 200 },
)

export const wagmiConfig = createConfig({
  chains: [bnbChain, bnbChainTestnet],
  connectors: [injected()],
  transports: {
    [bnbChain.id]: mainnetTransport,
    [bnbChainTestnet.id]: http('https://bsc-testnet-rpc.publicnode.com'),
  },
  batch: { multicall: true },
})
