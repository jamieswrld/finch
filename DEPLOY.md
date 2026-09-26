# Deploying FINCH

## Vercel

The repo is linked to Vercel project **finch** (team `trial-1303b717`).
`vercel.json` at the root drives the monorepo build:

```json
{
  "framework": "nextjs",
  "installCommand": "npm install --no-audit --no-fund",
  "buildCommand": "npm run build -w @finch/web",
  "outputDirectory": "apps/web/.next"
}
```

Deploy commands:

```bash
npx vercel            # preview deploy
npx vercel --prod     # production deploy
```

Once the GitHub repo exists, connect it in the Vercel dashboard
(Project → Settings → Git) for deploy-on-push, then point **finch.fun**
at the project (Project → Settings → Domains).

There is nothing to deploy on chain. Finch runs no custom Solana program: the
registry is memo transactions signed by one address, and $FINCH — a pump.fun
launch — is read at its published mint address like any other SPL mint (and
reported as not launched while no mint account exists there).

## Environment variables (Vercel → Project → Settings → Environment Variables)

Nothing is required to boot — every surface degrades honestly — but for full
functionality add these. Everything is server-side unless it starts with
`NEXT_PUBLIC_`, and no secret ever does.

| Variable | Enables |
| --- | --- |
| `GROQ_API_KEY` (or `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`) | Flight School previews + agent runs on a free tier; `HYPERBOLIC_API_KEY` / `TOGETHER_API_KEY` are paid fallbacks |
| `MONGODB_URI`, `MONGODB_DB` | live registry/nests persistence, durable per-signer allowances (then run `npm run seed -w @finch/db` once) |
| `SOLANA_RPC_URLS` | **production RPC** — comma-separated provider endpoints, tried in order |
| `SOLANA_CLUSTER`, `NEXT_PUBLIC_SOLANA_CLUSTER` | `mainnet-beta` (default), `devnet` or `testnet` — keep the two equal |
| `SOLANA_EXPLORER_URL`, `NEXT_PUBLIC_SOLANA_EXPLORER_URL` | explorer links (default `https://solscan.io`) |
| `JUPITER_API_KEY` | higher Jupiter rate limits for prices, token records and swap quotes (keyless works) |
| `FINCH_TOKEN_MINT` | optional override of $FINCH's baked-in contract address (`63GtvVxFKgXCcSAXXkrPtp7vk8oWyEfqwwdB8gNYpump`) |
| `FINCH_REGISTRY_AUTHORITY` | the address whose signed memos are the registry; unset means every listing reads as not anchored |
| `FINCH_FEE_WALLET_ADDRESS` | fee-wallet address, display only |
| `FINCH_FEE_WALLET_PRIVATE_KEY` | **only when a workflow needs it** — see SECURITY.md; readable solely by `src/server/wallet.ts` |
| `PUBLISH_GATE`, `PUBLISH_COST_FINCH` | publishing gate; `open` (default) keeps publishing free |
| `RWA_APPROVED_ASSETS` | approved RWA registry (JSON; `address` is the SPL mint) |

Never set on the deployment: `FINCH_REGISTRY_AUTHORITY_KEY` (it lives in
`.env.local` for `scripts/registry-anchor.mjs` only) and
`FLIGHTPATH_OPERATOR_KEY` (the operator runtime's, not the web app's).

## RPC

The public mainnet endpoint (`api.mainnet-beta.solana.com`) is baked in as
the fallback so a fresh clone works, but it is rate limited, refuses some
methods and is not meant for production traffic. Production sets
`SOLANA_RPC_URLS` to one or more dedicated provider endpoints; Flightpath
tries them in order, and `/api/chain` reports each endpoint's health with any
credentials in the URL scrubbed. A provider URL usually embeds its API key,
so treat the variable as a secret.

## Registry authority

1. Create a keypair for the authority (`solana-keygen new -o authority.json`,
   or any wallet that exports a secret key) and fund it with a small amount of
   SOL — each anchor costs one network fee (5000 lamports per signature at
   the base rate).
2. Put its address in `FINCH_REGISTRY_AUTHORITY` (Vercel and `.env.local`).
3. Put its secret key in `.env.local` only, as `FINCH_REGISTRY_AUTHORITY_KEY`
   (base58 or the 64-number JSON array). Delete `authority.json` afterwards.
4. `node scripts/wallet-check.mjs` confirms the key derives to that address
   and shows its balance — never the key.
5. Anchor a manifest:

   ```bash
   node scripts/registry-anchor.mjs finch market-scout ./market-scout.finch.json https://…/market-scout.finch.json
   ```

   This prints the memo, the fee payer, the fee quote and a simulation, and
   sends nothing. Add `--send` to sign and submit; it waits until the network
   confirms, fails, or expires the transaction and says which.

## GitHub

When the repo is created:

```bash
git remote add origin git@github.com:<org>/finch.git
git push -u origin main
```

Then update the landing bottom-bar GitHub link in
`apps/web/src/components/landing/World.tsx` (currently marked pending).
