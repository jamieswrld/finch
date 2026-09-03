"use client";

import type { ReactNode } from "react";
import { Button } from "./Button";

/** Deliberate loading / error / empty states shared by every data surface. */

export function LoadingBlock({ label = "loading" }: { label?: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-xs border border-line bg-bone-raised p-6" role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        <span className="size-[7px] animate-pulse rounded-full bg-sage-deep" />
        <span className="label-mono">{label}…</span>
      </div>
      <div className="space-y-2">
        <div className="h-3 w-2/3 animate-pulse rounded-xs bg-bone-sunken" />
        <div className="h-3 w-1/2 animate-pulse rounded-xs bg-bone-sunken" />
        <div className="h-3 w-3/5 animate-pulse rounded-xs bg-bone-sunken" />
      </div>
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xs border border-red-deep/40 bg-red-wash/50 p-6" role="alert">
      <p className="label-mono text-red-deep">request failed</p>
      <p className="mt-2 text-sm text-ink-soft">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-4 h-8 px-3" onClick={onRetry}>
          retry
        </Button>
      )}
    </div>
  );
}

export function EmptyBlock({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xs border border-dashed border-line-strong bg-transparent p-8 text-center">
      <p className="label-mono">{title}</p>
      {children && <div className="mx-auto mt-3 max-w-sm text-sm text-grey">{children}</div>}
    </div>
  );
}
