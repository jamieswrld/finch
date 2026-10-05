import { ButtonLink } from "@/components/ui/Button";
import { AgentGlyph } from "@/components/brand/AgentGlyph";

export default function NotFound() {
  return (
    <div className="container-page flex min-h-[60vh] flex-col items-start justify-center py-16">
      <div className="flex items-center gap-3">
        <AgentGlyph size={16} className="text-grey-faint" />
        <p className="label-mono">404 — no route here</p>
      </div>
      <h1 className="mt-4 text-[34px] font-semibold tracking-[-0.02em]">This page doesn&apos;t exist.</h1>
      <p className="mt-3 max-w-md text-[14px] leading-relaxed text-ink-soft">
        The address doesn&apos;t match anything here. Head back to the overview, or browse the directory.
      </p>
      <div className="mt-6 flex gap-3">
        <ButtonLink href="/">Overview</ButtonLink>
        <ButtonLink href="/app/directory" variant="secondary">
          Directory
        </ButtonLink>
        <ButtonLink href="/app" variant="secondary">
          Launch App
        </ButtonLink>
      </div>
    </div>
  );
}
