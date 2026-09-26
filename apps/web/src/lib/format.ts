export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat("en-US", options).format(value);
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatAmount(value: number, maxDecimals = 3): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: maxDecimals }).format(value);
}

/** Base58 has no prefix to keep, so this is simply the first and last `chars`. Case is left exactly as given. */
export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 1) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

/**
 * Integer base units → a human decimal string, trailing zeros trimmed. Exact:
 * bigint arithmetic, never a float, because a rounded amount on a signing
 * screen is a wrong amount.
 */
export function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const fraction = decimals > 0 ? (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  return `${negative ? "-" : ""}${(abs / base).toString()}${fraction ? `.${fraction}` : ""}`;
}

/** Lamports (as the API sends them: a decimal string, a number, or a bigint) → SOL, or null when unreadable. */
export function formatSol(lamports: bigint | string | number | null | undefined): string | null {
  if (lamports === null || lamports === undefined) return null;
  try {
    return formatUnits(BigInt(lamports), 9);
  } catch {
    return null;
  }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
