"use client";

import { FLIGHTPATH_TOOLS } from "@finch/flightpath";
import { HYPERBOLIC_MODELS } from "@finch/providers";
import { DartGlyph, FinchGlyph } from "@/components/birds/FinchGlyph";
import { Badge } from "@/components/ui/Badge";
import { Field, NumberInput, OptionRow, Select, TextArea, TextInput, Toggle } from "./fields";
import { slugify, type FinchDraft } from "./draft";

type Update = (patch: (draft: FinchDraft) => FinchDraft) => void;

export function IdentitySection({ draft, update }: { draft: FinchDraft; update: Update }) {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      <Field label="name" htmlFor="nb-name" hint="Displayed everywhere the finch appears.">
        <TextInput
          id="nb-name"
          value={draft.identity.name}
          placeholder="Market Watcher"
          onChange={(event) =>
            update((d) => ({
              ...d,
              identity: {
                ...d.identity,
                name: event.target.value,
                handle: d.identity.handleTouched ? d.identity.handle : slugify(event.target.value),
              },
            }))
          }
        />
      </Field>
      <Field label="handle" htmlFor="nb-handle" hint="Unique id: lowercase, digits, hyphens.">
        <TextInput
          id="nb-handle"
          value={draft.identity.handle}
          placeholder="market-watcher"
          onChange={(event) =>
            update((d) => ({
              ...d,
              identity: { ...d.identity, handle: slugify(event.target.value), handleTouched: true },
            }))
          }
        />
      </Field>
      <div className="md:col-span-2">
        <Field label="description" htmlFor="nb-desc" hint="One or two sentences; shown in the Aviary and nest views.">
          <TextArea
            id="nb-desc"
            rows={2}
            value={draft.identity.description}
            placeholder="Watches a token list and reports notable changes."
            onChange={(event) => update((d) => ({ ...d, identity: { ...d.identity, description: event.target.value } }))}
          />
        </Field>
      </div>
      <div className="md:col-span-2">
        <Field
          label="instructions"
          htmlFor="nb-instructions"
          hint="System instructions the model receives on every run. Be precise about what the finch must and must not do."
        >
          <TextArea
            id="nb-instructions"
            rows={4}
            value={draft.identity.instructions}
            placeholder="Watch the configured tokens. Report changes factually with numbers. Never speculate on price."
            onChange={(event) =>
              update((d) => ({ ...d, identity: { ...d.identity, instructions: event.target.value } }))
            }
          />
        </Field>
      </div>
      <Field label="glyph" hint="How this finch renders in diagrams.">
        <div className="flex gap-2" role="radiogroup" aria-label="Glyph">
          {(["finch-01", "finch-02", "finch-03"] as const).map((glyph, index) => (
            <button
              key={glyph}
              type="button"
              role="radio"
              aria-checked={draft.identity.glyph === glyph}
              onClick={() => update((d) => ({ ...d, identity: { ...d.identity, glyph } }))}
              className={`flex size-11 items-center justify-center rounded-xs border transition-colors ${
                draft.identity.glyph === glyph ?"border-green-deep bg-green-wash/40 text-green-deep" : "border-line text-ink-soft hover:border-line-strong"
              }`}
            >
              {index === 0 ? <FinchGlyph size={20} /> : <DartGlyph size={16} angle={index === 1 ? -18 : 8} />}
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}

export function ModelSection({ draft, update }: { draft: FinchDraft; update: Update }) {
  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Provider">
        <OptionRow
          checked={draft.model.provider === "hyperbolic"}
          onSelect={() => update((d) => ({ ...d, model: { ...d.model, provider: "hyperbolic" } }))}
          title="Hyperbolic"
          description="Finch's first compute provider. Open models, serverless."
        />
        <OptionRow
          checked={draft.model.provider === "openai-compatible"}
          onSelect={() => update((d) => ({ ...d, model: { ...d.model, provider: "openai-compatible" } }))}
          title="OpenAI-compatible"
          description="Any endpoint speaking the standard — the no-lock-in escape hatch."
        />
      </div>

      {draft.model.provider === "hyperbolic" ? (
        <Field label="model" htmlFor="nb-model" hint="Catalog is advisory; any model id your Hyperbolic account can access works.">
          <Select
            id="nb-model"
            value={draft.model.model}
            onChange={(event) => update((d) => ({ ...d, model: { ...d.model, model: event.target.value } }))}
          >
            {HYPERBOLIC_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label} — {model.notes}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field label="model id" htmlFor="nb-custom-model" hint="The endpoint's base URL and key are configured server-side, never in the manifest.">
          <TextInput
            id="nb-custom-model"
            value={draft.model.customModel}
            placeholder="my-org/my-model"
            onChange={(event) => update((d) => ({ ...d, model: { ...d.model, customModel: event.target.value } }))}
          />
        </Field>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label={`temperature — ${draft.model.temperature.toFixed(2)}`} htmlFor="nb-temp" hint="Lower is steadier. Agents that touch funds should stay cold.">
          <input
            id="nb-temp"
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={draft.model.temperature}
            onChange={(event) => update((d) => ({ ...d, model: { ...d.model, temperature: Number(event.target.value) } }))}
            className="w-full accent-[#0a7227]"
          />
        </Field>
        <Field label="max tokens" htmlFor="nb-maxtok">
          <NumberInput
            id="nb-maxtok"
            min={256}
            max={32768}
            value={draft.model.maxTokens}
            onChange={(event) => update((d) => ({ ...d, model: { ...d.model, maxTokens: Number(event.target.value) } }))}
          />
        </Field>
      </div>
    </div>
  );
}

export function MemorySection({ draft, update }: { draft: FinchDraft; update: Update }) {
  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Memory kind">
        <OptionRow
          checked={draft.memory.kind === "none"}
          onSelect={() => update((d) => ({ ...d, memory: { ...d.memory, kind: "none" } }))}
          title="None"
          description="Stateless runs. Cheapest; nothing carries over."
        />
        <OptionRow
          checked={draft.memory.kind === "ephemeral"}
          onSelect={() => update((d) => ({ ...d, memory: { ...d.memory, kind: "ephemeral" } }))}
          title="Ephemeral"
          description="In-process ring buffer. Gone on restart."
        />
        <OptionRow
          checked={draft.memory.kind === "mongo-vector"}
          onSelect={() => update((d) => ({ ...d, memory: { ...d.memory, kind: "mongo-vector" } }))}
          title="Mongo vector"
          description="Durable semantic memory on MongoDB Atlas."
        />
      </div>
      {draft.memory.kind === "mongo-vector" && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="namespace" htmlFor="nb-ns" hint="Defaults to the finch handle. Namespaces isolate recall.">
            <TextInput
              id="nb-ns"
              value={draft.memory.namespace}
              placeholder={draft.identity.handle || "namespace"}
              onChange={(event) => update((d) => ({ ...d, memory: { ...d.memory, namespace: slugify(event.target.value) } }))}
            />
          </Field>
          <Field label="retention — days" htmlFor="nb-retention">
            <NumberInput
              id="nb-retention"
              min={1}
              max={3650}
              value={draft.memory.retentionDays}
              onChange={(event) => update((d) => ({ ...d, memory: { ...d.memory, retentionDays: Number(event.target.value) } }))}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

export function ToolsSection({ draft, update }: { draft: FinchDraft; update: Update }) {
  const readTools = FLIGHTPATH_TOOLS.filter((tool) => tool.mode === "read");
  const writeTools = FLIGHTPATH_TOOLS.filter((tool) => tool.mode === "write");
  const operator = draft.wallet.mode === "operator";

  const toggleTool = (name: string) =>
    update((d) => ({
      ...d,
      tools: {
        ...d.tools,
        flightpath: d.tools.flightpath.includes(name)
          ? d.tools.flightpath.filter((tool) => tool !== name)
          : [...d.tools.flightpath, name],
      },
    }));

  const toolRow = (tool: (typeof FLIGHTPATH_TOOLS)[number], disabled: boolean) => (
    <label
      key={tool.name}
      className={`flex cursor-pointer items-start gap-2.5 border-b border-line/50 py-2 last:border-b-0 ${disabled ?"cursor-not-allowed opacity-45" : ""}`}
    >
      <input
        type="checkbox"
        disabled={disabled}
        checked={draft.tools.flightpath.includes(tool.name)}
        onChange={() => toggleTool(tool.name)}
        className="mt-1 size-3.5 accent-[#0a7227]"
      />
      <span className="min-w-0">
        <span className="font-mono text-[12px] text-ink">{tool.name}</span>
        <span className="block text-[11.5px] leading-snug text-grey">{tool.description}</span>
      </span>
    </label>
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div>
        <p className="label-mono flex items-center gap-2">
          read tools <Badge tone="sage">safe</Badge>
        </p>
        <div className="mt-2 rounded-xs border border-line bg-bone p-3">{readTools.map((tool) => toolRow(tool, false))}</div>
      </div>
      <div>
        <p className="label-mono flex items-center gap-2">
          write tools <Badge tone="gold">operator wallet required</Badge>
        </p>
        <div className="mt-2 rounded-xs border border-line bg-bone p-3">
          {writeTools.map((tool) => toolRow(tool, !operator))}
        </div>
        {!operator && (
          <p className="mt-2 text-[11.5px] text-grey">
            Write tools unlock when the wallet section grants operator mode — and are stripped again at hatch if it
            doesn't.
          </p>
        )}
      </div>
      <div className="lg:col-span-2">
        <p className="label-mono">aviary services</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-gold-deep">
          Attached services are recorded in the manifest and travel with it, but the runtime does not call them yet —
          service resolution ships with the Aviary service protocol. A hatched finch reports them as unresolved rather
          than pretending the attachment took effect.
        </p>
        {draft.tools.services.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-grey">
            None attached. Browse the Aviary and press “Add to a finch” on any listing — it lands here.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {draft.tools.services.map((slug) => (
              <li key={slug} className="flex items-center gap-2 rounded-xs border border-sage/60 bg-sage/10 px-2 py-1 font-mono text-[11.5px] text-sage-deep">
                {slug}
                <button
                  type="button"
                  aria-label={`Remove ${slug}`}
                  className="text-grey hover:text-red-deep"
                  onClick={() =>
                    update((d) => ({
                      ...d,
                      tools: { ...d.tools, services: d.tools.services.filter((service) => service !== slug) },
                    }))
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function PermissionsSection({ draft, update }: { draft: FinchDraft; update: Update }) {
  const operator = draft.wallet.mode === "operator";
  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex items-start justify-between gap-4 rounded-xs border border-line bg-bone p-3">
        <div>
          <p className="font-mono text-[12px] text-ink">onchain writes</p>
          <p className="mt-0.5 text-[12px] text-grey">
            Derived from wallet mode — {operator ? "enabled by operator wallet" : "disabled until an operator wallet is granted"}. Deny by default.
          </p>
        </div>
        <Badge tone={operator ? "gold" : "sage"}>{operator ? "enabled" : "disabled"}</Badge>
      </div>

      <div className="rounded-xs border border-line bg-bone p-3">
        <Toggle
          checked={draft.permissions.useApprovalThreshold}
          onChange={(value) => update((d) => ({ ...d, permissions: { ...d.permissions, useApprovalThreshold: value } }))}
          label="human approval threshold"
          disabled={!operator}
        />
        {draft.permissions.useApprovalThreshold && operator && (
          <div className="mt-3">
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={draft.permissions.approvalThreshold}
              onChange={(event) =>
                update((d) => ({ ...d, permissions: { ...d.permissions, approvalThreshold: Number(event.target.value) } }))
              }
              className="w-full accent-[#0a7227]"
              aria-label="Approval threshold percent"
            />
            <p className="mt-1 text-[12px] text-grey">
              Spends above <span className="tnum font-mono text-ink">{draft.permissions.approvalThreshold}%</span> of the
              daily allowance pause at <span className="font-mono">awaiting_approval</span> until a human signs off.
            </p>
          </div>
        )}
      </div>

      <div className="flex items-start justify-between gap-4 rounded-xs border border-line bg-bone p-3">
        <div>
          <p className="font-mono text-[12px] text-ink">rwa — approved registry only</p>
          <p className="mt-0.5 text-[12px] text-grey">
            RWA interactions are hard-limited to the approved asset registry. This gate cannot be switched off from a
            manifest.
          </p>
        </div>
        <Badge tone="green">always on</Badge>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-xs border border-line bg-bone p-3">
        <div>
          <p className="font-mono text-[12px] text-ink">simulation before submission</p>
          <p className="mt-0.5 text-[12px] text-grey">Every write is simulated (estimateGas + eth_call) before signing. Not optional.</p>
        </div>
        <Badge tone="green">always on</Badge>
      </div>
    </div>
  );
}

export function WalletSection({ draft, update }: { draft: FinchDraft; update: Update }) {
  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Wallet mode">
        <OptionRow
          checked={draft.wallet.mode === "none"}
          onSelect={() => update((d) => ({ ...d, wallet: { ...d.wallet, mode: "none" } }))}
          title="None"
          description="No chain access at all."
        />
        <OptionRow
          checked={draft.wallet.mode === "observer"}
          onSelect={() => update((d) => ({ ...d, wallet: { ...d.wallet, mode: "observer" } }))}
          title="Observer"
          description="Read-only: balances, tokens, portfolios."
        />
        <OptionRow
          checked={draft.wallet.mode === "operator"}
          onSelect={() => update((d) => ({ ...d, wallet: { ...d.wallet, mode: "operator" } }))}
          title="Operator"
          description="Bounded writes via a restricted operator wallet."
        />
      </div>

      {draft.wallet.mode === "operator" && (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="native allowance / day — ETH" htmlFor="nb-perday" hint="Rolling 24h cap enforced by the policy engine and mirrored by OperatorBudget onchain.">
              <TextInput
                id="nb-perday"
                inputMode="decimal"
                value={draft.wallet.nativePerDay}
                onChange={(event) => update((d) => ({ ...d, wallet: { ...d.wallet, nativePerDay: event.target.value.replace(/[^0-9.]/g, "") } }))}
              />
            </Field>
            <Field label="per-transaction cap — ETH" htmlFor="nb-pertx" hint="Optional; defaults to the daily cap.">
              <TextInput
                id="nb-pertx"
                inputMode="decimal"
                value={draft.wallet.nativePerTx}
                onChange={(event) => update((d) => ({ ...d, wallet: { ...d.wallet, nativePerTx: event.target.value.replace(/[^0-9.]/g, "") } }))}
              />
            </Field>
          </div>
          <Field
            label="contract allowlist"
            htmlFor="nb-contracts"
            hint="One address per line. contract_write and swaps may only target these."
          >
            <TextArea
              id="nb-contracts"
              rows={3}
              spellCheck={false}
              value={draft.wallet.allowedContracts}
              placeholder={"0x…router\n0x…vault"}
              onChange={(event) => update((d) => ({ ...d, wallet: { ...d.wallet, allowedContracts: event.target.value } }))}
            />
          </Field>
          <Field
            label="recipient allowlist — optional"
            htmlFor="nb-recipients"
            hint="If set, transfers can only go to these addresses."
          >
            <TextArea
              id="nb-recipients"
              rows={2}
              spellCheck={false}
              value={draft.wallet.allowedRecipients}
              placeholder="0x…"
              onChange={(event) => update((d) => ({ ...d, wallet: { ...d.wallet, allowedRecipients: event.target.value } }))}
            />
          </Field>
          <p className="rounded-xs border border-gold/40 bg-gold/10 p-3 text-[12px] leading-relaxed text-gold-deep">
            The operator key never lives in a manifest, a browser, or this site. It is injected into the runtime
            environment that hatches this finch, and it is never the treasury key.
          </p>
        </>
      )}
    </div>
  );
}

export function TriggersSection({ draft, update }: { draft: FinchDraft; update: Update }) {
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex items-center justify-between rounded-xs border border-line bg-bone p-3">
        <div>
          <p className="font-mono text-[12px] text-ink">manual</p>
          <p className="mt-0.5 text-[12px] text-grey">Run on demand from the SDK or dashboard.</p>
        </div>
        <Badge tone="green">always on</Badge>
      </div>

      <div className="rounded-xs border border-line bg-bone p-3">
        <Toggle
          checked={draft.triggers.cronEnabled}
          onChange={(value) => update((d) => ({ ...d, triggers: { ...d.triggers, cronEnabled: value } }))}
          label="schedule (cron)"
        />
        {draft.triggers.cronEnabled && (
          <div className="mt-3 max-w-xs">
            <TextInput
              aria-label="Cron schedule"
              value={draft.triggers.cronSchedule}
              spellCheck={false}
              onChange={(event) => update((d) => ({ ...d, triggers: { ...d.triggers, cronSchedule: event.target.value } }))}
            />
            <p className="mt-1.5 text-[11.5px] text-grey">Standard 5-field cron. “*/15 * * * *” = every 15 minutes.</p>
          </div>
        )}
      </div>

      <div className="rounded-xs border border-line bg-bone p-3">
        <Toggle
          checked={draft.triggers.webhookEnabled}
          onChange={(value) => update((d) => ({ ...d, triggers: { ...d.triggers, webhookEnabled: value } }))}
          label="webhook"
        />
        {draft.triggers.webhookEnabled && (
          <div className="mt-3 max-w-xs">
            <TextInput
              aria-label="Webhook slug"
              value={draft.triggers.webhookSlug}
              placeholder="market-events"
              onChange={(event) =>
                update((d) => ({ ...d, triggers: { ...d.triggers, webhookSlug: slugify(event.target.value) } }))
              }
            />
            <p className="mt-1.5 text-[11.5px] text-grey">Exposed by your runtime at /hooks/&lt;slug&gt;.</p>
          </div>
        )}
      </div>

      <p className="text-[11.5px] text-grey">
        Cron and webhook triggers are <strong className="font-semibold text-ink">recorded in the manifest</strong> for
        your own runtime to act on — nothing on Finch schedules or receives them yet, and onchain event triggers arrive
        with the Flightpath indexer. Manual is the only trigger this product acts on today.
      </p>
    </div>
  );
}

export function BudgetSection({ draft, update }: { draft: FinchDraft; update: Update }) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <Field label="max actions / day" htmlFor="nb-actions">
        <NumberInput
          id="nb-actions"
          min={1}
          max={10000}
          value={draft.budget.maxActionsPerDay}
          onChange={(event) => update((d) => ({ ...d, budget: { ...d.budget, maxActionsPerDay: Number(event.target.value) } }))}
        />
      </Field>
      <Field label="compute credits / day" htmlFor="nb-credits" hint="Metered against the credits ledger; $FINCH settlement activates post-launch.">
        <NumberInput
          id="nb-credits"
          min={1}
          max={1000000}
          value={draft.budget.maxComputeCreditsPerDay}
          onChange={(event) =>
            update((d) => ({ ...d, budget: { ...d.budget, maxComputeCreditsPerDay: Number(event.target.value) } }))
          }
        />
      </Field>
      <Field label="tool steps / run" htmlFor="nb-steps">
        <NumberInput
          id="nb-steps"
          min={1}
          max={32}
          value={draft.budget.maxToolStepsPerRun}
          onChange={(event) => update((d) => ({ ...d, budget: { ...d.budget, maxToolStepsPerRun: Number(event.target.value) } }))}
        />
      </Field>
      <Field label="kill switch — consecutive failures" htmlFor="nb-kill" hint="The nest stops itself after this many failed tool steps in a row.">
        <NumberInput
          id="nb-kill"
          min={1}
          max={100}
          value={draft.budget.maxConsecutiveFailures}
          onChange={(event) =>
            update((d) => ({ ...d, budget: { ...d.budget, maxConsecutiveFailures: Number(event.target.value) } }))
          }
        />
      </Field>
    </div>
  );
}

export function DeploymentSection({ draft, update }: { draft: FinchDraft; update: Update }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Runtime">
      <OptionRow
        checked={draft.deployment.runtime === "self-hosted"}
        onSelect={() => update((d) => ({ ...d, deployment: { runtime: "self-hosted" } }))}
        title="Self-hosted"
        description="Export the manifest and run it yourself with @finch/sdk. Works today — see the docs for the entrypoint."
      />
      <OptionRow
        checked={draft.deployment.runtime === "finch-cloud"}
        onSelect={() => {}}
        disabled
        tag="waitlist"
        title="Finch Cloud"
        description="Managed nests on Finch infrastructure. Opens with the hosted runtime."
      />
    </div>
  );
}
