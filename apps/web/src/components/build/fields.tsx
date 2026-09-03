"use client";

import type { ComponentProps, ReactNode } from "react";

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="label-mono block text-ink">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1.5 text-[11.5px] leading-snug text-grey">{hint}</p>}
    </div>
  );
}

const inputClass =
  "w-full rounded-xs border border-line bg-bone px-3 h-9 font-mono text-[12.5px] text-ink placeholder:text-grey-faint focus:border-green-deep";

export function TextInput(props: ComponentProps<"input">) {
  return <input type="text" className={inputClass} {...props} />;
}

export function NumberInput(props: ComponentProps<"input">) {
  return <input type="number" className={`${inputClass} tnum`} {...props} />;
}

export function TextArea(props: ComponentProps<"textarea">) {
  return (
    <textarea
      className="w-full rounded-xs border border-line bg-bone px-3 py-2 font-mono text-[12.5px] leading-relaxed text-ink placeholder:text-grey-faint focus:border-green-deep"
      {...props}
    />
  );
}

export function Select(props: ComponentProps<"select">) {
  return <select className={`${inputClass} appearance-none pr-8`} {...props} />;
}

/** Bordered radio-card row used for mode choices. */
export function OptionRow({
  checked,
  onSelect,
  title,
  description,
  disabled,
  tag,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  disabled?: boolean;
  tag?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={`flex w-full items-start gap-3 rounded-xs border p-3 text-left transition-colors ${
        checked ?"border-green-deep bg-green-wash/40" : "border-line bg-bone hover:border-line-strong"
      } ${disabled ? "opacity-45" : ""}`}
    >
      <span
        aria-hidden
        className={`mt-1 inline-flex size-[12px] shrink-0 items-center justify-center rounded-full border ${
          checked ?"border-green-deep" : "border-line-strong"
        }`}
      >
        {checked && <span className="size-[6px] rounded-full bg-green-deep" />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 font-mono text-[12px] text-ink">
          {title}
          {tag && <span className="rounded-xs border border-gold/50 px-1 text-[9.5px] text-gold-deep">{tag}</span>}
        </span>
        <span className="mt-0.5 block text-[12px] leading-snug text-grey">{description}</span>
      </span>
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2.5 ${disabled ?"opacity-45" : ""}`}
    >
      <span
        className={`relative inline-flex h-[16px] w-[28px] items-center rounded-full border transition-colors ${
          checked ?"border-green-deep bg-green-deep" : "border-line-strong bg-bone-sunken"
        }`}
      >
        <span
          className={`absolute size-[10px] rounded-full bg-bone transition-transform ${checked ?"translate-x-[14px]" : "translate-x-[2px]"}`}
        />
      </span>
      <span className="font-mono text-[11.5px] text-ink">{label}</span>
    </button>
  );
}
