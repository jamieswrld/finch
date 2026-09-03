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

## Environment variables (Vercel → Project → Settings → Environment Variables)

Nothing is required to boot — every surface degrades honestly — but for full
functionality add, server-side (never `NEXT_PUBLIC_`):

| Variable | Enables |
| --- | --- |
| `HYPERBOLIC_API_KEY` | Flight School previews + agent runs |
| `MONGODB_URI`, `MONGODB_DB` | live registry/nests persistence (then run `npm run seed -w @finch/db` once) |
| `FINCH_FEE_WALLET_ADDRESS` | launch-guard recipient checks |
| `FINCH_FEE_WALLET_PRIVATE_KEY` | **only when launch workflows need signing** — see SECURITY.md; readable solely by `src/server/wallet.ts` |
| `PONS_FACTORY_ADDRESS` | Pons integration + fee indexing (when Pons publishes) |
| `RWA_APPROVED_ASSETS` | approved RWA registry |

Robinhood Chain mainnet params (4663, `rpc.mainnet.chain.robinhood.com`,
Blockscout explorer) are baked into the code; `NEXT_PUBLIC_ROBINHOOD_*` vars
exist only as overrides (e.g. a dedicated RPC provider later).

## GitHub

When the repo is created:

```bash
git remote add origin git@github.com:<org>/finch.git
git push -u origin main
```

Then update the landing bottom-bar GitHub link in
`apps/web/src/components/landing/World.tsx` (currently marked pending).
