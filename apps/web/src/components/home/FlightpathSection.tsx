import { FLIGHTPATH_TOOLS } from "@finch/flightpath";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";

const LIFECYCLE = [
  { step: "policy", note: "allowances · allowlists · modes" },
  { step: "simulate", note: "estimateGas + eth_call, always" },
  { step: "approve", note: "human gate above thresholds" },
  { step: "submit", note: "one intent, one transaction" },
  { step: "confirm", note: "receipts, reverts, reconciliation" },
  { step: "log", note: "auditable execution record" },
];

export function FlightpathSection() {
  return (
    <section className="border-y border-line bg-bone-raised py-20" id="flightpath">
      <div className="container-page">
        <SectionHeading
          index="07"
          kicker="Flightpath — execution layer"
          title="Every agent action flies the same route."
          lede="Flightpath is Finch's Robinhood Chain adapter. It is EVM-native — no bundling exotica — and it refuses shortcuts: no write reaches the chain without simulation, policy, confirmation and a log entry."
        />

        <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-xs border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
          {LIFECYCLE.map((item, index) => (
            <li key={item.step} className="bg-bone p-4">
              <p className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.12em] text-ink">
                <span className="text-green-deep tnum">{index + 1}</span>
                {item.step}
              </p>
              <p className="mt-1.5 text-[11.5px] leading-snug text-grey">{item.note}</p>
            </li>
          ))}
        </ol>

        <div className="mt-10 overflow-x-auto rounded-xs border border-line">
          <table className="w-full min-w-[720px] border-collapse bg-bone text-left">
            <caption className="sr-only">Flightpath tool catalog</caption>
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
                  <td className="px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-grey">
                    {tool.category}
                  </td>
                  <td className="px-4 py-2.5 text-[13px] text-ink-soft">{tool.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.1em] text-grey-faint">
          write-mode tools require an operator wallet and pass the policy engine on every call
        </p>
      </div>
    </section>
  );
}
