import { useState } from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { shortAddr } from '../rng'
import { WalletDrawer } from './WalletDrawer'

export function ConnectButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const [open, setOpen] = useState(false)

  if (isConnected && address) {
    return (
      <>
        <button className="btn btn-ghost" onClick={() => setOpen(true)} title="Wallet">
          <span className="dot dot-green" />
          {shortAddr(address)}
        </button>
        {open && (
          <WalletDrawer
            address={address}
            onClose={() => setOpen(false)}
            onDisconnect={() => {
              disconnect()
              setOpen(false)
            }}
          />
        )}
      </>
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
