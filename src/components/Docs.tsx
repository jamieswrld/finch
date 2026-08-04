import { robinhoodChain } from '../chain'
import { HIDDEN_CARD_CHANCE, JACKPOT_CUT, RARITY_TIERS, STOCKS, USDG_ADDRESS, asset } from '../data'
import { PACK_SALE_ADDRESS, VAULT_ADDRESS, isOnchainEnabled } from '../onchain'

const explorer = robinhoodChain.blockExplorers.default.url

function AddrLink({ address }: { address: string }) {
  return (
    <a className="mono doc-addr" href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer">
      {address}
    </a>
  )
}

const LUCK_TIERS = [
  { odds: '70%', range: '0.5% – 2%' },
  { odds: '25%', range: '2% – 5%' },
  { odds: '4.5%', range: '5% – 10%' },
  { odds: '0.5%', range: '10% – 25%' },
]

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'network', label: 'Network' },
  { id: 'contracts', label: 'Our contracts' },
  { id: 'stocks', label: 'Stock tokens' },
  { id: 'money', label: 'Where money goes' },
  { id: 'odds', label: 'Card odds' },
  { id: 'randomness', label: 'Randomness' },
  { id: 'rounds', label: 'Jackpot rounds' },
  { id: 'pons', label: '$PONS airdrops' },
  { id: 'edge-cases', label: 'Edge cases' },
]

/** Standalone docs screen — own header + sidebar, separate from the app shell. */
export function DocsPage() {
  const jump = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="docs-shell">
      <header className="docs-header">
        <div className="docs-header-brand">
          <a className="wordmark" href="#/">
            <img className="brand-mark" src={asset('/brand/mark.webp')} alt="" />
            finch<span className="wordmark-accent">.</span>
          </a>
          <span className="docs-header-label">docs</span>
        </div>
        <a className="btn btn-ghost" href="#/">
          ← Back to app
        </a>
      </header>
      <div className="docs-layout">
        <aside className="docs-side">
          <nav>
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} onClick={(e) => jump(e, s.id)}>
                {s.label}
              </a>
            ))}
          </nav>
        </aside>
        <Docs />
      </div>
    </div>
  )
}

