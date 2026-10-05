import { ButtonLink } from "@/components/ui/Button";
import { YinsiMark } from "@/components/brand/YinsiMark";

export function FinalCta() {
  return (
    <section className="border-t border-line bg-ink text-bone">
      <div className="container-page flex flex-col items-start gap-8 py-16 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-mono text-[11px] text-sage">first run in under a minute</p>
          <h2 className="mt-3 text-[30px] leading-[1.1] font-semibold tracking-[-0.02em] md:text-[38px]">
            Launch something small.
            <br />
            Let it find its swarm.
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ButtonLink href="/app/playground" className="border-bone bg-bone text-ink hover:bg-green hover:border-green hover:text-ink">
            Playground <span aria-hidden>→</span>
          </ButtonLink>
          <ButtonLink href="/docs" className="border-bone/40 bg-transparent text-bone hover:border-bone hover:bg-transparent">
            Read the Docs
          </ButtonLink>
          <YinsiMark size={26} accent className="ml-2 hidden text-bone md:block" />
        </div>
      </div>
    </section>
  );
}
