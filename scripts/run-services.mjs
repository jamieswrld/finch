// Supervisor for the hosted services: the keeper (settles packs so buyers sign
// once) and the treasury watcher (keeps the float topped up from vault surplus).
// Either crashing is restarted; if one dies repeatedly the process exits so the
// host restarts everything cleanly.
//
//   node scripts/run-services.mjs
//
// Env:
//   KEEPER_KEY    low-privilege wallet, only ever calls open()
//   TREASURY_KEY  vault owner, only used to move vault -> float
//   FLOAT_TARGET  USD float to maintain (default 300)

import { spawn } from 'node:child_process'

const target = process.env.FLOAT_TARGET ?? '300'

const services = [
  { name: 'keeper', args: ['scripts/keeper.mjs'], enabled: !!process.env.KEEPER_KEY },
  {
    name: 'treasury',
    args: ['scripts/treasury.mjs', 'watch', target],
    enabled: !!process.env.TREASURY_KEY,
  },
]

for (const s of services) {
  if (!s.enabled) {
    console.log(`[${s.name}] skipped — no key configured`)
    continue
  }
  let restarts = 0

  const start = () => {
    const child = spawn(process.execPath, s.args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const tag = (line) => `[${s.name}] ${line}`
    child.stdout.on('data', (d) => String(d).trimEnd().split('\n').forEach((l) => console.log(tag(l))))
    child.stderr.on('data', (d) => String(d).trimEnd().split('\n').forEach((l) => console.log(tag(l))))
    child.on('exit', (code) => {
      restarts += 1
      console.log(tag(`exited (${code}); restart #${restarts}`))
      if (restarts > 20) {
        console.log(tag('too many restarts — exiting so the host can recycle'))
        process.exit(1)
      }
      setTimeout(start, 5_000)
    })
  }

  start()
}
