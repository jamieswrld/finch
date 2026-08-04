// Jackpot round tool: inspect who holds tickets, then close the round when ready.
//   node scripts/round.mjs status          # ticket holders + pot + solvency snapshot
//   node scripts/round.mjs close           # freeze the pot for pro-rata claims (owner only)
//   node scripts/round.mjs claims          # what each holder can claim from closed rounds
//
// Reads the owner key from contracts/.env. Read-only unless you pass `close`.

import { readFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, defineChain, formatUnits, http, parseAbi, parseAbiItem } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const SALE = '0x70c79a6c80073e88812b1fe9D13147e79468818E'
const VAULT = '0xcad9224b9D9Ed6Bbf40eA7C9D8480FbAFE723873'
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
  'function currentRound() view returns (uint256)',
  'function available() view returns (uint256)',
  'function reserved() view returns (uint256)',
  'function tickets(uint256,address) view returns (uint256)',
  'function claimable(uint256,address) view returns (uint256)',
  'function rounds(uint256) view returns (bool closed, uint256 snapshot, uint256 totalTickets)',
  'function closeRound()',
])

async function holders(round) {
  const logs = await pub.getLogs({
    address: VAULT,
    event: parseAbiItem('event TicketsAdded(uint256 indexed round, address indexed user, uint256 amount)'),
    args: { round },
    fromBlock: 0n,
    toBlock: 'latest',
  })
  const totals = new Map()
  for (const l of logs) {
    const u = l.args.user
    totals.set(u, (totals.get(u) ?? 0n) + l.args.amount)
  }
  return [...totals.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1))
}

const cmd = process.argv[2] ?? 'status'
const round = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'currentRound' })

if (cmd === 'status') {
  const [pot, float, liability] = await Promise.all([
    pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'available' }),
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
  const list = await holders(round)
  const total = list.reduce((s, [, v]) => s + v, 0n)

  console.log(`\nRound ${round}  |  pot ${usd(pot)}  |  ${list.length} ticket holders`)
  console.log(`PackSale float ${usd(float)}  |  reserved for open packs ${usd(liability)}  |  free ${usd(float - liability)}`)
  console.log(`Headroom: ${liability >= float ? 'NONE — buys will revert' : `${Number((float - liability) / 30_000_000n)} more $10 packs sellable right now`}\n`)
  for (const [addr, amt] of list) {
    const share = total > 0n ? Number((amt * 10000n) / total) / 100 : 0
    console.log(`  ${addr}  ${usd(amt)} spent  ${share.toFixed(2)}% of pot  = ${usd((pot * amt) / (total || 1n))}`)
  }
  if (!list.length) console.log('  (nobody has bought a pack in this round yet)')
  console.log()
} else if (cmd === 'close') {
  const pk = readFileSync('contracts/.env', 'utf8').match(/PRIVATE_KEY=(0x[0-9a-fA-F]{64})/)?.[1]
  if (!pk) throw new Error('no PRIVATE_KEY in contracts/.env')
  const account = privateKeyToAccount(pk)
  const wallet = createWalletClient({ account, chain, transport: http() })

  const list = await holders(round)
  const pot = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'available' })
  console.log(`Closing round ${round}: ${usd(pot)} to ${list.length} holders`)

  const hash = await wallet.writeContract({ address: VAULT, abi: vaultAbi, functionName: 'closeRound' })
  await pub.waitForTransactionReceipt({ hash })
  console.log(`closed: ${chain.blockExplorers.default.url}/tx/${hash}`)
  console.log('Holders can now claim from the site or via claim(roundId).')
} else if (cmd === 'claims') {
  for (let r = 1n; r <= round; r++) {
    const [closed, snapshot] = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'rounds', args: [r] })
    if (!closed) continue
    console.log(`\nRound ${r} (closed, ${usd(snapshot)}):`)
    for (const [addr] of await holders(r)) {
      const c = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: 'claimable', args: [r, addr] })
      console.log(`  ${addr}  ${c > 0n ? `${usd(c)} unclaimed` : 'claimed / nothing'}`)
    }
  }
  console.log()
}
