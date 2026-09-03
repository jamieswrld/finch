"use client";

import { Button } from "@/components/ui/Button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="container-page flex min-h-[60vh] flex-col items-start justify-center py-16">
      <p className="label-mono text-red-deep">unexpected failure</p>
      <h1 className="mt-4 text-[34px] font-semibold tracking-[-0.02em]">Something broke mid-flight.</h1>
      <p className="mt-3 max-w-md text-[14px] leading-relaxed text-ink-soft">
        The error has a digest{error.digest ? ` (${error.digest})` : ""} and nothing was executed on your behalf.
      </p>
      <Button className="mt-6" onClick={reset}>
        try again
      </Button>
    </div>
  );
}
