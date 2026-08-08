import { bnbChain } from '../chain'
import { HIDDEN_CARD_CHANCE, JACKPOT_CUT, PACKS, STOCKS, USDT_ADDRESS, asset } from '../data'
import { PACK_SALE_ADDRESS, TREASURY_ADDRESS, VAULT_ADDRESS, isOnchainEnabled } from '../onchain'
import { fmtUsd } from '../rng'
import { XButton } from './XLink'

const explorer = bnbChain.blockExplorers.default.url

function AddrLink({ address }: { address: string }) {
  return (
    <a className="mono doc-addr" href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer">
      {address}
    </a>
  )
}

const SECTIONS = [
  { id: 'what', label: 'What finch is' },
  { id: 'buy', label: 'How to buy' },
  { id: 'odds', label: 'Odds' },
  { id: 'jackpot', label: 'The jackpot' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'risk', label: 'Risk' },
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
        <div className="header-actions">
          <XButton />
          <a className="btn btn-ghost" href="#/">
            ← Back to app
          </a>
        </div>
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
        What finch is, how to buy, and every contract we run — so you can verify all of it on
        BscScan before you spend a dollar.
      </p>

      <section className="doc-section" id="what">
        <h2>What finch is</h2>
        <p>
          finch sells digital packs on {bnbChain.name}. You pay in USDT; the pack opens to a
          card that is a real crypto asset, transferred to
          your wallet and yours to hold, sell, or move anywhere. Occasionally a pack contains a
          hidden card, which pays out a percentage of the jackpot in USDT instead.
        </p>
        <p>
          Everything settles on-chain in your own wallet. finch never custodies your assets, and
          there is no account to create — connect a wallet and you are done.
        </p>
      </section>

      <section className="doc-section" id="buy">
        <h2>How to buy</h2>
        <ol className="doc-steps">
          <li>
            <strong>Get on {bnbChain.name}.</strong> Any EVM wallet works. Network name{' '}
            {bnbChain.name}, chain ID <span className="mono">{bnbChain.id}</span>, RPC{' '}
            <span className="mono">{bnbChain.rpcUrls.default.http[0]}</span>. Gas is paid in
            ETH.
          </li>
          <li>
            <strong>Fund with USDT.</strong> USDT on BNB Chain is the payment
            token. Bridge in or swap for it on-chain.
          </li>
          <li>
            <strong>Connect and pick a pack.</strong> Prices run{' '}
            {fmtUsd(Math.min(...PACKS.map((p) => p.priceUsd)))} to{' '}
            {fmtUsd(Math.max(...PACKS.map((p) => p.priceUsd)))}. Each pack lists the stocks it can
            pull from.
          </li>
          <li>
            <strong>Approve and buy.</strong> One approval for USDT, then the purchase itself. Your
            outcome is locked to a future block hash at this moment — before anyone, including us,
            can see it.
          </li>
          <li>
            <strong>Open.</strong> A second transaction settles the pack and transfers your card.
            The reveal on screen is reading the on-chain result, not deciding it.
          </li>
        </ol>
      </section>

      <section className="doc-section" id="odds">
        <h2>Odds</h2>
        <p>
          Every card is real. A {HIDDEN_CARD_CHANCE * 100}% roll decides whether the card is a
          hidden jackpot card; otherwise rarity sets the card's value as a multiple of what you
          paid, and the stock is drawn from that pack's pool. These weights are hardcoded in the
          PackSale contract — read them yourself.
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
            {[
              ['Common', '78%', '0.60× – 0.85×', '#9ca3af'],
              ['Rare', '15%', '0.85× – 1.20×', '#2b6cb0'],
              ['Epic', '5%', '1.20× – 1.80×', '#7c3aed'],
              ['Legendary', '2%', '1.80× – 3.00×', '#d97706'],
            ].map(([label, odds, range, color]) => (
              <tr key={label}>
                <td style={{ color, fontWeight: 700 }}>{label}</td>
                <td>{odds}</td>
                <td>{range} pack price</td>
              </tr>
            ))}
            <tr>
              <td style={{ color: '#b3903f', fontWeight: 700 }}>Hidden card</td>
              <td>1%</td>
              <td>0.5–25% of the jackpot, paid in USDT</td>
            </tr>
          </tbody>
        </table>
        <p>
          finch is entertainment with real assets attached, not an investment product — the
          expected value of a pack is less than what you pay for it.
        </p>
        <p className="muted small">
          Card values are randomised inside each band, so a $10 pack pays an uneven amount like
          $8.43 rather than a flat multiple. The contract buys your stock on Uniswap v4 at the
          moment you open, using the minimum output implied by the Chainlink price — a thin or
          manipulated pool cannot hand you a worthless amount. There is no refund path: every
          card is a real stock.
        </p>
      </section>

      <section className="doc-section" id="jackpot">
        <h2>The jackpot</h2>
        <p>
          {Math.round(JACKPOT_CUT * 100)}% of every pack purchase accrues in the JackpotVault
          contract. The figure shown on the site is that contract's live USDT balance — it goes up
          as packs sell, and you can verify it on BscScan at any time.
        </p>
        <p>
          Creator fees from the finch token spill into the vault as well, so trading activity feeds
          the prize pool on top of pack sales. Every contribution is an on-chain transfer you can
          audit — the "fees recycled" figure on the home page is read directly from those transfers.
        </p>
        <p>
          <strong>Hidden cards</strong> pay out of it automatically and instantly: pull one and the
          contract sends you your percentage of the pot in the same transaction, no claim needed.
          Outside of a hidden card there is no automatic payout and no on-chain claim you can make
          against the pot — treat the jackpot as the prize pool that funds hidden cards, not as a
          balance you are owed.
        </p>
      </section>

      <section className="doc-section" id="contracts">
        <h2>Contracts</h2>
        <p>
          Everything we run on {bnbChain.name}, chain ID{' '}
          <span className="mono">{bnbChain.id}</span>. Source is public in the repo and
          verified on BscScan.
        </p>
        <table className="doc-table">
          <tbody>
            <tr>
              <td>PackSale</td>
              <td>{deployed ? <AddrLink address={PACK_SALE_ADDRESS} /> : <em>pending</em>}</td>
            </tr>
            <tr>
              <td>JackpotVault</td>
              <td>{deployed ? <AddrLink address={VAULT_ADDRESS} /> : <em>pending</em>}</td>
            </tr>
            <tr>
              <td>Treasury (1% fee)</td>
              <td>
                <AddrLink address={TREASURY_ADDRESS} />
              </td>
            </tr>
            <tr>
              <td>USDT (BNB Chain)</td>
              <td>
                <AddrLink address={USDT_ADDRESS} />
              </td>
            </tr>
          </tbody>
        </table>
        <h3>Where your money goes</h3>
        <table className="doc-table">
          <tbody>
            <tr>
              <td>79%</td>
              <td>PackSale treasury — holds the stock inventory and pays your card</td>
            </tr>
            <tr>
              <td>{Math.round(JACKPOT_CUT * 100)}%</td>
              <td>JackpotVault — hidden-card payouts and the prize pool</td>
            </tr>
            <tr>
              <td>1%</td>
              <td>Protocol fee to the treasury (capped at 5% in the contract)</td>
            </tr>
          </tbody>
        </table>
        <h3>Assets we deliver</h3>
        <p>
          Every address below was read back from BNB Chain and confirmed to have both a live
          Chainlink USD feed and a PancakeSwap market deep enough to settle against. A token
          with a matching ticker but a different address is not one of them — check the address,
          never the symbol.
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

      <section className="doc-section" id="risk">
        <h2>Risk</h2>
        <ul className="doc-list">
          <li>
            Packs are randomized. You can pay {fmtUsd(10)} and receive a card worth substantially
            less.
          </li>
          <li>
            Stocks move. A tokenized share can lose value after it reaches your wallet, like any
            equity.
          </li>
          <li>
            Assets are third-party ERC-20s on BNB Chain. finch does not issue or control any of them, and
            their issuers may have their own upgrade or pause powers.
          </li>
          <li>
            Prices come from Chainlink feeds, which can go stale or pause during
            corporate actions. Openings revert rather than settle on a stale price.
          </li>
          <li>
            The jackpot is discretionary. Nothing in the contract entitles you to a share of it
            outside of a hidden card.
          </li>
          <li>Not investment advice. Do not spend more than you are willing to lose.</li>
        </ul>
      </section>
    </div>
  )
}
