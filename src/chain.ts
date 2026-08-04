import { defineChain, fallback, http } from 'viem'
import { createConfig } from 'wagmi'
import { injected } from 'wagmi/connectors'

// Robinhood Chain — Arbitrum Orbit L2 (parent: Ethereum), mainnet live July 2026.
// Docs: https://docs.robinhood.com/chain
export const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
})

export const robinhoodChainTestnet = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://explorer.testnet.chain.robinhood.com' },
  },
  testnet: true,
})

/** Alchemy is used first when a key is configured — dedicated capacity, higher rate limits —
 *  with the public RPC and the sequencer endpoint behind it. `fallback` ranks by latency and
 *  fails over automatically, so one endpoint going down never takes the site with it. */
const ALCHEMY_KEY = import.meta.env.VITE_ALCHEMY_KEY as string | undefined

const mainnetTransport = fallback(
  [
    ...(ALCHEMY_KEY
      ? [http(`https://robinhood-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`, { batch: true })]
      : []),
    http('https://rpc.mainnet.chain.robinhood.com', { batch: true }),
    http('https://sequencer.mainnet.chain.robinhood.com'),
  ],
  { rank: { interval: 30_000 }, retryCount: 3, retryDelay: 200 },
)

export const wagmiConfig = createConfig({
  chains: [robinhoodChain, robinhoodChainTestnet],
  connectors: [injected()],
  transports: {
    [robinhoodChain.id]: mainnetTransport,
    [robinhoodChainTestnet.id]: http('https://rpc.testnet.chain.robinhood.com'),
  },
  batch: { multicall: true },
})
