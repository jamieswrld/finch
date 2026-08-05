// Jackpot tool: read the live pot and sales volume, or withdraw for manual distribution.
//   node scripts/round.mjs status              # pot, lifetime volume, hidden-card payouts, solvency headroom
//   node scripts/round.mjs buyers              # every wallet that has bought, ranked by spend
//   node scripts/round.mjs withdraw <to> <usd> # move USDG out of the vault to distribute manually
//
// Reads the owner key from contracts/.env. Read-only unless you pass `withdraw`.

import { readFileSync } from 'node:fs'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  http,
  parseAbi,
  parseAbiItem,
  parseUnits,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const SALE = process.env.PACK_SALE ?? '0x933C7F2F72e8FD5b57afB7a9Ee1ad36Fc5a6D45c'
const VAULT = process.env.VAULT ?? '0xe7353a598229d1ce4c8ac15E731c380D92dfb137'
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'

const chain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
})

const pub = createPublicClient({ chain, transport: http() })
const usd = (v) => `$${Number(formatUnits(v, 6)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`

const vaultAbi = parseAbi([
  'function available() view returns (uint256)',
  'function totalAccrued() view returns (uint256)',
  'function totalHiddenCardPaid() view returns (uint256)',
  'function totalWithdrawn() view returns (uint256)',
  'function withdraw(address to, uint256 amount)',
])

async function buyers() {
  const logs = await pub.getLogs({
    address: VAULT,
    event: parseAbiItem('event Accrued(address indexed buyer, uint256 amount, uint256 totalAccrued)'),
    fromBlock: 0n,
    toBlock: 'latest',
  })
  const totals = new Map()
  for (const l of logs) {
    const b = l.args.buyer
    totals.set(b, (totals.get(b) ?? 0n) + l.args.amount)
  }
  return [...totals.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1))
}

const cmd = process.argv[2] ?? 'status'

if (cmd === 'status') {
  const [pot, accrued, hidden, withdrawn, float, liability] = await Promise.all([
    pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'available' }),
    pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'totalAccrued' }),
    pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'totalHiddenCardPaid' }),
    pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'totalWithdrawn' }),
    pub.readContract({
      address: USDG,
      abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
      functionName: 'balanceOf',
      args: [SALE],
    }),
    pub.readContract({
      address: SALE,
      abi: parseAbi(['function reservedLiability() view returns (uint256)']),
      functionName: 'reservedLiability',
    }),
  ])
  const list = await buyers()
  const free = float - liability

  console.log(`\n  JACKPOT (live vault balance)   ${usd(pot)}`)
  console.log(`  lifetime volume into vault     ${usd(accrued)}   (= 20% of all pack sales)`)
  console.log(`  implied total pack sales       ${usd(accrued * 5n)}`)
  console.log(`  paid out to hidden cards       ${usd(hidden)}`)
  console.log(`  withdrawn for distribution     ${usd(withdrawn)}`)
  console.log(`  unique buyers                  ${list.length}\n`)
  console.log(`  PackSale float                 ${usd(float)}`)
  console.log(`  reserved for open packs        ${usd(liability)}`)
  console.log(
    `  headroom                       ${free <= 0n ? 'NONE — buys revert until funded' : `${free / 30_000_000n} more $10 packs sellable now`}\n`,
  )
} else if (cmd === 'buyers') {
  const list = await buyers()
  if (!list.length) console.log('\n  no packs bought yet\n')
  for (const [addr, amt] of list) {
    console.log(`  ${addr}   ${usd(amt * 5n)} spent on packs`)
  }
  console.log()
} else if (cmd === 'withdraw') {
  const to = process.argv[3]
  const amount = process.argv[4]
  if (!to || !amount) throw new Error('usage: node scripts/round.mjs withdraw <to> <usdAmount>')

  const pk = readFileSync('contracts/.env', 'utf8').match(/PRIVATE_KEY=(0x[0-9a-fA-F]{64})/)?.[1]
  if (!pk) throw new Error('no PRIVATE_KEY in contracts/.env')
  const wallet = createWalletClient({ account: privateKeyToAccount(pk), chain, transport: http() })

  const value = parseUnits(amount, 6)
  const hash = await wallet.writeContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: 'withdraw',
    args: [to, value],
  })
  await pub.waitForTransactionReceipt({ hash })
  console.log(`sent ${usd(value)} to ${to}`)
  console.log(`${chain.blockExplorers.default.url}/tx/${hash}`)
}
