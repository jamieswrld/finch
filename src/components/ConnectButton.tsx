import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { shortAddr } from '../rng'

export function ConnectButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()

  if (isConnected && address) {
    return (
      <button className="btn btn-ghost" onClick={() => disconnect()} title="Disconnect">
        <span className="dot dot-green" />
        {shortAddr(address)}
      </button>
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
