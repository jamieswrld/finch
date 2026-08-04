# finch — launch readiness report

**Status: LIVE AND SELLING.** Real packs have been bought and opened on mainnet with real
money, and a real Microsoft stock token was delivered to a buyer's wallet.

Site: https://finch-trial-1303b717.vercel.app
Repo: https://github.com/jamieswrld/finch (push to `main` auto-deploys)

---

## 1. What is live right now

| Thing | Address / value |
|---|---|
| PackSale | `0x9e44cAE4D95D267984167219C832eFcFcb8d5B8F` |
| JackpotVault | `0x9894B6Bc322347ee4D32b3042d89537BbEfD8b7E` |
| Treasury (gets the 1% fee) | `0xd589cF06C304e91BEc4432278e9E852914631733` |
| Operator wallet (owns contracts) | `0x3F46489093ea0697d36272cBDab8C65f5F14D243` |
| USDG (payment token) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| Chain | Robinhood Chain, id 4663 |

**Funded and stocked:**

- PackSale USDG float: **$205.23** → 6 concurrent $10 packs
- Inventory: **0.160 NVDA** (~$33) and **0.053 MSFT** (~$26)
- Jackpot vault: **$4.00** (from the two test purchases)
- Operator wallet: **0.685 ETH** left for gas
- Packs: $10 Starter, $25 Blue Chip, $50 AI — all live
- 28 Chainlink price feeds wired, every one verified returning a live price

---

## 2. Tests run — everything passed

### Live mainnet, real money

| Test | Result |
|---|---|
| Buy $10 pack | PASS — [tx](https://robinhoodchain.blockscout.com/tx/0xf48268ee938acf2cfaa2d1539377420150e63f0d9ce89a1b0a732e5ae116ca75) |
| 20% to jackpot vault | PASS — vault went $0 → $4 across two buys |
| 1% fee to treasury | PASS — $0.10 per $10 pack |
| Solvency reserve locks on buy | PASS — $30 reserved, released on settle |
| Open pack → USDG refund path | PASS — buyer paid $10, received $15 (Epic card, no inventory yet) |
| Open pack → **real stock delivered** | PASS — **0.0145 MSFT** (~$7.15) sent to buyer, [tx](https://robinhoodchain.blockscout.com/tx/0xeb21f059441bac3f5377feff827eae873c29fd3d5a1cdb4df4fb939ae852a38b) |
| ETH → USDG swap (Uniswap v4) | PASS — 0.11 ETH → 204 USDG |
| Stock inventory purchase | PASS — NVDA + MSFT bought and delivered to PackSale |

### Forked mainnet (safe rehearsal before spending real funds)

| Test | Result |
|---|---|
| Buy blocked when contract underfunded | PASS — reverts with `InsufficientReserves` |
| 5 independent buyers, back to back | PASS — all settled, accounting exact |
| Owner withdraw for manual distribution | PASS — pot out, lifetime volume preserved |
| Withdraw cannot break the open-pack reserve | PASS — reverts |

### Contract test suite

**21/21 passing** (`cd contracts && forge test`) — covers rarity rolls, hidden cards,
refund path, stale price rejection, blockhash re-arm, reserve accounting, fee split.

---

## 3. Bug found and fixed tonight

**The live site was silently running in demo mode.** Vercel stored the contract addresses
with a trailing newline, which failed a strict length check, so the app fell back to fake
data — it showed a fictional $12,430 jackpot and would never have taken a real payment.
Nobody would have noticed until a user "bought" a pack and nothing happened on chain.

Fixed at the root: addresses are now trimmed and regex-validated, so no amount of stray
whitespace can ever cause it again. Verified live — the site now reads the real $4.00
jackpot and real purchase count.

---

## 4. What a user experiences tomorrow

1. Opens the site, connects any EVM wallet.
2. If they are on the wrong network, a banner offers one-click switch to Robinhood Chain.
3. Picks a pack. Before their wallet even opens, the app checks their USDG balance and the
   contract's capacity, and explains in plain language if either is short.
4. Approves USDG, buys, and watches the opening cinema (charge → rip → card reveal with
   rarity-scaled effects).
5. Receives a real tokenized stock in their wallet, or a USDG refund of the card's value
   if inventory can't cover it. Either way they get value; nothing is ever taken with
   nothing delivered.
6. Clicking their address opens a wallet drawer with their pull history and hidden-card wins.

Everything on the page is real on-chain data — jackpot, packs opened, volume, and the live
feed of openings with links to each transaction on Blockscout. No simulated data anywhere.

---

## 5. Adding your token tomorrow — 30 seconds

Put the address in `src/token.ts`:

```ts
export const TOKEN_ADDRESS = '0xYourTokenAddress'
export const TOKEN_SYMBOL = 'FINCH'
```

Commit and push. That lights up a gold **Buy $TOKEN** button in the header and a matching
token panel on the home page, already styled to the theme. Both stay hidden until set, so
nothing looks unfinished before then. Override the swap destination with
`VITE_TOKEN_BUY_URL` if you don't want the default Uniswap link.

---

## 6. Things to know / watch

**Capacity.** Each open pack reserves 3× its price in USDG (the largest possible card).
$205 = 6 concurrent $10 packs. That is a *concurrency* limit, not a sales cap — the reserve
frees within seconds of each open, so sequential volume is unlimited. If a crowd shows up
and buys simultaneously, some will see "temporarily sold out" until packs settle. Top up
the float to raise the ceiling: roughly $30 of float per concurrent $10 pack.

**Inventory is thin and deliberately so.** Only NVDA and MSFT are stocked. The contract
scans for any stock it can cover, so most pulls will deliver one of those two; the rest
refund in USDG. Add more inventory whenever you like by sending stock tokens to PackSale.

**Two Uniswap pools are dangerously mispriced.** The ETH/SPY pool quotes SPY around $3,875
against a real price near $650, and ETH/AMZN is worse. I avoided both. **Do not buy
inventory through those pools** — check the quote against the real share price first. The
USDG-paired pools are healthy; the ERC-20 swap path through the Universal Router reverted
in testing, so buy stock inventory through a DEX front-end where you can see price impact,
then send the tokens to PackSale.

**Price feeds pause.** Chainlink equity feeds run 24/5 and pause during corporate actions.
Openings revert rather than settle on a stale price — expect this on weekends. Users see
"Price feed is paused right now," and their pack stays valid until they retry.

**Unopened packs.** `open()` is callable by anyone, so if a buyer abandons a pack after
paying, you (or a keeper) can settle it for them — the card always goes to the buyer.

---

## 7. Your operating commands

```
node scripts/round.mjs status     # jackpot, volume, packs opened, capacity
node scripts/round.mjs buyers     # every buyer ranked by spend
node scripts/round.mjs withdraw <address> <usd>    # take jackpot out to distribute
```

Jackpot distribution is fully manual, as you asked — 20% of sales accrues in the vault, the
site displays the live balance, hidden cards pay out automatically, and everything else you
move by hand with `withdraw`.

---

## 8. Suggested pre-launch checks (5 minutes)

1. Open the site on your phone and buy one $10 pack with a wallet that isn't the operator —
   this is the exact path a stranger takes.
2. Confirm the card lands in that wallet and the live feed shows the opening.
3. Run `node scripts/round.mjs status` and confirm the numbers moved.
4. Consider topping the float to ~$500 if you expect a crowd (6 concurrent packs is modest).
5. Add a custom domain in Vercel if you want something better than the `.vercel.app` URL.
