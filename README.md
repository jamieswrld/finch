# finch

Open a pack, pull a real tokenized stock straight to your wallet on Robinhood Chain.
Heavenly all-white UI; stock-terminal reveal cards; transparent on-chain mechanics
(in-app docs at `#/docs`).

## Run it

```
npm install
npm run dev
```

Current state: full frontend with wallet connect (any injected EVM wallet, Robinhood Chain
mainnet + testnet configured) **plus the on-chain layer in [contracts/](contracts/)**
(Foundry: `PackSale` + `JackpotVault`, 10 passing tests, deploy scripts). The site runs in
demo mode until you deploy and put the addresses in `.env` (see [.env.example](.env.example)) —
then Buy & Open goes through the real contracts: approve USDG → `buyPack` → `open`,
with the reveal parsed from on-chain events and the jackpot read live from the vault.

## Deploy (testnet, fully playable with mocks)

```sh
cd contracts
$env:PRIVATE_KEY = "0x..."   # funded from https://faucet.testnet.chain.robinhood.com
forge script script/DeployTestnet.s.sol --rpc-url https://rpc.testnet.chain.robinhood.com --broadcast
```

Copy the printed PackSale/Vault/USDG addresses into `.env` as
`VITE_PACK_SALE_ADDRESS` / `VITE_VAULT_ADDRESS` / `VITE_USDG_ADDRESS`, restart `npm run dev`,
add chain 46630 to your wallet, and open packs for real. Mainnet:
`script/DeployMainnet.s.sol` (real USDG + stock addresses baked in; set Chainlink feeds
and transfer stock inventory to the PackSale address after deploy).

## Contract design

- **PackSale** — sells packs for USDG. 20% of every sale → vault (+ jackpot tickets),
  80% stays as treasury. Commit-reveal randomness on a future blockhash: `buyPack` commits,
  `open` (permissionless, ≥1 block later) settles — hidden card (1%, pays a luck-weighted
  0.5–25% of the open pot instantly), or a rarity-weighted card value
  (0.7×/1×/1.5×/3× at 78/15/5/2%) converted to stock via the Chainlink USD feed and paid
  from the contract's inventory; USDG refund if inventory can't cover it. Blockhash
  re-arms after 256 blocks; keeper bots can settle abandoned packs so nobody re-roll grinds.
- **JackpotVault** — round-based. Tickets = USDG spent. After the payout date,
  `closeRound` freezes the pot and holders claim pro-rata; hidden cards pay from the
  open pot only, never from frozen claims. Swap blockhash RNG for VRF when it lands on
  Robinhood Chain.

## Robinhood Chain facts (verified Aug 2026)

| Item | Value |
|---|---|
| Mainnet chain ID | 4663 (testnet: 46630) |
| RPC | `https://rpc.mainnet.chain.robinhood.com` (testnet: `rpc.testnet.chain.robinhood.com`) |
| Gas currency | ETH |
| Explorer | https://robinhoodchain.blockscout.com |
| Docs | https://docs.robinhood.com/chain |
| USDG (Paxos Global Dollar) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| Testnet faucet | https://faucet.testnet.chain.robinhood.com |

Real Robinhood Stock Token addresses (AAPL, NVDA, TSLA, MSFT, AMZN, GOOGL, META, AMD,
PLTR, COIN, MSTR, NFLX, GME, SPCX, SPY, QQQ) are wired into [src/data.ts](src/data.ts) —
verified against the on-chain registry (canonical list: docs.robinhood.com/chain/contracts).
No HOOD stock token exists on the chain yet.

### Uniswap v4 on Robinhood Chain (for the pack contract's settlement swap)

- PoolManager: `0x8366a39cc670b4001a1121b8f6a443a643e40951`
- Universal Router: `0x8876789976decbfcbbbe364623c63652db8c0904` (⚠ fake look-alike routers reported on this chain — always re-verify against developers.uniswap.org/contracts/v4/deployments)
- Quoter: `0x8dc178efb8111bb0973dd9d722ebeff267c98f94`
- Permit2: `0x000000000022D473030F116dDEE9F6B43aC78BA3`

Chainlink runs per-stock price feeds (24/5, paused during corporate actions —
`oraclePaused()`), feed registry: docs.chain.link/data-feeds → Robinhood Chain.

### Stock token mechanics that shape our contract design

- Standard ERC-20s (18 decimals), **freely transferable** — restriction is a Robinhood
  blocklist + pause + `adminBurn`, NOT a KYC allowlist. A pack contract that buys via
  Uniswap v4 and forwards tokens to buyers works on-chain.
- Tokens are upgradeable beacon proxies controlled by Robinhood — design the pack
  contract to survive a token being paused mid-flow (refund path).
- Legal note: Robinhood does not offer stock tokens to U.S./U.K. persons (distribution
  restriction, not enforced on-chain). A pack product with jackpot mechanics layers
  lottery/securities questions on top — get real legal advice before mainnet.

## Architecture

- [src/chain.ts](src/chain.ts) — Robinhood Chain definitions + wagmi config
- [src/data.ts](src/data.ts) — packs, stock tokens, jackpot config (payout date, cut, hidden-card odds)
- [src/rng.ts](src/rng.ts) — pull logic: rarity tiers, hidden jackpot card (% of vault, luck-weighted)
- [src/components/](src/components/) — ConnectButton, PackCard (CSS foil pack), OpenPackModal (confirm → rip → reveal), LiveFeed, Countdown

## Next steps to go live

1. Deploy to testnet (command above) and playtest end-to-end.
2. Get Chainlink feed addresses for each pool stock from
   docs.chain.link/data-feeds → Robinhood Chain, call `setFeed()` for each.
3. Buy stock-token inventory (Uniswap v4 is live on the chain) and transfer it to the
   PackSale address; keep the treasury topped up.
4. Run a keeper (cron + `cast send ... "open(uint256)"`) to settle unopened packs.
5. Robinhood is backing builders with $1M via Arbitrum Open House 2026 (buildathons +
   founder houses, reserved Robinhood Chain prize slots) — worth entering.
