import { parseAbiItem, parseEventLogs, type Address } from 'viem'
import { getAccount, getPublicClient, readContract, waitForTransactionReceipt, writeContract } from 'wagmi/actions'
import { wagmiConfig } from './chain'
import { RARITY_TIERS, STOCKS, USDG_ADDRESS, type Pack } from './data'
import type { Card } from './rng'

/** Set these in .env(.local) after deploying contracts/ — until then the site runs in demo mode. */
export const PACK_SALE_ADDRESS = (import.meta.env.VITE_PACK_SALE_ADDRESS ?? '') as Address
export const VAULT_ADDRESS = (import.meta.env.VITE_VAULT_ADDRESS ?? '') as Address
const USDG = (import.meta.env.VITE_USDG_ADDRESS ?? USDG_ADDRESS) as Address

export const isOnchainEnabled = (): boolean => PACK_SALE_ADDRESS.length === 42 && VAULT_ADDRESS.length === 42

const erc20Abi = [
  {
    type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function', name: 'allowance', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }],
  },
] as const

export const vaultAbi = [
  { type: 'function', name: 'available', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

const packSaleAbi = [
  {
    type: 'function', name: 'buyPack', stateMutability: 'nonpayable',
    inputs: [{ name: 'packId', type: 'uint256' }], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'open', stateMutability: 'nonpayable',
    inputs: [{ name: 'purchaseId', type: 'uint256' }], outputs: [],
  },
  {
    type: 'event', name: 'Purchased',
    inputs: [
      { name: 'purchaseId', type: 'uint256', indexed: true },
      { name: 'buyer', type: 'address', indexed: true },
      { name: 'packId', type: 'uint256', indexed: true },
    ],
  },
  {
    type: 'event', name: 'OpenedStock',
    inputs: [
      { name: 'purchaseId', type: 'uint256', indexed: true },
      { name: 'buyer', type: 'address', indexed: true },
      { name: 'stock', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'valueUsdg', type: 'uint256', indexed: false },
      { name: 'rarityBps', type: 'uint16', indexed: false },
    ],
  },
  {
    type: 'event', name: 'OpenedJackpot',
    inputs: [
      { name: 'purchaseId', type: 'uint256', indexed: true },
      { name: 'buyer', type: 'address', indexed: true },
      { name: 'pctBps', type: 'uint256', indexed: false },
      { name: 'amountUsdg', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'Refunded',
    inputs: [
      { name: 'purchaseId', type: 'uint256', indexed: true },
      { name: 'buyer', type: 'address', indexed: true },
      { name: 'amountUsdg', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'Rearmed',
    inputs: [
      { name: 'purchaseId', type: 'uint256', indexed: true },
      { name: 'newCommitBlock', type: 'uint64', indexed: false },
    ],
  },
] as const

const USDG_DECIMALS = 6
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function stockFromAddress(address: Address): Promise<Card & { kind: 'stock' }> {
  const known = STOCKS.find((s) => s.address.toLowerCase() === address.toLowerCase())
  if (known) return { kind: 'stock', stock: known, valueUsd: 0, rarity: RARITY_TIERS[0] }
  const symbol = await readContract(wagmiConfig, { address, abi: erc20Abi, functionName: 'symbol' }).catch(
    () => 'STOCK',
  )
  return {
    kind: 'stock',
    stock: { ticker: symbol, name: symbol, address, color: '#111111' },
    valueUsd: 0,
    rarity: RARITY_TIERS[0],
  }
}

export interface HiddenCardWin {
  jackpotPct: number
  valueUsd: number
  txHash: string
}

/** All hidden-card wins for a wallet, straight from OpenedJackpot events on-chain. */
export async function fetchHiddenCards(buyer: Address): Promise<HiddenCardWin[]> {
  const client = getPublicClient(wagmiConfig)
  if (!client || !isOnchainEnabled()) return []
  const logs = await client.getLogs({
    address: PACK_SALE_ADDRESS,
    event: parseAbiItem(
      'event OpenedJackpot(uint256 indexed purchaseId, address indexed buyer, uint256 pctBps, uint256 amountUsdg)',
    ),
    args: { buyer },
    fromBlock: 0n,
    toBlock: 'latest',
  })
  return logs.map((log) => ({
    jackpotPct: Number(log.args.pctBps ?? 0n) / 100,
    valueUsd: Number(log.args.amountUsdg ?? 0n) / 10 ** USDG_DECIMALS,
    txHash: log.transactionHash ?? '',
  }))
}

/** Opening progress for the gacha UI: 0 payment · 1 randomness locked · 2 settling.
 *  txHash accompanies steps that landed a transaction, for explorer links. */
export type OpenProgress = (step: number, txHash?: `0x${string}`) => void

/** Real flow: approve USDG if needed → buyPack → open (retrying across the commit block). */
export async function buyAndOpenOnchain(pack: Pack, onProgress?: OpenProgress): Promise<Card> {
  onProgress?.(0)
  const account = getAccount(wagmiConfig).address
  if (!account) throw new Error('Wallet not connected')
  const price = BigInt(Math.round(pack.priceUsd * 10 ** USDG_DECIMALS))

  const allowance = await readContract(wagmiConfig, {
    address: USDG, abi: erc20Abi, functionName: 'allowance', args: [account, PACK_SALE_ADDRESS],
  })
  if (allowance < price) {
    const approveHash = await writeContract(wagmiConfig, {
      address: USDG, abi: erc20Abi, functionName: 'approve', args: [PACK_SALE_ADDRESS, price * 100n],
    })
    await waitForTransactionReceipt(wagmiConfig, { hash: approveHash })
  }

  const buyHash = await writeContract(wagmiConfig, {
    address: PACK_SALE_ADDRESS, abi: packSaleAbi, functionName: 'buyPack', args: [BigInt(pack.chainPackId)],
  })
  const buyReceipt = await waitForTransactionReceipt(wagmiConfig, { hash: buyHash })
  const purchased = parseEventLogs({ abi: packSaleAbi, logs: buyReceipt.logs, eventName: 'Purchased' })
  if (purchased.length === 0) throw new Error('Purchased event not found')
  const purchaseId = purchased[0].args.purchaseId
  onProgress?.(1, buyHash)

  for (let attempt = 0; attempt < 10; attempt++) {
    let openHash: `0x${string}`
    try {
      openHash = await writeContract(wagmiConfig, {
        address: PACK_SALE_ADDRESS, abi: packSaleAbi, functionName: 'open', args: [purchaseId],
      })
    } catch {
      await sleep(500) // likely TooEarly — same block as the commit
      continue
    }
    onProgress?.(2, openHash)
    const receipt = await waitForTransactionReceipt(wagmiConfig, { hash: openHash })
    const logs = parseEventLogs({ abi: packSaleAbi, logs: receipt.logs })

    for (const log of logs) {
      if (log.eventName === 'OpenedStock') {
        const card = await stockFromAddress(log.args.stock as Address)
        card.valueUsd = Number(log.args.valueUsdg) / 10 ** USDG_DECIMALS
        card.rarity =
          RARITY_TIERS.find((t) => Math.round(t.multiplier * 10_000) === log.args.rarityBps) ?? RARITY_TIERS[0]
        return card
      }
      if (log.eventName === 'OpenedJackpot') {
        return {
          kind: 'jackpot',
          jackpotPct: Number(log.args.pctBps) / 100,
          valueUsd: Number(log.args.amountUsdg) / 10 ** USDG_DECIMALS,
        }
      }
      if (log.eventName === 'Refunded') {
        return { kind: 'refund', valueUsd: Number(log.args.amountUsdg) / 10 ** USDG_DECIMALS }
      }
    }
    // Rearmed — wait for a fresh block and try again
    await sleep(800)
  }
  throw new Error('Pack did not settle — try opening again from the explorer')
}
