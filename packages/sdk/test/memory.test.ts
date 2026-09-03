import assert from "node:assert/strict";
import { test } from "node:test";
import { describeAge, formatRecall, subjectOf, type MemoryItem } from "../src/memory.ts";

/**
 * The hive's two pure edges, pinned. Recall is keyed by subject, so getting
 * the subject wrong means a finch reads the wrong token's history. And the
 * injected label is what keeps a prior finding from being mistaken for a
 * fresh fact — its wording is part of the honesty contract.
 */

test("subjectOf finds the first address in an objective and preserves its case", () => {
  assert.equal(
    subjectOf("Full due diligence on token 0x39dBED3a2bd333467115dE45665cC57F813C4571 (PONS) on Robinhood Chain."),
    "0x39dBED3a2bd333467115dE45665cC57F813C4571",
  );
  assert.equal(subjectOf("compare 0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA and 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
});

test("subjectOf returns null when there is nothing to key on — never a guess", () => {
  assert.equal(subjectOf("How busy is the chain right now?"), null);
  assert.equal(subjectOf("0x1234 is too short"), null);
  assert.equal(subjectOf(""), null);
});

test("describeAge is coarse and honest", () => {
  const now = Date.parse("2026-09-03T12:00:00.000Z");
  assert.equal(describeAge("2026-09-03T11:59:40.000Z", now), "just now");
  assert.equal(describeAge("2026-09-03T11:15:00.000Z", now), "45m ago");
  assert.equal(describeAge("2026-09-03T05:00:00.000Z", now), "7h ago");
  assert.equal(describeAge("2026-08-30T12:00:00.000Z", now), "4d ago");
  assert.equal(describeAge("not a date", now), "unknown age");
});

test("formatRecall labels every item as a prior, unverified finding with its provenance", () => {
  const now = Date.parse("2026-09-03T12:00:00.000Z");
  const items: MemoryItem[] = [
    {
      role: "observation",
      content: "Top-10 holders control 38.21% of supply.",
      at: "2026-09-03T11:00:00.000Z",
      subject: "0x39dB",
      runId: "run_abc123def456",
      nestId: "network-dd",
      finch: "token-inspector",
      channel: "dd.token",
      source: "run",
    },
  ];
  const text = formatRecall(items, now);
  assert.match(text, /prior finding/);
  assert.match(text, /network-dd/);
  assert.match(text, /run_abc123/);
  assert.match(text, /1h ago/);
  assert.match(text, /unverified/i);
  assert.match(text, /Top-10 holders control 38\.21%/);
  // The rule that keeps memory from becoming the answer.
  assert.match(text, /lead|re-read|verify/i);
});

test("formatRecall of nothing is nothing — no header injected for an empty hive", () => {
  assert.equal(formatRecall([], Date.now()), "");
});
