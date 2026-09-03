"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { safeValidateManifest, type FinchManifest } from "@finch/sdk";
import { FinchGlyph } from "@/components/birds/FinchGlyph";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { getSchoolPreset } from "@/lib/school-presets";
import {
  SECTIONS,
  defaultDraft,
  sectionComplete,
  toManifestCandidate,
  type FinchDraft,
  type SectionId,
} from "./draft";
import {
  BudgetSection,
  DeploymentSection,
  IdentitySection,
  MemorySection,
  ModelSection,
  PermissionsSection,
  ToolsSection,
  TriggersSection,
  WalletSection,
} from "./sections";

type HatchState =
  | { phase: "idle" }
  | { phase: "invalid"; issues: Array<{ path: string; message: string }> }
  | { phase: "submitting" }
  | { phase: "hatched"; saved: boolean; note?: string; manifest: FinchManifest }
  | { phase: "error"; message: string };

function sectionForIssue(path: string): SectionId {
  const head = path.split(".")[0] ?? "";
  const known = SECTIONS.find((section) => section.id === head);
  return known?.id ?? "identity";
}

function downloadManifest(manifest: FinchManifest): void {
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${manifest.identity.handle || "finch"}.manifest.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

const SECTION_COMPONENTS: Record<SectionId, (props: { draft: FinchDraft; update: (patch: (d: FinchDraft) => FinchDraft) => void }) => React.ReactNode> = {
  identity: IdentitySection,
  model: ModelSection,
  memory: MemorySection,
  tools: ToolsSection,
  permissions: PermissionsSection,
  wallet: WalletSection,
  triggers: TriggersSection,
  budget: BudgetSection,
  deployment: DeploymentSection,
};

const SECTION_NOTES: Record<SectionId, string> = {
  identity: "Who this finch is.",
  model: "The mind — provider-abstracted.",
  memory: "What it remembers between runs.",
  tools: "What it can do.",
  permissions: "What it may do.",
  wallet: "What it can spend. Deny by default.",
  triggers: "When it wakes.",
  budget: "Hard ceilings and the kill switch.",
  deployment: "Where it runs.",
};

export function FinchBuilder() {
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState<FinchDraft>(defaultDraft);
  const [hatch, setHatch] = useState<HatchState>({ phase: "idle" });
  const [attachedService, setAttachedService] = useState<string | null>(null);
  const [forkedFrom, setForkedFrom] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Arrivals from the Aviary ("Add to Nest") and Flight School ("Fork this finch").
  useEffect(() => {
    const service = searchParams.get("service");
    if (service && /^[a-z0-9-]{2,64}$/.test(service)) {
      setDraft((current) =>
        current.tools.services.includes(service)
          ? current
          : { ...current, tools: { ...current.tools, services: [...current.tools.services, service] } },
      );
      setAttachedService(service);
    }
    const school = searchParams.get("school");
    if (school) {
      const preset = getSchoolPreset(school);
      if (preset) {
        const manifest = preset.manifest;
        setDraft((current) => ({
          ...current,
          identity: {
            name: `${manifest.identity.name} (fork)`,
            handle: `${manifest.identity.handle}-fork`.slice(0, 32),
            handleTouched: true,
            description: manifest.identity.description,
            instructions: manifest.identity.instructions,
            glyph: manifest.identity.glyph,
          },
          model: {
            ...current.model,
            provider: "hyperbolic",
            model: manifest.model.model,
            temperature: manifest.model.temperature ?? 0.3,
            maxTokens: manifest.model.maxTokens ?? 2048,
          },
          memory: { ...current.memory, kind: manifest.memory.kind },
          tools: { flightpath: [...manifest.tools.flightpath], services: current.tools.services },
          wallet: { ...current.wallet, mode: "observer" },
        }));
        setForkedFrom(preset.title);
      }
    }
  }, [searchParams]);

  const update = (patch: (d: FinchDraft) => FinchDraft) => {
    setDraft(patch);
    setHatch((current) => (current.phase === "invalid" || current.phase === "error" ? { phase: "idle" } : current));
  };

  const issuesBySection = useMemo(() => {
    if (hatch.phase !== "invalid") return new Map<SectionId, string[]>();
    const map = new Map<SectionId, string[]>();
    for (const issue of hatch.issues) {
      const section = sectionForIssue(issue.path);
      map.set(section, [...(map.get(section) ?? []), `${issue.path || "manifest"}: ${issue.message}`]);
    }
    return map;
  }, [hatch]);

  async function hatchFinch(): Promise<void> {
    const candidate = toManifestCandidate(draft);
    const validated = safeValidateManifest(candidate);
    if (!validated.ok) {
      setHatch({ phase: "invalid", issues: validated.issues });
      const first = validated.issues[0];
      if (first) {
        document.getElementById(`section-${sectionForIssue(first.path)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    setHatch({ phase: "submitting" });
    try {
      const response = await fetch("/api/finches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: validated.manifest }),
      });
      const payload = (await response.json()) as {
        saved?: boolean;
        error?: string;
        note?: string;
        issues?: Array<{ path: string; message: string }>;
      };
      if (response.status === 422 && payload.issues) {
        setHatch({ phase: "invalid", issues: payload.issues });
        return;
      }
      if (!response.ok && payload.error) {
        setHatch({ phase: "error", message: payload.error });
        return;
      }
      setHatch({ phase: "hatched", saved: Boolean(payload.saved), note: payload.note, manifest: validated.manifest });
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    } catch (error) {
      setHatch({ phase: "error", message: error instanceof Error ? error.message : "network failure" });
    }
  }

  const completedCount = SECTIONS.filter((section) => sectionComplete(draft, section.id)).length;

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[220px_1fr]">
      {/* rail */}
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <p className="label-mono hidden lg:block">assembly</p>
        <ol className="mt-0 flex gap-1 overflow-x-auto pb-2 lg:mt-3 lg:flex-col lg:gap-0 lg:pb-0">
          {SECTIONS.map((section, index) => {
            const complete = sectionComplete(draft, section.id);
            const hasIssues = issuesBySection.has(section.id);
            return (
              <li key={section.id} className="shrink-0">
                <a
                  href={`#section-${section.id}`}
                  className={`flex items-center gap-2 rounded-xs border px-2.5 py-1.5 font-mono text-[11px] transition-colors lg:border-transparent lg:border-l-line lg:border-l lg:rounded-none lg:py-2 ${
                    hasIssues
                      ?"border-red-deep/50 text-red-deep lg:border-l-red-deep"
                      : complete
                        ? "border-line text-ink lg:border-l-green-deep"
                        : "border-line text-grey lg:border-l-line"
                  }`}
                >
                  <span className="tnum text-[10px] text-grey-faint">{String(index + 1).padStart(2, "0")}</span>
                  {section.label}
                  {complete && !hasIssues && <span className="ml-auto hidden text-green-deep lg:inline">·</span>}
                </a>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 hidden font-mono text-[10.5px] text-grey-faint lg:block tnum">
          {completedCount}/{SECTIONS.length} sections ready
        </p>
      </aside>

      {/* sections */}
      <div className="min-w-0">
        {attachedService && (
          <p className="mb-6 rounded-xs border border-sage/60 bg-sage/10 p-3 font-mono text-[11.5px] text-sage-deep">
            aviary service “{attachedService}” attached to this finch — see Tools.
          </p>
        )}
        {forkedFrom && (
          <p className="mb-6 rounded-xs border border-green-deep/40 bg-green-wash/40 p-3 font-mono text-[11.5px] text-green-deep">
            forked from flight school preset “{forkedFrom}” — rename it and make it yours.
          </p>
        )}

        <div className="flex flex-col gap-8">
          {SECTIONS.map((section, index) => {
            const SectionComponent = SECTION_COMPONENTS[section.id];
            const issues = issuesBySection.get(section.id);
            return (
              <section
                key={section.id}
                id={`section-${section.id}`}
                aria-label={section.label}
                className={`scroll-mt-24 rounded-xs border bg-bone-raised ${issues ?"border-red-deep/50" : "border-line"}`}
              >
                <header className="flex items-baseline gap-3 border-b border-line px-5 py-3">
                  <span className="label-mono text-green-deep tnum">{String(index + 1).padStart(2, "0")}</span>
                  <h2 className="font-mono text-[13px] font-medium text-ink">{section.label}</h2>
                  <span className="ml-auto hidden text-[11.5px] text-grey-faint sm:block">{SECTION_NOTES[section.id]}</span>
                </header>
                {issues && (
                  <ul className="border-b border-red-deep/30 bg-red-wash/40 px-5 py-2">
                    {issues.map((issue) => (
                      <li key={issue} className="font-mono text-[11px] text-red-deep">
                        {issue}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="p-5">
                  <SectionComponent draft={draft} update={update} />
                </div>
              </section>
            );
          })}
        </div>

        {/* hatch */}
        <div className="mt-10 rounded-xs border border-ink bg-ink p-6 text-bone" ref={resultRef}>
          {hatch.phase !== "hatched" ? (
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-mono text-[11px] text-sage">final step</p>
                <p className="mt-1 text-[17px] font-semibold tracking-[-0.01em]">
                  {draft.identity.name ? `Ready to hatch “${draft.identity.name}”?` : "Ready to hatch?"}
                </p>
                <p className="mt-1 text-[12.5px] text-bone/70">
                  Validates the manifest against finch.manifest/0.1 and saves a draft finch. Nothing executes onchain.
                </p>
              </div>
              <Button
                onClick={hatchFinch}
                disabled={hatch.phase === "submitting"}
                className="border-bone bg-bone text-ink hover:bg-green hover:border-green hover:text-ink"
              >
                {hatch.phase === "submitting" ? "hatching…" : "Hatch Finch"}
              </Button>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-3">
                <FinchGlyph size={26} className="text-green" />
                <div>
                  <p className="font-mono text-[11px] text-green">hatched — draft</p>
                  <p className="mt-0.5 text-[17px] font-semibold tracking-[-0.01em]">{hatch.manifest.identity.name}</p>
                </div>
                <Badge tone="sage">{hatch.saved ? "saved to registry" : "not persisted"}</Badge>
              </div>
              <p className="mt-3 max-w-xl text-[12.5px] leading-relaxed text-bone/70">
                {hatch.saved
                  ? "Manifest validated and stored as a draft finch. It starts running when you hatch it with the SDK in your runtime — no execution has been claimed or started."
                  : hatch.note ??
                    "Manifest validated. No registry database is configured in this environment, so download the manifest and hatch it with the Finch SDK."}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  variant="secondary"
                  className="border-bone/40 text-bone hover:border-bone hover:bg-transparent"
                  onClick={() => downloadManifest(hatch.manifest)}
                >
                  download manifest
                </Button>
                <Button
                  variant="secondary"
                  className="border-bone/40 text-bone hover:border-bone hover:bg-transparent"
                  onClick={() => {
                    setDraft(defaultDraft());
                    setHatch({ phase: "idle" });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  hatch another
                </Button>
              </div>
              <div className="mt-6">
                <CodeBlock
                  title={`${hatch.manifest.identity.handle}.manifest.json`}
                  code={JSON.stringify(hatch.manifest, null, 2)}
                />
                <p className="mt-3 font-mono text-[11px] text-bone/60">
                  run it: <span className="text-sage">hatchFromManifest(manifest, {"{ provider: hyperbolic(...) }"})</span> — see /docs
                </p>
              </div>
            </div>
          )}

          {hatch.phase === "invalid" && (
            <p className="mt-4 rounded-xs border border-red-deep/60 bg-red-wash/20 p-3 font-mono text-[11.5px] text-red-wash">
              {hatch.issues.length} validation issue{hatch.issues.length === 1 ? "" : "s"} — flagged in the sections above.
            </p>
          )}
          {hatch.phase === "error" && (
            <p className="mt-4 rounded-xs border border-red-deep/60 bg-red-wash/20 p-3 font-mono text-[11.5px] text-red-wash">
              save failed: {hatch.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
