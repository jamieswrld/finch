import { useEffect, useState } from 'react'

function parts(target: Date) {
  const ms = Math.max(0, target.getTime() - Date.now())
  return {
    d: Math.floor(ms / 86_400_000),
    h: Math.floor(ms / 3_600_000) % 24,
    m: Math.floor(ms / 60_000) % 60,
    s: Math.floor(ms / 1000) % 60,
  }
}

export function Countdown({ target }: { target: Date }) {
  const [t, setT] = useState(() => parts(target))

  useEffect(() => {
    const id = setInterval(() => setT(parts(target)), 1000)
    return () => clearInterval(id)
  }, [target])

  return (
    <div className="countdown">
      {(['d', 'h', 'm', 's'] as const).map((k) => (
        <div className="countdown-cell" key={k}>
          <span className="countdown-num">{String(t[k]).padStart(2, '0')}</span>
          <span className="countdown-label">{k.toUpperCase()}</span>
        </div>
      ))}
    </div>
  )
}
