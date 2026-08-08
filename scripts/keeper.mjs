// finch keeper — settles packs so buyers only ever sign once.
//
//   node scripts/keeper.mjs
//
// open() is permissionless and the card always goes to the buyer, so this can run
// anywhere. It watches for Purchased events and settles each one as soon as the
// commit block is behind us. Reads the key from contracts/.env.

import { readFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseAbiItem } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const SALE = process.env.PACK_SALE ?? '0x933C7F2F72e8FD5b57afB7a9Ee1ad36Fc5a6D45c'

/** KEEPER_KEY in hosted environments; falls back to the local env file for dev.
 *  This wallet needs nothing but gas — open() is permissionless and always pays
 *  the buyer, so a compromised keeper can only settle packs on time. */
function loadKey() {
  if (process.env.KEEPER_KEY) return process.env.KEEPER_KEY.trim()
  try {
    return readFileSync('contracts/.env', 'utf8').match(/PRIVATE_KEY=(0x[0-9a-fA-F]{64})/)?.[1]
  } catch {
    return undefined
  }
}

const chain = defineChain({
  id: 56,
  name: 'BNB Chain',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls: { default: { http: ['https://bsc-rpc.publicnode.com'] } },
  blockExplorers: { default: { name: 'BscScan', url: 'https://bscscan.com' } },
})

const pub = createPublicClient({ chain, transport: http() })
const pk = loadKey()
if (!pk) throw new Error('set KEEPER_KEY (or PRIVATE_KEY in contracts/.env)')
const account = privateKeyToAccount(pk)
const wallet = createWalletClient({ account, chain, transport: http() })

const saleAbi = parseAbi([
  'function open(uint256 purchaseId)',
  'function purchaseCount() view returns (uint256)',
  'function purchases(uint256) view returns (address buyer, uint64 packId, bool settled)',
  'function randomness() view returns (address)',
])

const rngAbi = parseAbi([
  'function isReadyFor(address caller, uint256 requestId) view returns (bool)',
])

/** Randomness module address, read from the core so a module swap needs no redeploy. */
let RNG = null
async function rngAddress() {
  if (!RNG) RNG = await pub.readContract({ address: SALE, abi: saleAbi, functionName: 'randomness' })
  return RNG
}

const PURCHASED = parseAbiItem(
  'event Purchased(uint256 indexed purchaseId, address indexed buyer, uint256 indexed packId)',
)

const pending = new Set()

async function settle(id) {
  try {
    const p = await pub.readContract({ address: SALE, abi: saleAbi, functionName: 'purchases', args: [id] })
    if (p[2]) {
      pending.delete(id)
      return
    }
    // block.number tracks L1 here (~12s), so readiness lags the L2 block rate
    const ready = await pub.readContract({
      address: await rngAddress(),
      abi: rngAbi,
      functionName: 'isReadyFor',
      args: [SALE, id],
    })
    if (!ready) return

    const hash = await wallet.writeContract({ address: SALE, abi: saleAbi, functionName: 'open', args: [id] })
    await pub.waitForTransactionReceipt({ hash })
    const after = await pub.readContract({ address: SALE, abi: saleAbi, functionName: 'purchases', args: [id] })
    if (after[2]) {
      pending.delete(id)
      console.log(`settled #${id} for ${p[0]}  ${chain.blockExplorers.default.url}/tx/${hash}`)
    } else {
      console.log(`#${id} re-armed, will retry`)
    }
  } catch (e) {
    // pool hiccup, price feed pause, or a race with another settler — retry next tick
    console.log(`#${id} retry: ${String(e.message ?? e).split('\n')[0].slice(0, 100)}`)
  }
}

// pick up anything already outstanding
const count = await pub.readContract({ address: SALE, abi: saleAbi, functionName: 'purchaseCount' })
for (let i = 0n; i < count; i++) {
  const p = await pub.readContract({ address: SALE, abi: saleAbi, functionName: 'purchases', args: [i] })
  if (!p[2]) pending.add(i)
}
console.log(`keeper up on ${SALE}`)
console.log(`settler ${account.address}`)
console.log(`${pending.size} unsettled pack(s) outstanding`)

pub.watchEvent({
  address: SALE,
  event: PURCHASED,
  onLogs: (logs) => {
    for (const l of logs) {
      pending.add(l.args.purchaseId)
      console.log(`saw purchase #${l.args.purchaseId} from ${l.args.buyer}`)
    }
  },
  onError: () => {},
})

setInterval(() => {
  for (const id of pending) settle(id)
}, 2000)
