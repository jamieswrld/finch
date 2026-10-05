import { FLIGHTPATH_TOOLS } from "@finch/flightpath";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";

const LIFECYCLE = [
  { step: "policy", note: "allowances · program allowlists · modes" },
  { step: "simulate", note: "simulateTransaction, always" },
  { step: "approve", note: "human gate above thresholds" },
  { step: "sign", note: "your wallet, or a bounded operator key" },
  { step: "confirm", note: "landed, matched, or reverted — never assumed" },
  { step: "prove", note: "execution record + execution proof" },
];

export function ExecutionSection() {
  return (
    <section className="border-y border-line bg-bone-raised py-20" id="execution">
      <div className="container-page">
        <SectionHeading
          index="05"
          kicker="execution layer"
          title="Every agent action takes the same route."
          lede="The execution layer is how Yinsi touches Solana. Every write takes the same route: a policy check, a simulation, a signature from your wallet or a bounded operator key, confirmation onchain, and a logged execution proof. Nothing reaches Solana any other way."
        />

        <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-xs border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
          {LIFECYCLE.map((item, index) => (
            <li key={item.step} className="bg-bone p-4">
              <p className="flex items-center gap-2 font-mono text-[12px] text-ink">
                <span className="text-green-deep tnum">{index + 1}</span>
                {item.step}
              </p>
              <p className="mt-1.5 text-[11.5px] leading-snug text-grey">{item.note}</p>
            </li>
          ))}
        </ol>

        <div className="mt-10 overflow-x-auto rounded-xs border border-line">
          <table className="w-full min-w-[720px] border-collapse bg-bone text-left">
            <caption className="sr-only">Execution layer tool catalog</caption>
            <thead>
              <tr className="border-b border-line">
                <th className="label-mono px-4 py-2.5 font-normal">tool</th>
                <th className="label-mono px-4 py-2.5 font-normal">mode</th>
                <th className="label-mono px-4 py-2.5 font-normal">category</th>
                <th className="label-mono px-4 py-2.5 font-normal">description</th>
              </tr>
            </thead>
            <tbody>
              {FLIGHTPATH_TOOLS.map((tool) => (
                <tr key={tool.name} className="border-b border-line/60 last:border-b-0 hover:bg-bone-raised">
                  <td className="px-4 py-2.5 font-mono text-[12px] text-ink">{tool.name}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={tool.mode === "write" ? "gold" : "sage"}>{tool.mode}</Badge>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-grey">
                    {tool.category}
                  </td>
                  <td className="px-4 py-2.5 text-[13px] text-ink-soft">{tool.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 font-mono text-[10.5px] text-grey-faint">
          write-mode tools need a signer — the visitor&apos;s wallet or an operator key — and pass the policy engine on every call
        </p>
      </div>
    </section>
  );
}
