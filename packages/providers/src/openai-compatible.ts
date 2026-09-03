import { ProviderError, withRetries } from "./errors.ts";
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatStreamDelta,
  EmbedRequest,
  EmbedResponse,
  FinishReason,
  ModelProvider,
  ProviderCapabilities,
  ToolCall,
} from "./types.ts";

export interface OpenAICompatibleOptions {
  /** e.g. "https://api.hyperbolic.xyz/v1" */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Stable id recorded in manifests, e.g. "hyperbolic". */
  provider: string;
  label?: string;
  capabilities?: Partial<ProviderCapabilities>;
  /** Separate model used for /embeddings, when the provider serves one. */
  embeddingModel?: string;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function assertServerSide(provider: string): void {
  // API keys must never be constructed in a browser bundle.
  if (typeof (globalThis as { window?: unknown }).window !== "undefined") {
    throw new ProviderError(
      "unsupported",
      `${provider}: model providers are server-side only. Route model calls through an API route or the Finch runtime.`,
    );
  }
}

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  const wire: Record<string, unknown> = { role: message.role, content: message.content };
  if (message.toolCalls?.length) {
    wire.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    }));
  }
  if (message.toolCallId) wire.tool_call_id = message.toolCallId;
  if (message.name) wire.name = message.name;
  return wire;
}

function parseFinishReason(reason: unknown): FinishReason {
  if (reason === "stop" || reason === "length" || reason === "tool_calls" || reason === "content_filter") return reason;
  return "unknown";
}

function parseToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  const calls: ToolCall[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const fn = record.function as Record<string, unknown> | undefined;
    if (!fn || typeof fn.name !== "string") continue;
    calls.push({
      id: typeof record.id === "string" ? record.id : `call_${calls.length}`,
      name: fn.name,
      arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
    });
  }
  return calls;
}

/**
 * Generic adapter for any OpenAI-compatible chat completions API.
 * `hyperbolic()` is built on this; so can any future provider — the escape
 * hatch that keeps Finch from being permanently coupled to a single vendor.
 */
export function openAICompatible(options: OpenAICompatibleOptions): ModelProvider {
  const {
    baseUrl,
    apiKey,
    model,
    provider,
    label = `${options.provider}/${options.model}`,
    timeoutMs = 120_000,
    fetchImpl = fetch,
  } = options;

  const capabilities: ProviderCapabilities = {
    toolCalling: true,
    streaming: true,
    embeddings: Boolean(options.embeddingModel),
    ...options.capabilities,
  };

  async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    assertServerSide(provider);
    if (!apiKey) {
      throw new ProviderError("auth", `${provider}: missing API key. Set the provider key in server environment variables.`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("provider timeout")), timeoutMs);
    const onOuterAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onOuterAbort, { once: true });
    try {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
          ...options.defaultHeaders,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw ProviderError.fromStatus(response.status, await response.text().catch(() => ""));
      }
      return response;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (controller.signal.aborted) {
        throw new ProviderError("timeout", `${provider}: request aborted or timed out after ${timeoutMs}ms`, { cause: error });
      }
      throw new ProviderError("network", `${provider}: network failure — ${(error as Error).message}`, { cause: error });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onOuterAbort);
    }
  }

  return {
    info: { provider, model, label, capabilities },

    async chat(request: ChatRequest): Promise<ChatResponse> {
      const body: Record<string, unknown> = {
        model,
        messages: request.messages.map(toWireMessage),
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stop: request.stop,
      };
      if (request.tools?.length) {
        body.tools = request.tools.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        }));
      }
      if (request.json) body.response_format = { type: "json_object" };

      return withRetries(async () => {
        const response = await post("/chat/completions", body, request.signal);
        const payload = (await response.json()) as Record<string, unknown>;
        const choices = payload.choices as Array<Record<string, unknown>> | undefined;
        const choice = choices?.[0];
        if (!choice) throw new ProviderError("parse", `${provider}: response contained no choices`);
        const message = (choice.message ?? {}) as Record<string, unknown>;
        const usage = (payload.usage ?? {}) as Record<string, unknown>;
        return {
          id: typeof payload.id === "string" ? payload.id : "unknown",
          model: typeof payload.model === "string" ? payload.model : model,
          content: typeof message.content === "string" ? message.content : null,
          toolCalls: parseToolCalls(message.tool_calls),
          finishReason: parseFinishReason(choice.finish_reason),
          usage: {
            inputTokens: Number(usage.prompt_tokens ?? 0),
            outputTokens: Number(usage.completion_tokens ?? 0),
          },
        } satisfies ChatResponse;
      });
    },

    async *stream(request: ChatRequest): AsyncIterable<ChatStreamDelta> {
      const body: Record<string, unknown> = {
        model,
        messages: request.messages.map(toWireMessage),
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: true,
      };
      const response = await post("/chat/completions", body, request.signal);
      if (!response.body) {
        throw new ProviderError("parse", `${provider}: streaming response had no body`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") {
              yield { done: true };
              return;
            }
            try {
              const chunk = JSON.parse(data) as Record<string, unknown>;
              const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
              const delta = (choices?.[0]?.delta ?? {}) as Record<string, unknown>;
              if (typeof delta.content === "string" && delta.content.length > 0) {
                yield { content: delta.content, done: false };
              }
            } catch {
              // Ignore malformed keep-alive frames.
            }
          }
        }
        yield { done: true };
      } finally {
        reader.releaseLock();
      }
    },

    async embed(request: EmbedRequest): Promise<EmbedResponse> {
      if (!options.embeddingModel) {
        throw new ProviderError("unsupported", `${provider}: no embedding model configured for this provider instance`);
      }
      return withRetries(async () => {
        const response = await post("/embeddings", { model: options.embeddingModel, input: request.input }, request.signal);
        const payload = (await response.json()) as Record<string, unknown>;
        const data = payload.data as Array<Record<string, unknown>> | undefined;
        if (!data) throw new ProviderError("parse", `${provider}: embeddings response had no data`);
        const usage = (payload.usage ?? {}) as Record<string, unknown>;
        return {
          embeddings: data.map((item) => (item.embedding as number[]) ?? []),
          model: options.embeddingModel as string,
          usage: { inputTokens: Number(usage.prompt_tokens ?? 0) },
        } satisfies EmbedResponse;
      });
    },
  };
}
