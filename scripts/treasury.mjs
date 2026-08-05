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

const SALE = process.env.PACK_SALE ?? '0x7e427a08a9d8fdfcC49d84a0471c0C064c08C64D'
const VAULT = process.env.VAULT ?? '0xb9F3125Ae55712aE9F4c15F7b18308549F587A2F'
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

function wallet() {
  const pk =
    process.env.TREASURY_KEY?.trim() ??
    readFileSync('contracts/.env', 'utf8').match(/PRIVATE_KEY=(0x[0-9a-fA-F]{64})/)?.[1]
  if (!pk) throw new Error('set TREASURY_KEY or PRIVATE_KEY in contracts/.env')
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
        const msg = await once()
        if (!msg.includes('nothing to do')) console.log(new Date().toISOString(), msg)
      } catch (e) {
        console.log('retry:', String(e.message ?? e).split('\n')[0].slice(0, 120))
      }
      await new Promise((r) => setTimeout(r, 60_000))
    }
  }
}
