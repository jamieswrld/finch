// Build a PONS airdrop epoch: snapshot holders from Blockscout, apply the published
// 95/5 split (top 10 wallets weighted by balance / everyone else pro-rata), and emit
// the merkle tree the PonsAirdrop contract verifies against.
//
//   node scripts/build-airdrop.mjs <ponsToken> <dropAmountBaseUnits> [options]
//
// Options:
//   --exclude 0xabc,0xdef   addresses to drop from the snapshot (LP pools, burn, deployer)
//   --top 0x1,0x2,...       use these wallets as the 95% side instead of top-10-by-balance
//                           (still weighted by their PONS balance; must also be published)
//   --explorer <url>        Blockscout base URL (default: Robinhood Chain mainnet)
//   --out <file>            output path (default: airdrops/epoch-<timestamp>.json)
//
// Publish the output JSON alongside the epoch so every holder can verify their leaf.

import { mkdirSync, writeFileSync } from 'node:fs'
import { encodePacked, keccak256 } from 'viem'

const TOP_SHARE_BPS = 9_500n
const TOP_COUNT = 10
const BPS = 10_000n

const [token, dropAmountArg, ...rest] = process.argv.slice(2)
if (!token || !dropAmountArg) {
  console.error('usage: node scripts/build-airdrop.mjs <ponsToken> <dropAmountBaseUnits> [--exclude ..] [--top ..]')
  process.exit(1)
}
const dropAmount = BigInt(dropAmountArg)

const opt = (name, fallback) => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 ? rest[i + 1] : fallback
}
const explorer = opt('explorer', 'https://robinhoodchain.blockscout.com')
const exclude = new Set(
  (opt('exclude', '') || '').split(',').filter(Boolean).map((a) => a.toLowerCase()),
)
const topOverride = (opt('top', '') || '').split(',').filter(Boolean).map((a) => a.toLowerCase())

// ---- snapshot ----

async function fetchHolders() {
  const holders = []
  let params = ''
  for (;;) {
    const res = await fetch(`${explorer}/api/v2/tokens/${token}/holders${params}`)
    if (!res.ok) throw new Error(`Blockscout ${res.status}: ${await res.text()}`)
    const body = await res.json()
    for (const item of body.items ?? []) {
      const addr = item.address?.hash?.toLowerCase()
      const bal = BigInt(item.value ?? '0')
      if (addr && bal > 0n && !exclude.has(addr)) holders.push({ addr, bal })
    }
    if (!body.next_page_params) break
    params = '?' + new URLSearchParams(body.next_page_params).toString()
  }
  return holders.sort((a, b) => (b.bal > a.bal ? 1 : b.bal < a.bal ? -1 : 0))
}

// ---- split ----

function allocate(holders) {
  const top = topOverride.length
    ? holders.filter((h) => topOverride.includes(h.addr))
    : holders.slice(0, TOP_COUNT)
  const topSet = new Set(top.map((h) => h.addr))
  const others = holders.filter((h) => !topSet.has(h.addr))

  const topPool = others.length ? (dropAmount * TOP_SHARE_BPS) / BPS : dropAmount
  const otherPool = dropAmount - topPool

  const weigh = (group, pool) => {
    const totalBal = group.reduce((s, h) => s + h.bal, 0n)
    if (totalBal === 0n) return []
    return group.map((h) => ({ addr: h.addr, amount: (pool * h.bal) / totalBal }))
  }

  const claims = [...weigh(top, topPool), ...weigh(others, otherPool)].filter((c) => c.amount > 0n)
  // hand rounding dust to the largest allocation so escrow === sum of leaves
  const dust = dropAmount - claims.reduce((s, c) => s + c.amount, 0n)
  claims.sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
  if (claims.length) claims[0].amount += dust
  return claims
}

// ---- merkle (sorted pairs, matches PonsAirdrop._verify) ----

const leafOf = (c) => keccak256(encodePacked(['address', 'uint256'], [c.addr, c.amount]))
const pair = (a, b) => (BigInt(a) <= BigInt(b) ? keccak256(a + b.slice(2)) : keccak256(b + a.slice(2)))

function buildTree(leaves) {
  const layers = [leaves]
  while (layers.at(-1).length > 1) {
    const prev = layers.at(-1)
    const next = []
    for (let i = 0; i < prev.length; i += 2) {
      next.push(i + 1 < prev.length ? pair(prev[i], prev[i + 1]) : prev[i])
    }
    layers.push(next)
  }
  return layers
}

function proofFor(layers, index) {
  const proof = []
  let i = index
  for (const layer of layers.slice(0, -1)) {
    const sibling = i ^ 1
    if (sibling < layer.length) proof.push(layer[sibling])
    i >>= 1
  }
  return proof
}

// ---- main ----

const holders = await fetchHolders()
console.log(`snapshot: ${holders.length} holders`)
const claims = allocate(holders)
const leaves = claims.map(leafOf)
const layers = buildTree(leaves)
const root = layers.at(-1)[0]

const out = {
  token,
  root,
  total: dropAmount.toString(),
  topShareBps: Number(TOP_SHARE_BPS),
  topWallets: (topOverride.length ? topOverride : holders.slice(0, TOP_COUNT).map((h) => h.addr)),
  claims: Object.fromEntries(
    claims.map((c, i) => [c.addr, { amount: c.amount.toString(), proof: proofFor(layers, i) }]),
  ),
}

const outPath = opt('out', `airdrops/epoch-${Date.now()}.json`)
mkdirSync('airdrops', { recursive: true })
writeFileSync(outPath, JSON.stringify(out, null, 2))
console.log(`root:  ${root}`)
console.log(`wrote: ${outPath}`)
console.log(`next:  approve the distributor for ${dropAmount} of the drop token, then createEpoch(token, root, total)`)
