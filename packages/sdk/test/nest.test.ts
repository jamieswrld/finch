import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveInstruction, validateTaskGraph, type NestManifest } from "../src/nest.ts";

const finch = (handle: string) => ({
  handle,
  name: handle,
  role: "",
  manifest: {
    schema: "finch.manifest/0.1" as const,
    identity: { name: handle, handle, description: "", instructions: "", glyph: "finch-01" },
    model: { provider: "hyperbolic", model: "m" },
    memory: { kind: "none" as const },
    tools: { flightpath: [], services: [] },
    permissions: { allowWrites: false, rwaApprovedOnly: true },
    wallet: { mode: "observer" as const, allowances: [], allowedContracts: [] },
    triggers: [{ kind: "manual" as const }],
    budget: {
      maxActionsPerDay: 1,
      maxComputeCreditsPerDay: 1,
      maxToolStepsPerRun: 1,
      killSwitch: { maxConsecutiveFailures: 1 },
    },
    deployment: { runtime: "self-hosted" as const, status: "draft" as const },
    supportedChains: [4663],
    endpoints: { mcp: [], api: [] },
  },
});

function graph(tasks: NestManifest["tasks"], handles = ["a", "b"]): NestManifest {
  return {
    schema: "nest.manifest/0.1",
    identity: { id: "t", name: "t", objective: "objective", description: "" },
    coordinator: { model: { provider: "hyperbolic", model: "m" }, instructions: "", synthesize: false },
    finches: handles.map(finch),
    tasks,
    executionPolicy: { mode: "preview", maxParallel: 3, maxTotalTokens: 1000, maxTaskFailures: 2, taskTimeoutMs: 1000 },
  } as NestManifest;
}

test("a well-formed DAG validates clean", () => {
  const issues = validateTaskGraph(
    graph([
      { id: "t1", finch: "a", title: "one", instruction: "go", dependsOn: [], outputChannel: "c1" },
      { id: "t2", finch: "b", title: "two", instruction: "{{c1}}", dependsOn: ["t1"], outputChannel: "c2" },
    ]),
  );
  assert.deepEqual(issues, []);
});

test("a cycle is rejected before anything executes", () => {
  const issues = validateTaskGraph(
    graph([
      { id: "t1", finch: "a", title: "one", instruction: "go", dependsOn: ["t2"], outputChannel: "c1" },
      { id: "t2", finch: "b", title: "two", instruction: "go", dependsOn: ["t1"], outputChannel: "c2" },
    ]),
  );
  assert.ok(issues.some((issue) => issue.code === "cycle"));
});

test("unknown finches and dependencies are rejected", () => {
  const issues = validateTaskGraph(
    graph([
      { id: "t1", finch: "ghost", title: "one", instruction: "go", dependsOn: [], outputChannel: "c1" },
      { id: "t2", finch: "a", title: "two", instruction: "go", dependsOn: ["nope"], outputChannel: "c2" },
    ]),
  );
  assert.ok(issues.some((issue) => issue.code === "unknown_finch"));
  assert.ok(issues.some((issue) => issue.code === "unknown_dependency"));
});

test("two tasks cannot publish the same channel", () => {
  const issues = validateTaskGraph(
    graph([
      { id: "t1", finch: "a", title: "one", instruction: "go", dependsOn: [], outputChannel: "same" },
      { id: "t2", finch: "b", title: "two", instruction: "go", dependsOn: [], outputChannel: "same" },
    ]),
  );
  assert.ok(issues.some((issue) => issue.code === "duplicate_channel"));
});

test("channel substitution injects upstream output", () => {
  const resolved = resolveInstruction("before {{chain.status}} after", { "chain.status": "BLOCK 42" });
  assert.equal(resolved, "before BLOCK 42 after");
});

test("an unresolved channel is left visible, never silently blanked", () => {
  const resolved = resolveInstruction("value: {{missing}}", {});
  assert.match(resolved, /\{\{missing\}\}/);
});
