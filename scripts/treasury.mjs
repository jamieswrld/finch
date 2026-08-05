// finch treasury manager — keeps the PackSale float topped up so the site never
// stalls, and reports where the money is.
//
//   node scripts/treasury.mjs status          # full money map
//   node scripts/treasury.mjs topup [target]  # move vault surplus into the float
//   node scripts/treasury.mjs watch [target]  # do it automatically, forever
//
// Why this exists: cards pay out ~84% of pack price while the sale contract keeps
// 79%, so the float drains ~5% per pack while profit piles up in the vault. Without
// recycling, the site eventually refuses buys while holding plenty of money.
//
// PONS creator fees plug in here later as another income source: claim -> swap to
// USDG -> same topup path.

import { readFileSync } from 'node:fs'
import {
  createPublicClient, createWalletClient, defineChain, formatUnits, http, parseAbi, parseUnits,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const SALE = process.env.PACK_SALE ?? '0x933C7F2F72e8FD5b57afB7a9Ee1ad36Fc5a6D45c'
const VAULT = process.env.VAULT ?? '0xe7353a598229d1ce4c8ac15E731c380D92dfb137'
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
const TREASURY = '0xd589cF06C304e91BEc4432278e9E852914631733'

/** Keep at least this much float so the big packs stay sellable. */
const DEFAULT_TARGET = 300

const chain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
})

const pub = createPublicClient({ chain, transport: http() })
const usd = (v) => `$${Number(formatUnits(v, 6)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`

const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)'])
const vaultAbi = parseAbi([
  'function available() view returns (uint256)',
  'function totalAccrued() view returns (uint256)',
  'function totalHiddenCardPaid() view returns (uint256)',
  'function totalWithdrawn() view returns (uint256)',
  'function withdraw(address to, uint256 amount)',
])
const saleAbi = parseAbi([
  'function reservedLiability() view returns (uint256)',
  'function purchaseCount() view returns (uint256)',
])

function envKey(name) {
  try {
    return readFileSync('contracts/.env', 'utf8').match(new RegExp(`${name}=(0x[0-9a-fA-F]{64})`))?.[1]
  } catch {
    return undefined
  }
}

/** Contract owner — the only key that can move vault -> float. */
function wallet() {
  const pk = process.env.TREASURY_KEY?.trim() ?? envKey('PRIVATE_KEY')
  if (!pk) throw new Error('set TREASURY_KEY or PRIVATE_KEY in contracts/.env')
  return createWalletClient({ account: privateKeyToAccount(pk), chain, transport: http() })
}

/** Wallet that receives Pons creator fees. Separate from the contract owner so the
 *  launch wallet never needs contract privileges, and vice versa. */
function feeWallet() {
  const pk = process.env.FEE_KEY?.trim() ?? envKey('FEE_KEY')
  if (!pk) return null
  return createWalletClient({ account: privateKeyToAccount(pk), chain, transport: http() })
}

async function snapshot() {
  const [pot, accrued, hidden, withdrawn, float, liability, purchases, treasury] = await Promise.all([
    pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'available' }),
    pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'totalAccrued' }),
    pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'totalHiddenCardPaid' }),
    pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'totalWithdrawn' }),
    pub.readContract({ address: USDG, abi: erc20, functionName: 'balanceOf', args: [SALE] }),
    pub.readContract({ address: SALE, abi: saleAbi, functionName: 'reservedLiability' }),
    pub.readContract({ address: SALE, abi: saleAbi, functionName: 'purchaseCount' }),
    pub.readContract({ address: USDG, abi: erc20, functionName: 'balanceOf', args: [TREASURY] }),
  ])
  return { pot, accrued, hidden, withdrawn, float, liability, purchases, treasury }
}

function capacity(freeUsd) {
  return [10, 25, 50, 100].map((p) => `${p === 10 ? '' : ' '}$${p}: ${Math.floor(freeUsd / (p * 3))}`).join('   ')
}

const SWAPPER = '0x8b959dB2bd9835DFD8a575E3cb696Fcab7Dbd8Dd'
/** Keep this much ETH in the operator wallet for gas; sweep only the excess. */
const GAS_RESERVE = parseUnits('0.03', 18)

const swapperAbi = parseAbi([
  'function swap(address tokenIn, address tokenOut, uint24 fee, int24 tickSpacing, uint256 amountIn, uint256 minOut) payable',
  'function sweep(address token, address to)',
])

/** Share of creator-fee income routed into the protocol, in bps. The remainder
 *  stays in the fee wallet as ETH — untouched, never swapped. */
const FLOAT_BPS = BigInt(process.env.FEE_TO_FLOAT_BPS ?? 2000) // 20% -> pack capacity
const JACKPOT_BPS = BigInt(process.env.FEE_TO_JACKPOT_BPS ?? 2000) // 20% -> prize pool