export function Docs() {
  const deployed = isOnchainEnabled()

  return (
    <div className="docs">
      <h1>Docs</h1>
      <p className="muted docs-lead">
        Everything finch does on-chain, in one place. Every contract, every parameter, every odds
        table below is the source of truth the app runs on — verify all of it yourself on
        Blockscout.
      </p>

      <section className="doc-section" id="overview">
        <h2>What this is</h2>
        <p>
          finch sells packs paid in USDG on {robinhoodChain.name}. Opening a pack gives you a
          randomized card: usually a real tokenized stock (an official Robinhood Stock Token,
          delivered to your wallet), occasionally a hidden card that pays a percentage of the
          jackpot vault in USDG instantly. {Math.round(JACKPOT_CUT * 100)}% of every pack purchase
          flows into the jackpot vault, and the vault pot is distributed pro-rata to buyers at the
          end of each round.
        </p>
      </section>

      <section className="doc-section" id="network">
        <h2>Network</h2>
        <table className="doc-table">
          <tbody>
            <tr>
              <td>Chain</td>
              <td>
                {robinhoodChain.name} — chain ID {robinhoodChain.id} (Arbitrum Orbit L2, gas in ETH)
              </td>
            </tr>
            <tr>
              <td>RPC</td>
              <td className="mono">{robinhoodChain.rpcUrls.default.http[0]}</td>
            </tr>
            <tr>
              <td>Explorer</td>
              <td>
                <a href={explorer} target="_blank" rel="noreferrer">
                  {explorer}
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="doc-section" id="contracts">
        <h2>Our contracts</h2>
        {!deployed && (
          <p className="muted small">
            Deploying to testnet now — addresses appear here the moment they're live.
          </p>
        )}
        <table className="doc-table">
          <tbody>
            <tr>
              <td>PackSale</td>
              <td>{deployed ? <AddrLink address={PACK_SALE_ADDRESS} /> : <em>pending deployment</em>}</td>
            </tr>
            <tr>
              <td>JackpotVault</td>
              <td>{deployed ? <AddrLink address={VAULT_ADDRESS} /> : <em>pending deployment</em>}</td>
            </tr>
            <tr>
              <td>USDG (payment token, Paxos)</td>
              <td>
                <AddrLink address={USDG_ADDRESS} />
              </td>
            </tr>
          </tbody>
        </table>
        <p className="muted small">
          Contract source lives in the public repo under <span className="mono">contracts/</span> and
          is verified on Blockscout at deployment.
        </p>
      </section>

      <section className="doc-section" id="stocks">
        <h2>Stock tokens we deliver</h2>
        <p>
          Only official Robinhood Stock Tokens, checked against the canonical registry at{' '}
          <a href="https://docs.robinhood.com/chain/contracts" target="_blank" rel="noreferrer">
            docs.robinhood.com/chain/contracts
          </a>
          . A token with a matching ticker but a different address is not a Robinhood Stock Token.
        </p>
        <table className="doc-table">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Name</th>
              <th>Contract</th>
            </tr>
          </thead>
          <tbody>
            {STOCKS.map((s) => (
              <tr key={s.ticker}>
                <td>
                  <strong>{s.ticker}</strong>
                </td>
                <td>{s.name}</td>
                <td>
                  <AddrLink address={s.address} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="doc-section" id="money">
        <h2>Where your money goes</h2>
        <p>
          Every pack purchase is split in the same transaction, enforced by the PackSale contract —
          not by us keeping promises:
        </p>
        <table className="doc-table">
          <tbody>
            <tr>
              <td>{Math.round((1 - JACKPOT_CUT) * 100)}%</td>
              <td>
                PackSale treasury — backs the stock inventory the contract holds and pays your card
              </td>
            </tr>
            <tr>
              <td>{Math.round(JACKPOT_CUT * 100)}%</td>
              <td>JackpotVault — the shared pot, paid back out to players (hidden cards + round payouts)</td>
            </tr>
          </tbody>
        </table>
        <p>
          Cards average about 80% of pack price in stock value — the odds table below is exact, and
          the same table is hardcoded in the contract.
        </p>
      </section>

      <section className="doc-section" id="odds">
        <h2>Card odds</h2>
        <p>
          First, a {HIDDEN_CARD_CHANCE * 100}% roll decides if the card is a hidden jackpot card.
          Otherwise rarity decides the card's value as a multiple of pack price, and the stock is
          drawn from the pack's pool:
        </p>
        <table className="doc-table">
          <thead>
            <tr>
              <th>Rarity</th>
              <th>Odds</th>
              <th>Card value</th>
            </tr>
          </thead>
          <tbody>
            {RARITY_TIERS.map((t) => (
              <tr key={t.key}>
                <td style={{ color: t.color, fontWeight: 700 }}>{t.label}</td>
                <td>{(t.weight * 100).toFixed(0)}%</td>
                <td>{t.multiplier}× pack price</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Hidden card payout</h3>
        <p>
          A hidden card pays a percentage of the vault's open pot, instantly, in USDG. The
          percentage is its own luck roll:
        </p>
        <table className="doc-table">
          <thead>
            <tr>
              <th>Odds</th>
              <th>Share of the vault</th>
            </tr>
          </thead>
          <tbody>
            {LUCK_TIERS.map((t) => (
              <tr key={t.range}>
                <td>{t.odds}</td>
                <td>{t.range}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="doc-section" id="randomness">
        <h2>Randomness</h2>
        <p>
          Commit-reveal on a future blockhash. Buying a pack commits to the hash of the purchase
          block; opening happens in a later transaction and derives the card from that hash — so the
          outcome is fixed before anyone (including us) can see it, and nobody can pick their card.
          If a pack sits unopened past the 256-block window it re-arms on a fresh block, and{' '}
          <span className="mono">open()</span> is callable by anyone, so our keeper settles abandoned
          packs — waiting doesn't let you re-roll. We'll move to Chainlink VRF when it's available on{' '}
          {robinhoodChain.name}.
        </p>
      </section>

      <section className="doc-section" id="rounds">
        <h2>Jackpot rounds</h2>
        <p>
          Every USDG you spend on packs adds the same amount of tickets for the current round. When
          the round's payout date passes, the open pot is frozen and every ticket holder claims
          their pro-rata share directly from the vault contract — hidden cards can only ever pay
          from the open pot, never from frozen claims. Unclaimed shares stay locked in the vault;
          the contract has no operator withdrawal.
        </p>
      </section>

      <section className="doc-section" id="pons">
        <h2>$PONS airdrops</h2>
        <p>
          PONS is the finch memecoin on {robinhoodChain.name}. Creator fees from the PONS launch
          are recycled into RWA airdrops — stock tokens or USDG — distributed in epochs through
          the PonsAirdrop contract. The split is fixed in the contract (
          <span className="mono">TOP_SHARE_BPS = 9500</span>) and is deliberately top-heavy:
        </p>
        <table className="doc-table">
          <tbody>
            <tr>
              <td>95%</td>
              <td>The top 10 PONS wallets at snapshot, weighted by balance</td>
            </tr>
            <tr>
              <td>5%</td>
              <td>Every other holder, pro-rata — anyone holding PONS receives a portion</td>
            </tr>
          </tbody>
        </table>
        <p>
          Every epoch we publish the full snapshot and merkle tree, post the root on-chain, and
          escrow the entire drop in the distributor in the same transaction. Claims are
          permissionless and verifiable against your own leaf. Want a bigger share? Climb the
          leaderboard — the top 10 is whoever holds the most, not a fixed list.
        </p>
        <table className="doc-table">
          <tbody>
            <tr>
              <td>PONS token</td>
              <td>
                <em>pending launch</em>
              </td>
            </tr>
            <tr>
              <td>PonsAirdrop</td>
              <td>
                <em>pending deployment</em>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="doc-section" id="edge-cases">
        <h2>Edge cases, stated plainly</h2>
        <ul className="doc-list">
          <li>
            If inventory can't cover your card's stock at open time, the contract refunds the full
            card value in USDG in the same transaction.
          </li>
          <li>
            Stock prices come from Chainlink's per-stock USD feeds. Feeds run 24/5 and pause during
            corporate actions; opens revert rather than settle on a stale price.
          </li>
          <li>
            Robinhood Stock Tokens are issued and controlled by Robinhood (pausable, upgradeable).
            Stocks can go down; a pack is randomized exposure, not a deposit. Not investment advice.
          </li>
        </ul>
      </section>
    </div>
  )
}
