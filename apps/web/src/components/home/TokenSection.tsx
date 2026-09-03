import { SectionHeading } from "@/components/ui/SectionHeading";

const OPEN_FREE = [
  "Finch SDK + manifests",
  "self-hosting",
  "Aviary browsing",
  "Flight School read-only presets",
  "public Robinhood reads",
  "public Pons reads",
];

const CONSUMPTION_LATER = [
  "AI inference + GPU compute",
  "hosted / persistent finches",
  "nest workloads",
  "premium data + Aviary services",
  "long-term memory + storage",
  "automation + higher quotas",
];

const EARN_LATER = [
  "building paid finches",
  "publishing useful nests",
  "operating Aviary services",
  "APIs + datasets",
  "development bounties",
  "ecosystem contributions",
];

function FeeFlow() {
  const box = "rounded-xs border border-line bg-bone px-3 py-2 font-mono text-[11px] uppercase tracking-[0.1em]";
  const arrow = <span className="mx-auto font-mono text-[12px] leading-none text-grey">↓</span>;
  return (
    <div className="flex flex-col gap-1.5 rounded-xs border border-line bg-bone-raised p-5">
      <p className="label-mono mb-2">launch economics</p>
      <div className={`${box} text-ink-soft`}>$FINCH trade on Pons · robinhood 4663</div>
      {arrow}
      <div className={`${box} border-green-deep/40 text-green-deep`}>3% creator tax · 300 bps</div>
      {arrow}
      <div className={`${box} text-ink`}>Finch fee wallet — team controlled</div>
      {arrow}
      <div className={`${box} text-grey normal-case tracking-normal`}>
        infrastructure · compute · hosting · rpc · indexing · integrations · operations · growth
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-grey">
        Finch receives the creator-side tax configured for our launch; Pons-level protocol fees are separate and never
        counted as Finch revenue. Launch signing is blocked unless the deployed Pons contracts verifiably permit 300
        bps to our fee recipient — no silent fallback to another rate or version.
      </p>
    </div>
  );
}

export function TokenSection() {
  return (
    <section className="container-page scroll-mt-10 py-20" id="finch">
      <SectionHeading
        index="05"
        kicker="$FINCH"
        title="Open infrastructure, honest economics."
        lede="$FINCH launches through Pons on Robinhood Chain with a 3% creator tax to the Finch fee wallet. The core network stays free to use — the token is never a tollbooth for every action, and no economics are faked before contracts exist."
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <FeeFlow />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          <div className="rounded-xs border border-line bg-bone-raised p-4">
            <p className="label-mono text-green-deep">free / open</p>
            <ul className="mt-3 space-y-2">
              {OPEN_FREE.map((item) => (
                <li key={item} className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-soft">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-green" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xs border border-line bg-bone-raised p-4">
            <p className="label-mono">consumption · later</p>
            <ul className="mt-3 space-y-2">
              {CONSUMPTION_LATER.map((item) => (
                <li key={item} className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-soft">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-gold" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xs border border-line bg-bone-raised p-4">
            <p className="label-mono">earn · later</p>
            <ul className="mt-3 space-y-2">
              {EARN_LATER.map((item) => (
                <li key={item} className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-soft">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-sage-deep" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
