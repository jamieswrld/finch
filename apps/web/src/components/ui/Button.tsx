import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

const base =
  "inline-flex items-center justify-center gap-2 rounded-xs border font-mono text-[12px] transition-colors duration-150 px-4 h-10 select-none disabled:opacity-40 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  primary: "border-ink bg-ink text-bone hover:bg-green-deep hover:border-green-deep",
  secondary: "border-line-strong bg-transparent text-ink hover:border-ink hover:bg-bone-raised",
  ghost: "border-transparent bg-transparent text-ink-soft hover:text-ink hover:border-line",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className = "",
  href,
  children,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; children: ReactNode }) {
  return (
    <Link href={href} className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </Link>
  );
}
