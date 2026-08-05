import { X_HANDLE, X_URL } from '../data'

export function XIcon({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

/** Icon-only link to the finch account on X, sized to sit beside header buttons. */
export function XButton() {
  return (
    <a
      className="btn btn-icon"
      href={X_URL}
      target="_blank"
      rel="noreferrer"
      aria-label={`finch on X (@${X_HANDLE})`}
      title={`@${X_HANDLE}`}
    >
      <XIcon />
    </a>
  )
}