/** Recycle Pons creator fees. Only the routed share is converted; whatever you
 *  keep stays as ETH in the fee wallet and is never touched.
 *
 *    fees in ETH ──► keep 60%  (stays put, as ETH)
 *                └─► 20% ──┐
 *                └─► 20% ──┴─► USDG ──► 20% float · 20% jackpot
 */
async function sweepIncome() {
  // creator fees land in the fee wallet when configured, otherwise the owner wallet
  const w = feeWallet() ?? wallet()
  const me = w.account.address
  const routedBps = FLOAT_BPS + JACKPOT_BPS
  if (routedBps === 0n) return 'routing disabled'

  const eth = await pub.getBalance({ address: me })
  const spare = eth > GAS_RESERVE ? eth - GAS_RESERVE : 0n
  const convert = (spare * routedBps) / 10_000n
  // don't bother with dust — the swap would cost more than it moves
  if (convert < parseUnits('0.002', 18)) return 'nothing to sweep'

  // convert only the routed share
  let hash = await w.sendTransaction({ to: SWAPPER, value: convert })
  await pub.waitForTransactionReceipt({ hash })
  hash = await w.writeContract({
    address: SWAPPER,
    abi: swapperAbi,
    functionName: 'swap',
    args: ['0x0000000000000000000000000000000000000000', USDG, 500, 10, convert, 1n],
  })
  await pub.waitForTransactionReceipt({ hash })
  hash = await w.writeContract({
    address: SWAPPER, abi: swapperAbi, functionName: 'sweep', args: [USDG, me],
  })
  await pub.waitForTransactionReceipt({ hash })

  const got = await pub.readContract({ address: USDG, abi: erc20, functionName: 'balanceOf', args: [me] })
  if (got === 0n) return 'swap produced nothing'

  const toFloat = (got * FLOAT_BPS) / routedBps
  const toJackpot = got - toFloat
  const xfer = parseAbi(['function transfer(address,uint256) returns (bool)'])

  if (toFloat > 0n) {
    hash = await w.writeContract({ address: USDG, abi: xfer, functionName: 'transfer', args: [SALE, toFloat] })
    await pub.waitForTransactionReceipt({ hash })
  }
  if (toJackpot > 0n) {
    hash = await w.writeContract({ address: USDG, abi: xfer, functionName: 'transfer', args: [VAULT, toJackpot] })
    await pub.waitForTransactionReceipt({ hash })
  }

  const kept = spare - convert
  return `${formatUnits(convert, 18)} ETH routed -> ${usd(toFloat)} float + ${usd(toJackpot)} jackpot (kept ${formatUnits(kept, 18)} ETH)`
}

const cmd = process.argv[2] ?? 'status'
const target = Number(process.argv[3] ?? DEFAULT_TARGET)

if (cmd === 'status') {
  const s = await snapshot()
  const free = s.float > s.liability ? s.float - s.liability : 0n
  console.log(`
  PackSale float      ${usd(s.float)}   (reserved ${usd(s.liability)}, free ${usd(free)})
  Jackpot vault       ${usd(s.pot)}
  Treasury wallet     ${usd(s.treasury)}   (1% fees)
  ---
  lifetime sales      ${usd(s.accrued * 5n)}   across ${s.purchases} packs
  hidden cards paid   ${usd(s.hidden)}
  vault withdrawn     ${usd(s.withdrawn)}

  concurrent packs sellable:  ${capacity(Number(formatUnits(free, 6)))}
`)
} else if (cmd === 'sweep') {
  console.log(await sweepIncome())
} else if (cmd === 'topup' || cmd === 'watch') {
  const targetWei = parseUnits(String(target), 6)

  const once = async () => {
    const s = await snapshot()
    if (s.float >= targetWei) {
      return `float ${usd(s.float)} >= target ${usd(targetWei)} — nothing to do`
    }
    const need = targetWei - s.float
    const move = need < s.pot ? need : s.pot
    if (move <= 0n) return `float ${usd(s.float)} short, but vault is empty`

    const w = wallet()
    const hash = await w.writeContract({
      address: VAULT, abi: vaultAbi, functionName: 'withdraw', args: [SALE, move],
    })
    await pub.waitForTransactionReceipt({ hash })
    return `moved ${usd(move)} vault -> float (now ${usd(s.float + move)})  ${chain.blockExplorers.default.url}/tx/${hash}`
  }

  if (cmd === 'topup') {
    console.log(await once())
  } else {
    console.log(`watching — keeping float at ${usd(targetWei)}`)
    for (;;) {
      try {
        // pull in any creator-fee income first, then rebalance vault -> float
        if (process.env.SWEEP_INCOME === '1') {
          const swept = await sweepIncome()
          if (swept !== 'nothing to sweep') console.log(new Date().toISOString(), 'swept:', swept)
        }
        const msg = await once()
        if (!msg.includes('nothing to do')) console.log(new Date().toISOString(), msg)
      } catch (e) {
        console.log('retry:', String(e.message ?? e).split('\n')[0].slice(0, 120))
      }
      await new Promise((r) => setTimeout(r, 60_000))
    }
  }
}
