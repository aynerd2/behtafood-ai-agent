// Shared test fixtures: a controllable clock, scripted model clients, and an
// agent wired to the mock port.

import {
  Agent,
  RateLimiter,
  UsageMeter,
  type AgentOptions,
  type ChatMessage,
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
  type TimelineEvent,
  type Usage,
} from '@behtafood-agent/agent-core';
import { MockBehtafoodPort } from '../src/mockPort';

export const ADA = { customerId: 'cus_ada' };
export const TUNDE = { customerId: 'cus_tunde' };

export class FakeClock {
  now = Date.parse('2026-10-28T12:00:00Z');
  readonly fn = () => this.now;
  advance(ms: number) {
    this.now += ms;
  }
}

export function toolCall(name: string, args: Record<string, unknown>, id = `call_${name}_${Math.random().toString(36).slice(2, 8)}`) {
  return { id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } };
}

const SMALL_USAGE: Usage = { promptTokens: 100, cachedTokens: 0, completionTokens: 10, reasoningTokens: 0 };

/** A model whose every turn is decided by a function of the conversation so far. */
export class FnModel implements ModelClient {
  calls = 0;
  readonly requests: ModelRequest[] = [];
  constructor(
    readonly decide: (messages: ChatMessage[], call: number) => Omit<ChatMessage, 'role'>,
    readonly model = 'test-model',
    readonly usage: Usage = SMALL_USAGE,
  ) {}
  async complete(req: ModelRequest): Promise<ModelResponse> {
    this.calls += 1;
    this.requests.push(structuredClone(req));
    return { message: { role: 'assistant', ...this.decide(req.messages, this.calls) }, usage: this.usage };
  }
}

/** A model that plays back fixed turns in order, then replies "ok". */
export function sequenceModel(turns: Omit<ChatMessage, 'role'>[]): FnModel {
  return new FnModel((_m, call) => turns[call - 1] ?? { content: 'ok' });
}

export function harness(opts: { model: ModelClient; clock?: FakeClock } & Partial<Omit<AgentOptions, 'model' | 'clock' | 'port'>>) {
  const { clock: givenClock, ...rest } = opts;
  const clock = givenClock ?? new FakeClock();
  const port = new MockBehtafoodPort(clock.fn);
  const agent = new Agent({
    port,
    clock: clock.fn,
    usage: new UsageMeter({ clock: clock.fn }),
    messageLimiter: new RateLimiter(100, 60_000, clock.fn),
    ...rest,
  });
  const events: TimelineEvent[] = [];
  const send = async (text: string, sessionId?: string, ctx = ADA) => {
    const before = events.length;
    const r = await agent.handleMessage(ctx, { sessionId, text }, (e) => events.push(e));
    return { ...r, events: events.slice(before) };
  };
  return { clock, port, agent, events, send };
}
