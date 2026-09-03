"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import type { NestManifest } from "@finch/sdk";
import { NestComposer } from "@/components/nests/NestComposer";
import { NestRunner } from "./NestRunner";

/**
 * The nest workbench: RUN a real coordinated swarm, or COMPOSE the shape of a
 * new one. Two modes of the same object — a nest is always a task graph over
 * member finches.
 */
export function NestsWorkbench({ presets }: { presets: NestManifest[] }) {
  const params = useSearchParams();
  // "compose →" and "add to nest" both land here meaning the Compose view.
  // Opening Run instead silently discarded what the user asked for.
  const [tab, setTab] = useState<"run" | "compose">(() =>
    params.get("tab") === "compose" || params.get("finch") ? "compose" : "run",
  );
  // Honour ?preset= so "Try this nest" opens the nest it named, rather than
  // silently landing on whichever preset happens to be first.
  const [selectedId, setSelectedId] = useState(() => {
    const requested = params.get("preset");
    if (requested && presets.some((preset) => preset.identity.id === requested)) return requested;
    return presets[0]?.identity.id ?? "";
  });
  const selected = presets.find((preset) => preset.identity.id === selectedId) ?? presets[0];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-y border-line py-3">
        <div className="flex gap-1" role="tablist" aria-label="Nest mode">
          {(
            [
              { key: "run", label: "Run" },
              { key: "compose", label: "Compose" },
            ] as const
          ).map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={tab === entry.key}
              onClick={() => setTab(entry.key)}
              className={`rounded-xs border px-2.5 py-1.5 font-mono text-[11px] transition-colors ${
                tab === entry.key ?"border-ink bg-ink text-bone" : "border-line text-ink-soft hover:border-line-strong"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {tab === "run" && (
          <>
            <span className="mx-1 hidden h-4 w-px bg-line-strong sm:block" aria-hidden />
            <div className="flex flex-wrap gap-1">
              {presets.map((preset) => (
                <button
                  key={preset.identity.id}
                  type="button"
                  onClick={() => setSelectedId(preset.identity.id)}
                  className={`rounded-xs border px-2.5 py-1.5 font-mono text-[11px] transition-colors ${
                    selectedId === preset.identity.id
                      ?"border-green-deep bg-green-wash/50 text-green-deep"
                      : "border-line text-ink-soft hover:border-line-strong"
                  }`}
                >
                  {preset.identity.name.replace(/ Nest$/, "")}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="mt-6">
        {tab === "run" && selected ? (
          <>
            <p className="mb-4 max-w-2xl text-[13px] leading-relaxed text-grey">{selected.identity.description}</p>
            <NestRunner key={selected.identity.id} manifest={selected} />
          </>
        ) : (
          <NestComposer />
        )}
      </div>
    </div>
  );
}
