import type { ReactNode } from "react";

/**
 * Section header in the lab-notebook register: numbered mono kicker, thin rule,
 * editorial headline.
 */
export function SectionHeading({
  index,
  kicker,
  title,
  lede,
  children,
}: {
  index?: string;
  kicker: string;
  title: string;
  lede?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="mb-10">
      <div className="flex items-baseline gap-3 border-b border-line pb-2">
        {index && <span className="label-mono text-green-deep">{index}</span>}
        <span className="label-mono">{kicker}</span>
        <span className="ml-auto hidden font-mono text-[10px] text-grey-faint sm:block">+</span>
      </div>
      <h2 className="mt-6 max-w-2xl text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] text-ink md:text-[36px]">
        {title}
      </h2>
      {lede && <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-soft">{lede}</p>}
      {children}
    </header>
  );
}
