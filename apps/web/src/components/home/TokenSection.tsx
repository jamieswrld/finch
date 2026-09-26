import { SectionHeading } from "@/components/ui/SectionHeading";
import { TokenLive } from "./TokenLive";

/**
 * $FINCH on the home page.
 *
 * The heading states only what stays true before and after launch: $FINCH
 * launches on pump.fun, it is read from its Solana SPL mint, and publishing is
 * free. Every number lives in <TokenLive />, which reads the pump.fun curve,
 * Solana, Jupiter and DexScreener for the request that renders it — or says
 * plainly that the mint does not exist yet.
 * Nothing here is quoted from a spec sheet.
 */
export function TokenSection() {
  return (
    <section className="container-page scroll-mt-10 py-20" id="finch">
      <SectionHeading
        index="05"
        kicker="$FINCH"
        title="Publishing stays free. The token gates nothing."
        lede="$FINCH launches on pump.fun. Everything below is read live as you look — the pump.fun curve, the SPL mint account on Solana, Jupiter and DexScreener. Until the mint exists onchain, the panel shows the contract address and says it has not launched, instead of showing numbers. Publishing, running and composing are open and free either way."
      />
      <TokenLive />
    </section>
  );
}
