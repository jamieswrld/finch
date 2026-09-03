import { ButtonLink } from "@/components/ui/Button";
import { DartGlyph } from "@/components/birds/FinchGlyph";

export default function NotFound() {
  return (
    <div className="container-page flex min-h-[60vh] flex-col items-start justify-center py-16">
      <div className="flex items-center gap-3">
        <DartGlyph size={16} angle={38} className="text-grey-faint" />
        <p className="label-mono">404 — off the flightpath</p>
      </div>
      <h1 className="mt-4 text-[34px] font-semibold tracking-[-0.02em]">This page never hatched.</h1>
      <p className="mt-3 max-w-md text-[14px] leading-relaxed text-ink-soft">
        The address doesn't match anything in the nest. Head back to the overview, or browse the Aviary.
      </p>
      <div className="mt-6 flex gap-3">
        <ButtonLink href="/">Overview</ButtonLink>
        <ButtonLink href="/app" variant="secondary">
          Launch App
        </ButtonLink>
      </div>
    </div>
  );
}
