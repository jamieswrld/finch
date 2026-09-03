/**
 * @finch/providers — model layer abstraction.
 *
 * Finch is never permanently coupled to one model provider. Every provider
 * (Hyperbolic today; anything OpenAI-compatible tomorrow) implements the same
 * `ModelProvider` interface, so an agent's manifest only records a provider id
 * and model name — the runtime resolves the rest.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  /** Provider-assigned id, echoed back in the tool result message. */
  id: string;
  name: string;
  /** JSON-encoded arguments, exactly as returned by the model. */
  arguments: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Present on assistant messages that requested tool calls. */
  toolCalls?: ToolCall[];
  /** Present on tool messages: the id of the call being answered. */
  toolCallId?: string;
  name?: string;
}

/** JSON Schema (draft-07 subset) describing a tool's input. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  /** Ask for a JSON object response when the provider supports it. */
  json?: boolean;
  stop?: string[];
  signal?: AbortSignal;
}

export type FinishReason = "stop" | "length" | "tool_calls" | "content_filter" | "unknown";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResponse {
  id: string;
  model: string;
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: TokenUsage;
}

export interface ChatStreamDelta {
  content?: string;
  done: boolean;
}

export interface EmbedRequest {
  input: string[];
  signal?: AbortSignal;
}

export interface EmbedResponse {
  embeddings: number[][];
  model: string;
  usage: Pick<TokenUsage, "inputTokens">;
}

export interface ProviderCapabilities {
  toolCalling: boolean;
  streaming: boolean;
  embeddings: boolean;
}

export interface ModelProviderInfo {
  /** Stable provider id recorded in Finch manifests, e.g. "hyperbolic". */
  provider: string;
  /** Model identifier as the provider knows it. */
  model: string;
  label: string;
  capabilities: ProviderCapabilities;
}

/**
 * The single interface the Finch runtime talks to. Implementations must be
 * server-side only — API keys never reach a browser or an agent's own context.
 */
export interface ModelProvider {
  readonly info: ModelProviderInfo;
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream?(request: ChatRequest): AsyncIterable<ChatStreamDelta>;
  embed?(request: EmbedRequest): Promise<EmbedResponse>;
}

/** Serializable reference stored in a Finch manifest. */
export interface ModelRef {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}
