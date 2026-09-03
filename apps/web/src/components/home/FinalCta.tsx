import { ButtonLink } from "@/components/ui/Button";
import { FinchGlyph } from "@/components/birds/FinchGlyph";

export function FinalCta() {
  return (
    <section className="border-t border-line bg-ink text-bone">
      <div className="container-page flex flex-col items-start gap-8 py-16 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-mono text-[11px] text-sage">first flight in under a minute</p>
          <h2 className="mt-3 text-[30px] leading-[1.1] font-semibold tracking-[-0.02em] md:text-[38px]">
            Hatch something small.
            <br />
            Let it find its nest.
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ButtonLink href="/app/school" className="border-bone bg-bone text-ink hover:bg-green hover:border-green hover:text-ink">
            Flight School <span aria-hidden>→</span>
          </ButtonLink>
          <ButtonLink href="/docs" className="border-bone/40 bg-transparent text-bone hover:border-bone hover:bg-transparent">
            Read the Docs
          </ButtonLink>
          <FinchGlyph size={26} className="ml-2 hidden text-green md:block" />
        </div>
      </div>
    </section>
  );
}
