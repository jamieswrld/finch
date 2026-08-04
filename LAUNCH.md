# finch — launch runbook

Live: https://finch-trial-1303b717.vercel.app · repo: github.com/jamieswrld/finch
Every push to `main` auto-deploys to Vercel and the GitHub Pages mirror.

## Live mainnet contracts (Robinhood Chain, id 4663)

| | Address |
|---|---|
| PackSale | `0x9e44cAE4D95D267984167219C832eFcFcb8d5B8F` |
| JackpotVault | `0x9894B6Bc322347ee4D32b3042d89537BbEfD8b7E` |
| Treasury (1% fee) | `0xd589cF06C304e91BEc4432278e9E852914631733` |
| USDG (payment) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| Owner/operator | `0x3F46489093ea0697d36272cBDab8C65f5F14D243` (key in `contracts/.env`) |

Config on-chain: 3 packs ($10 / $25 / $50), 28 Chainlink feeds, 20% jackpot cut,
1% protocol fee.

## THE ONE THING TO DO: fund PackSale

Nothing sells until the sale contract holds USDG. This is enforced on-chain — a pack
cannot be sold unless the treasury already covers the worst-case payout (3x price) on
every unsettled pack.

```
send USDG  ->  0x9e44cAE4D95D267984167219C832eFcFcb8d5B8F
```

| Float | Concurrent $10 packs | Notes |
|---|---|---|
| $100 | 3 | fine for a friends test |
| $300 | 10 | comfortable public launch |
| $1,000 | 33 | crowd |

Float is a *concurrency* limit, not a sales cap — it frees the moment each pack settles
(seconds). Stock tokens sent to the same address are delivered as cards; without them
the contract refunds the card value in USDG instead, so partial inventory is always safe.

Check status any time:

```
node scripts/round.mjs status     # jackpot, volume, packs opened, headroom
node scripts/round.mjs buyers     # every buyer ranked by spend
node scripts/round.mjs withdraw <address> <usd>   # pull the jackpot out to distribute
```

## Adding the token (tomorrow, one line)

Put the address in `src/token.ts` (or set `VITE_TOKEN_ADDRESS` on Vercel):

```ts
export const TOKEN_ADDRESS = '0xYourTokenAddress'
export const TOKEN_SYMBOL = 'FINCH'
```

Push. That lights up the gold **Buy $TOKEN** button in the header and a matching token
panel on the home page, both styled to the existing theme. Both stay hidden until it is
set, so nothing looks broken before launch. Override the swap link with
`VITE_TOKEN_BUY_URL` if you want it pointing somewhere other than Uniswap.

## Infrastructure

- **RPC**: `fallback()` transport — Alchemy first when `VITE_ALCHEMY_KEY` is set, then the
  public RPC, then the sequencer endpoint. Latency-ranked every 30s, 3 retries, automatic
  failover. Multicall batching on. Adding an Alchemy key is the single best reliability
  upgrade if traffic gets heavy: https://alchemy.com -> Robinhood Chain -> paste key into
  Vercel env as `VITE_ALCHEMY_KEY`.
- **Prices**: Chainlink equity feeds, 28 wired. Openings revert rather than settle on a
  stale price.
- **Randomness**: commit-reveal on a future blockhash. `open()` is permissionless so a
  keeper can settle abandoned packs.
- **Data**: stats bar and live feed read contract state and events directly — no simulated
  data anywhere in production.

## Verified end-to-end (against a fork of the live contracts)

- unfunded buy is rejected by the solvency guard
- funded buy: 20% to vault, 1% to treasury, 3x reserved against the pack
- open: real Robinhood AAPL delivered to the buyer at the live Chainlink price
- liability released on settle; jackpot withdrawn for manual distribution
- 21/21 contract tests pass

## Operating notes

- The jackpot is a volume counter: 20% of sales accrue in the vault, the site shows the
  live balance, hidden cards pay out automatically, everything else you distribute by hand
  with `withdraw`.
- Keep an eye on headroom during a busy period; top up the float before it hits zero or
  buys start reverting.
- Withdrawing USDG from PackSale can never break the reserve backing open packs — the
  contract rejects it.
