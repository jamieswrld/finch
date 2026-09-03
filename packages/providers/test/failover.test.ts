import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { ResolvedProvider } from "../src/catalog.ts";
import { ProviderError } from "../src/errors.ts";
import { clearDeadProviders, withFailover } from "../src/failover.ts";
import type { ChatResponse, ModelProvider } from "../src/types.ts";

/**
 * The failover contract, pinned: advance on failures that belong to the
 * provider — a rate limit, an outage, a rejected credential — and never on
 * ones that belong to the request. Failing over on a bad request would mask
 * a real error as a different provider's answer; not failing over on a 429
 * or a 401 wastes an idle key.
 */

beforeEach(() => clearDeadProviders());

const answer = (from: string): ChatResponse =>
  ({ content: `answer from ${from}`, usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop", toolCalls: [] }) as unknown as ChatResponse;

function fake(id: string, behaviour: () => Promise<ChatResponse>): ResolvedProvider {
  const provider: ModelProvider = {
    info: { provider: id, model: "m", label: id, capabilities: { tools: true, json: true, streaming: false, embeddings: false } as never },
    chat: behaviour,
  };
  return { provider, spec: { id } as never, model: "m" };
}

const request = { messages: [{ role: "user", content: "hi" }] } as never;

test("a rate-limited primary hands the request to the next configured provider", async () => {
  let primaryCalls = 0;
  const chain = [
    fake("groq", async () => {
      primaryCalls += 1;
      throw new ProviderError("rate_limit", "provider rate limit (429): slow down", { status: 429 });
    }),
    fake("openrouter", async () => answer("openrouter")),
  ];
  const provider = withFailover(chain);
  const result = await provider.chat(request);
  assert.equal(result.content, "answer from openrouter");
  assert.equal(primaryCalls, 1);
  assert.match(provider.info.label, /failover: openrouter/);
});

test("a non-rate-limit error is NOT retried elsewhere — it is the caller's problem on every provider", async () => {
  let secondaryCalls = 0;
  const chain = [
    fake("groq", async () => {
      throw new ProviderError("bad_request", "provider rejected request (400): model does not exist", { status: 400 });
    }),
    fake("openrouter", async () => {
      secondaryCalls += 1;
      return answer("openrouter");
    }),
  ];
  await assert.rejects(withFailover(chain).chat(request), (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.code, "bad_request");
    return true;
  });
  assert.equal(secondaryCalls, 0, "the fallback must never see a request the primary rejected as malformed");
});

test("when every provider is rate limited, the error names every provider and what each said", async () => {
  const chain = [
    fake("groq", async () => {
      throw new ProviderError("rate_limit", "groq: 429", { status: 429 });
    }),
    fake("together", async () => {
      throw new ProviderError("rate_limit", "together: 429", { status: 429 });
    }),
  ];
  await assert.rejects(withFailover(chain).chat(request), (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.code, "rate_limit");
    // The point: BOTH providers are named, so nobody reads "together failed"
    // and misses that groq had already run dry.
    assert.match(error.message, /all 2 providers failed/);
    assert.match(error.message, /groq → rate_limit 429/);
    assert.match(error.message, /together → rate_limit 429/);
    return true;
  });
});

test("an empty chain is refused loudly rather than producing a provider that cannot answer", () => {
  assert.throws(() => withFailover([]), /no providers configured/);
});

test("a rejected credential advances to the next provider AND is remembered as dead", async () => {
  // A 401 is a fact about the key, not the request. The first call should
  // fail over; the second should not even touch the dead provider.
  let primaryCalls = 0;
  const chain = [
    fake("together", async () => {
      primaryCalls += 1;
      throw new ProviderError("auth", "provider rejected credentials (401)", { status: 401 });
    }),
    fake("openrouter", async () => answer("openrouter")),
  ];
  const provider = withFailover(chain);
  assert.equal((await provider.chat(request)).content, "answer from openrouter");
  assert.equal(primaryCalls, 1);
  assert.equal((await provider.chat(request)).content, "answer from openrouter");
  assert.equal(primaryCalls, 1, "a provider that rejected the key must be skipped, not retried every task");
});
