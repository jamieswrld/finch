import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { shortAddr } from '../rng'

export function ConnectButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()

  if (isConnected && address) {
    return (
      <div className="wallet-chip">
        <a className="btn btn-ghost" href="#/wallet" title="Your wallet">
          <span className="dot dot-green" />
          {shortAddr(address)}
        </a>
        <button className="wallet-disconnect" onClick={() => disconnect()} title="Disconnect">
          ×
        </button>
      </div>
    )
  }

  return (
    <button
      className="btn btn-dark"
      disabled={isPending || connectors.length === 0}
      onClick={() => connect({ connector: connectors[0] })}
    >
      {isPending ? 'Connecting…' : 'Connect Wallet'}
    </button>
  )
}
