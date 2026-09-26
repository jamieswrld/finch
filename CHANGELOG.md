# Changelog

Plain record of what changed, what was broken, and what fixed it. Dates are UTC.

## v0.5.0 — 2026-09-26 — Solana

Finch agents now run on Solana, and only on Solana. Support for the previous chain, the contracts written for it, its launchpad integration and its explorer API are removed, along with every setting that pointed at them.

- **Flightpath is rebuilt on `@solana/kit`.** Mainnet-beta by default; `SOLANA_CLUSTER` selects devnet or testnet, and `SOLANA_RPC_URLS` lists provider endpoints tried in order. An intent carries the exact instructions it will run, and the policy engine decodes those instructions (SOL and SPL transfers, approvals, the programs invoked) instead of trusting the intent's summary. Every write is simulated with `simulateTransaction` before anyone signs.
- **Wallets connect through the Wallet Standard**, so any Solana wallet that implements it shows up in the connect list. For a user-signed write the server builds the unsigned transaction, the visitor's wallet signs and sends it, and the server fetches what landed and compares it to what was prepared, instruction by instruction, including the fee payer. Only the compute-budget and Lighthouse assertion instructions wallets add on their own are tolerated. Courier Finch is capped at 0.1 SOL per transfer and 0.5 SOL per day per signer.
- **Publisher keys** are issued for a `solana:signMessage` signature over the same plain message as before; the server checks the ed25519 signature and records the exact base58 address as owner.
- **The registry is memo-anchored.** A finch or nest is registered by a Memo-program transaction signed by `FINCH_REGISTRY_AUTHORITY`: `finch-registry/1 register <kind>:<handle> sha256:<manifest hash> [<uri>]`. The index is read from that address's signature history and a memo counts only if the authority signed it, so anyone can check a listing against Solana alone. With the authority unset, every listing reads as not anchored. `scripts/registry-anchor.mjs` prints the memo and sends it only with `--send`.
- **New tool catalog.** Reads: `network_status`, `block_read`, `chain_stats`, `wallet_profile`, `wallet_transactions`, `wallet_holdings`, `token_profile`, `token_holders`, `token_activity`, `token_list`, `token_price`, `token_markets`, `market_pair`, `swap_quote`, `tx_lookup`, `program_verified`, `balance_native`, `balance_spl`, `token_data`, `portfolio_snapshot`, `account_read`, `finch_token`, `rwa_registry`. Writes (simulated, policy-checked, logged): `transfer_native`, `transfer_spl`, `spl_approve`, `program_invoke`, `swap_exact_in`, `rwa_interact`. Market data comes from Jupiter and DexScreener, program build verification from OtterSec.
- **$FINCH launches on pump.fun**, at mint address `63GtvVxFKgXCcSAXXkrPtp7vk8oWyEfqwwdB8gNYpump`, baked in as the default (`FINCH_TOKEN_MINT` overrides it). Until a mint account exists there, the home page, `GET /api/token` (`launched: false`) and the `finch_token` tool report it as not launched. Once it is live they read supply and authorities from the mint account, the launch phase (bonding curve or graduated to pump.fun's AMM) from pump.fun's bonding-curve account, price and holder count from Jupiter and markets from DexScreener, live; every figure carries its source and a failed read says "unreachable", never 0. Publishing stays open and free, and the token gates nothing.
- **Proof of Flight 0.2** records `chain` (`solana:mainnet`), `signature`, `slot`, `feeLamports` and `computeUnits`.
- The launch-research preset and nest are now Launch Scout and the Launch Intelligence Nest: supply and authorities, holder concentration, markets and liquidity, recent activity for new Solana token launches. Every other preset keeps its slug.
- Scripts: `token-facts.mjs` (any SPL mint, and a pump.fun launch's bonding curve; $FINCH's by default, saying so when it has not launched), `wallet-check.mjs` (derives each configured key's public address and balance, never prints a key), `registry-anchor.mjs`. The pre-commit secret scan recognizes Solana secret keys in base58 and as 64-number arrays.
- Environment variables are renamed throughout; `.env.example` lists the current set.

## v0.4.1 — 2026-09-04 — nobody needs a key to make or run a nest

What people hit, read from the recorded runs and the API:

- **Making a nest failed.** Saving a nest or a finch, and running a nest you composed yourself, returned 401 "requires a publisher key". That gate arrived with v0.4.0's publishing work and was wrong: creating and running are free for everyone. Fixed — no key, wallet, or token is needed to build, save, or run a finch or nest. A key only lets a wallet own and later edit what it publishes; records created without one stay unowned and cannot be overwritten by anyone.
- **The Chain Intelligence nest failed about a third of the time.** Its Block Analyst used its whole tool budget and produced nothing ("halted: max_steps"), which failed the task and the run. Two fixes: every finch now answers from what it already has when it runs out of tool steps, saying plainly what it could not check, instead of going silent; and the Block Analyst is told to make exactly two block reads and then report.
- **Rate limit was too tight for a curious visitor.** The per-address token bucket went from 20 tokens refilling at 0.5/s to 60 refilling at 1.5/s. Runs still cost more than reads.
- **Nest runs are slow on free-tier compute** (two to three minutes, one task at a time). Not a bug: every live provider is a free tier with a per-minute token budget, so the nest runs tasks sequentially and backs off on 429s. Adding a Cerebras or Gemini key (both free tiers, both already supported) lets tasks spread across providers. This is the one item that needs an operator action.
- **Wallet connect needed a wallet in the browser.** On a phone without a wallet browser the connect button had nothing to talk to, and said what it needed rather than failing silently.

Verified before release: typecheck and 69 tests green; a local production build; then on production, an anonymous save no longer answers 401 and a submitted manifest streams a run.

## v0.4.0 — 2026-09-03 — open publishing, self-serve keys, durable allowances

- Publishing is open and free. `PUBLISH_GATE=hold` is the explicit switch for a future $FINCH gate; configuring a token alone changes nothing.
- Any wallet can sign a plain message at `POST /api/keys` and receive a publisher key bound to that address.
- Daily allowances for user-signed spends are kept in MongoDB per signer, so the cap holds across serverless instances; the spend is recorded the moment a submitted transaction is verified on chain.
- Nests whose policy is not read-only accept a signer and surface parked writes on the task, with a signing panel per write.
- Typography: sentence-case mono labels, no letterspaced caps, no italic serif.
- Docs cover publishing, the hive, user-signed execution, and explorer tools.

## v0.3.0 — 2026-09-03 — user-signed execution

- A finch allowed to write plans and simulates the transaction, parks it at `awaiting_signature`, and the visitor's own wallet signs it. `POST /api/executions/{id}/submitted` compares the transaction that landed to the prepared one before anything advances. Confirmed executions get a Proof of Flight.

## v0.2.1 — the hive

- Shared memory every nest teaches and every finch reads, with provenance on every finding.

## v0.2 — publishing, composition, the network's own analysts, honest capacity

- Registry of builtin finches and nests, composition by reference, explorer-backed analysis, provider failover and honest parallelism.
