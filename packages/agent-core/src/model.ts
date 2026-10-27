// Model clients. The agent talks to any ModelClient; MetaModelClient is the real
// one (Meta Model API, Chat Completions, plain function calling). The API key is
// passed in by server code and is never logged or returned.

import type { Usage } from './usage';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolSchema {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ModelRequest {
  messages: ChatMessage[];
  tools: ToolSchema[];
}

export interface ModelResponse {
  message: ChatMessage;
  usage: Usage;
}

export interface ModelClient {
  readonly model: string;
  complete(req: ModelRequest): Promise<ModelResponse>;
}

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export class ModelError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

/** The only host this client ever contacts. */
export const META_API_BASE = 'https://api.meta.ai/v1';

export interface MetaModelClientOptions {
  apiKey: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  /** Stable per app, so the system prompt and tool list share a cache prefix. */
  promptCacheKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class MetaModelClient implements ModelClient {
  readonly model: string;
  readonly #apiKey: string;
  readonly #effort: ReasoningEffort;
  readonly #cacheKey: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(opts: MetaModelClientOptions) {
    if (!opts.apiKey) throw new Error('MetaModelClient needs an API key');
    this.#apiKey = opts.apiKey;
    this.model = opts.model ?? 'muse-spark-1.3';
    this.#effort = opts.reasoningEffort ?? 'low';
    this.#cacheKey = opts.promptCacheKey ?? 'behtafood-agent';
    this.#timeoutMs = opts.timeoutMs ?? 60_000;
    this.#fetch = opts.fetchImpl ?? fetch;
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const res = await this.#fetch(`${META_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.#apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        reasoning_effort: this.#effort,
        prompt_cache_key: this.#cacheKey,
        messages: req.messages,
        tools: req.tools,
      }),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!res.ok) {
      // Status only. The body can echo request details, so it is not surfaced.
      throw new ModelError(res.status, `Meta Model API returned HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: ChatMessage }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };
    const message = data.choices?.[0]?.message;
    if (!message) throw new ModelError(502, 'Meta Model API returned no message');
    const u = data.usage ?? {};
    return {
      message: { role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls },
      usage: {
        promptTokens: u.prompt_tokens ?? 0,
        cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
        completionTokens: u.completion_tokens ?? 0,
        reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
      },
    };
  }
}
