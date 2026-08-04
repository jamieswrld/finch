import { useEffect, useState } from 'react'
import { formatUnits, parseAbi, parseAbiItem, type Address } from 'viem'
import { getPublicClient } from 'wagmi/actions'
import { wagmiConfig } from './chain'
import { USDG_ADDRESS } from './data'
import { PACK_SALE_ADDRESS, VAULT_ADDRESS, isOnchainEnabled } from './onchain'

const USDG_DECIMALS = 6
const toUsd = (v: bigint) => Number(formatUnits(v, USDG_DECIMALS))

export interface ChainStats {
  jackpotUsd: number
  volumeUsd: number
  packsOpened: number
  hiddenCardsFound: number
  /** USDG the sale contract can still commit to new packs */
  headroomUsd: number
  loading: boolean
}

const vaultAbi = parseAbi([
  'function available() view returns (uint256)',
  'function totalAccrued() view returns (uint256)',
])
const saleAbi = parseAbi([
  'function reservedLiability() view returns (uint256)',
  'function purchaseCount() view returns (uint256)',
])

/** Live protocol stats, polled from chain. Falls back to zeros before deployment. */
export function useChainStats(pollMs = 12_000): ChainStats {
  const [stats, setStats] = useState<ChainStats>({
    jackpotUsd: 0,
    volumeUsd: 0,
    packsOpened: 0,
    hiddenCardsFound: 0,
    headroomUsd: 0,
    loading: true,
  })

  useEffect(() => {
    if (!isOnchainEnabled()) {
      setStats((s) => ({ ...s, loading: false }))
      return
    }
    let alive = true

    const read = async () => {
      const client = getPublicClient(wagmiConfig)
      if (!client) return
      try {
        const [pot, accrued, liability, purchases, float] = await Promise.all([
          client.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: 'available' }),
          client.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: 'totalAccrued' }),
          client.readContract({ address: PACK_SALE_ADDRESS, abi: saleAbi, functionName: 'reservedLiability' }),
          client.readContract({ address: PACK_SALE_ADDRESS, abi: saleAbi, functionName: 'purchaseCount' }),
          client.readContract({
            address: USDG_ADDRESS as Address,
            abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
            functionName: 'balanceOf',
            args: [PACK_SALE_ADDRESS],
          }),
        ])
        if (!alive) return
        setStats({
          jackpotUsd: toUsd(pot),
          // vault takes 20% of every sale, so lifetime sales = accrued x 5
          volumeUsd: toUsd(accrued * 5n),
          packsOpened: Number(purchases),
          hiddenCardsFound: 0, // filled by the feed hook below
          headroomUsd: toUsd(float > liability ? float - liability : 0n),
          loading: false,
        })
      } catch {
        if (alive) setStats((s) => ({ ...s, loading: false }))
      }
    }

    read()
    const id = setInterval(read, pollMs)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [pollMs])

  return stats
}

export interface ChainPull {
  id: string
  buyer: Address
  kind: 'stock' | 'jackpot' | 'refund'
  stock?: Address
  valueUsd: number
  pctBps?: number
  txHash: string
  block: bigint
}

const OPENED_STOCK = parseAbiItem(
  'event OpenedStock(uint256 indexed purchaseId, address indexed buyer, address stock, uint256 amount, uint256 valueUsdg, uint16 rarityBps)',
)
const OPENED_JACKPOT = parseAbiItem(
  'event OpenedJackpot(uint256 indexed purchaseId, address indexed buyer, uint256 pctBps, uint256 amountUsdg)',
)
const REFUNDED = parseAbiItem(
  'event Refunded(uint256 indexed purchaseId, address indexed buyer, uint256 amountUsdg)',
)

/** Real pack openings straight from contract events — no simulation. */
export function useLivePulls(limit = 8, pollMs = 15_000): ChainPull[] {
  const [pulls, setPulls] = useState<ChainPull[]>([])

  useEffect(() => {
    if (!isOnchainEnabled()) return
    let alive = true

    const read = async () => {
      const client = getPublicClient(wagmiConfig)
      if (!client) return
      try {
        const latest = await client.getBlockNumber()
        // Orbit chains are fast; a wide window still returns quickly and covers a full day.
        const fromBlock = latest > 2_000_000n ? latest - 2_000_000n : 0n
        const [stocks, jackpots, refunds] = await Promise.all([
          client.getLogs({ address: PACK_SALE_ADDRESS, event: OPENED_STOCK, fromBlock, toBlock: 'latest' }),
          client.getLogs({ address: PACK_SALE_ADDRESS, event: OPENED_JACKPOT, fromBlock, toBlock: 'latest' }),
          client.getLogs({ address: PACK_SALE_ADDRESS, event: REFUNDED, fromBlock, toBlock: 'latest' }),
        ])
        if (!alive) return

        const all: ChainPull[] = [
          ...stocks.map((l) => ({
            id: `s${l.transactionHash}${l.logIndex}`,
            buyer: l.args.buyer as Address,
            kind: 'stock' as const,
            stock: l.args.stock as Address,
            valueUsd: toUsd(l.args.valueUsdg ?? 0n),
            txHash: l.transactionHash ?? '',
            block: l.blockNumber ?? 0n,
          })),
          ...jackpots.map((l) => ({
            id: `j${l.transactionHash}${l.logIndex}`,
            buyer: l.args.buyer as Address,
            kind: 'jackpot' as const,
            valueUsd: toUsd(l.args.amountUsdg ?? 0n),
            pctBps: Number(l.args.pctBps ?? 0n),
            txHash: l.transactionHash ?? '',
            block: l.blockNumber ?? 0n,
          })),
          ...refunds.map((l) => ({
            id: `r${l.transactionHash}${l.logIndex}`,
            buyer: l.args.buyer as Address,
            kind: 'refund' as const,
            valueUsd: toUsd(l.args.amountUsdg ?? 0n),
            txHash: l.transactionHash ?? '',
            block: l.blockNumber ?? 0n,
          })),
        ]
        all.sort((a, b) => Number(b.block - a.block))
        setPulls(all.slice(0, limit))
      } catch {
        /* keep last good data */
      }
    }

    read()
    const id = setInterval(read, pollMs)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [limit, pollMs])

  return pulls
}
