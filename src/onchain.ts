import { parseAbiItem, parseEventLogs, type Address } from 'viem'
import { getAccount, getPublicClient, readContract, waitForTransactionReceipt, writeContract } from 'wagmi/actions'
import { wagmiConfig } from './chain'
import { RARITY_TIERS, STOCKS, USDG_ADDRESS, type Pack } from './data'
import type { Card } from './rng'

/** Set these in .env(.local) after deploying contracts/ — until then the site runs in demo mode. */
/** Env values can arrive with stray whitespace/newlines depending on how they were set;
 *  normalise here so a trailing "\n" can never silently drop the app into demo mode. */
const addr = (v: unknown, fallback = ''): Address => (String(v ?? '').trim() || fallback) as Address
const isAddr = (v: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(v)

export const PACK_SALE_ADDRESS = addr(import.meta.env.VITE_PACK_SALE_ADDRESS)
export const VAULT_ADDRESS = addr(import.meta.env.VITE_VAULT_ADDRESS)
/** Treasury / protocol-fee recipient. */
export const TREASURY_ADDRESS = '0xd589cF06C304e91BEc4432278e9E852914631733'
const USDG = addr(import.meta.env.VITE_USDG_ADDRESS, USDG_ADDRESS)

export const isOnchainEnabled = (): boolean => isAddr(PACK_SALE_ADDRESS) && isAddr(VAULT_ADDRESS)

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
  {
    type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }],
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
    type: 'function', name: 'buyPackETH', stateMutability: 'payable',
    inputs: [{ name: 'packId', type: 'uint256' }], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'reservedLiability', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }],
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

export type PayWith = 'usdg' | 'eth'

export interface BuyPreflight {
  ok: boolean
  /** Reason a purchase would fail right now, phrased for the user. */
  reason?: string
  usdgBalance: number
  ethBalance: number
  headroomUsd: number
  /** Best payment method given what the wallet actually holds. */
  suggested: PayWith
  canPayUsdg: boolean
  canPayEth: boolean
}

const CHAINLINK_ETH_USD = '0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9' as Address
const feedAbi = [
  {
    type: 'function', name: 'latestRoundData', stateMutability: 'view', inputs: [],
    outputs: [
      { type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' },
    ],
  },
] as const

/** ETH needed for a pack, with a buffer for pool fees. Surplus returns as USDG change. */
export async function quoteEthForPack(priceUsd: number): Promise<bigint> {
  const client = getPublicClient(wagmiConfig)
  if (!client) return 0n
  const round = (await client.readContract({
    address: CHAINLINK_ETH_USD,
    abi: feedAbi,
    functionName: 'latestRoundData',
  })) as readonly [bigint, bigint, bigint, bigint, bigint]
  const ethUsd = Number(round[1]) / 1e8
  if (!ethUsd) return 0n
  // +4% covers the 0.05% pool fee plus price drift between quote and execution
  return BigInt(Math.ceil((priceUsd / ethUsd) * 1.04 * 1e18))
}

/** Everything that can block a purchase, checked before the wallet is ever opened. */
export async function preflightBuy(account: Address, priceUsd: number): Promise<BuyPreflight> {
  const client = getPublicClient(wagmiConfig)
  const price = BigInt(Math.round(priceUsd * 10 ** USDG_DECIMALS))
  if (!client || !isOnchainEnabled()) {
    return {
      ok: false,
      reason: 'Contracts are not configured yet.',
      usdgBalance: 0,
      ethBalance: 0,
      headroomUsd: 0,
      suggested: 'usdg',
      canPayUsdg: false,
      canPayEth: false,
    }
  }

  const [balance, float, liability, ethWei] = await Promise.all([
    readContract(wagmiConfig, {
      address: USDG,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    }) as Promise<bigint>,
    readContract(wagmiConfig, {
      address: USDG,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [PACK_SALE_ADDRESS],
    }) as Promise<bigint>,
    readContract(wagmiConfig, {
      address: PACK_SALE_ADDRESS,
      abi: packSaleAbi,
      functionName: 'reservedLiability',
    }) as Promise<bigint>,
    client ? client.getBalance({ address: account }) : Promise.resolve(0n),
  ])

  const usdgBalance = Number(balance) / 10 ** USDG_DECIMALS
  const ethBalance = Number(ethWei) / 1e18
  const free = float > liability ? float - liability : 0n
  const headroomUsd = Number(free) / 10 ** USDG_DECIMALS

  const ethNeeded = await quoteEthForPack(priceUsd).catch(() => 0n)
  // leave a little ETH for gas rather than letting the buy consume the whole balance
  const canPayEth = ethNeeded > 0n && ethWei > ethNeeded + 300_000_000_000_000n
  const canPayUsdg = balance >= price
  const suggested: PayWith = canPayUsdg ? 'usdg' : 'eth'

  if (free < price * 3n) {
    return {
      ok: false,
      reason: 'Packs are momentarily at capacity — one is settling. Try again in a few seconds.',
      usdgBalance,
      ethBalance,
      headroomUsd,
      suggested,
      canPayUsdg,
      canPayEth,
    }
  }
  return { ok: canPayUsdg || canPayEth, usdgBalance, ethBalance, headroomUsd, suggested, canPayUsdg, canPayEth }
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
export async function buyAndOpenOnchain(
  pack: Pack,
  onProgress?: OpenProgress,
  payWith: PayWith = 'usdg',
): Promise<Card> {
  onProgress?.(0)
  const account = getAccount(wagmiConfig).address
  if (!account) throw new Error('Wallet not connected')
  const price = BigInt(Math.round(pack.priceUsd * 10 ** USDG_DECIMALS))

  let buyHash: `0x${string}`
  if (payWith === 'eth') {
    const value = await quoteEthForPack(pack.priceUsd)
    buyHash = await writeContract(wagmiConfig, {
      address: PACK_SALE_ADDRESS,
      abi: packSaleAbi,
      functionName: 'buyPackETH',
      args: [BigInt(pack.chainPackId)],
      value,
    })
  } else {
    const allowance = await readContract(wagmiConfig, {
      address: USDG, abi: erc20Abi, functionName: 'allowance', args: [account, PACK_SALE_ADDRESS],
    })
    if (allowance < price) {
      const approveHash = await writeContract(wagmiConfig, {
        address: USDG, abi: erc20Abi, functionName: 'approve', args: [PACK_SALE_ADDRESS, price * 100n],
      })
      await waitForTransactionReceipt(wagmiConfig, { hash: approveHash })
    }
    buyHash = await writeContract(wagmiConfig, {
      address: PACK_SALE_ADDRESS, abi: packSaleAbi, functionName: 'buyPack', args: [BigInt(pack.chainPackId)],
    })
  }
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
