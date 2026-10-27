// The agent loop: one customer message in, timeline events out.
//
// Order of checks per message: rate limit, topic guard, then up to 8 model
// calls, each preceded by a spend-cap check. Every tool result produces one
// timeline step, emitted only after the tool call has returned.

import { randomUUID } from 'node:crypto';
import { HEALTH_REFUSAL, isHealthAdviceRequest } from './guard';
import { RateLimiter } from './limits';
import type { ChatMessage, ContentPart, ModelClient } from './model';
import { NudgeService } from './nudges';
import type { BehtafoodPort, CustomerContext } from './port';
import { SYSTEM_PROMPT } from './prompt';
import { ProposalStore, type ProposalView } from './proposals';
import { TOOL_SCHEMAS, executeTool, newSessionState, type SessionState } from './tools';
import { UsageMeter } from './usage';

export const MAX_MODEL_CALLS_PER_MESSAGE = 8;

export type AgentErrorCode = 'rate_limited' | 'spend_cap' | 'call_cap' | 'model_unavailable' | 'bad_request';

export type TimelineEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'step'; tool: string; status: 'done' | 'failed'; label: string; data?: unknown }
  | { type: 'awaiting_approval'; proposal: ProposalView }
  | { type: 'reply'; text: string }
  | { type: 'error'; code: AgentErrorCode; message: string }
  | { type: 'done'; modelCalls: number; costUsd: number };

export interface AgentOptions {
  port: BehtafoodPort;
  model: ModelClient;
  proposals?: ProposalStore;
  usage?: UsageMeter;
  nudges?: NudgeService;
  messageLimiter?: RateLimiter;
  clock?: () => number;
  maxModelCallsPerMessage?: number;
}

interface Session {
  id: string;
  customerId: string;
  messages: ChatMessage[];
  state: SessionState;
}

const MAX_MESSAGE_CHARS = 1000;

export class Agent {
  readonly port: BehtafoodPort;
  readonly model: ModelClient;
  readonly proposals: ProposalStore;
  readonly usage: UsageMeter;
  readonly nudges: NudgeService;
  readonly #limiter: RateLimiter;
  readonly #maxCalls: number;
  readonly #sessions = new Map<string, Session>();

  constructor(opts: AgentOptions) {
    const clock = opts.clock ?? Date.now;
    this.port = opts.port;
    this.model = opts.model;
    this.proposals = opts.proposals ?? new ProposalStore(opts.port, { clock });
    this.usage = opts.usage ?? new UsageMeter({ clock });
    this.nudges = opts.nudges ?? new NudgeService(opts.port, clock);
    this.#limiter = opts.messageLimiter ?? new RateLimiter(10, 60_000, clock);
    this.#maxCalls = opts.maxModelCallsPerMessage ?? MAX_MODEL_CALLS_PER_MESSAGE;
  }

  async handleMessage(
    ctx: CustomerContext,
    input: { sessionId?: string; text: string; imageDataUrl?: string },
    emit: (e: TimelineEvent) => void,
  ): Promise<{ sessionId: string }> {
    const session = this.#session(ctx, input.sessionId);
    emit({ type: 'session', sessionId: session.id });
    const finish = () => {
      const s = this.usage.session(session.id);
      emit({ type: 'done', modelCalls: s.modelCalls, costUsd: s.costUsd });
      return { sessionId: session.id };
    };

    const text = (input.text ?? '').trim();
    if (!text || text.length > MAX_MESSAGE_CHARS) {
      emit({ type: 'error', code: 'bad_request', message: `Messages must be 1 to ${MAX_MESSAGE_CHARS} characters.` });
      return finish();
    }
    if (!this.#limiter.hit(ctx.customerId)) {
      emit({ type: 'error', code: 'rate_limited', message: 'Too many messages. Please wait a minute and try again.' });
      return finish();
    }
    if (isHealthAdviceRequest(text)) {
      emit({ type: 'reply', text: HEALTH_REFUSAL });
      return finish();
    }

    const content: string | ContentPart[] = input.imageDataUrl
      ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: input.imageDataUrl, detail: 'low' } }]
      : text;
    session.messages.push({ role: 'user', content });

    for (let call = 0; call < this.#maxCalls; call++) {
      const spend = this.usage.canSpend(ctx.customerId);
      if (!spend.ok) {
        emit({ type: 'error', code: 'spend_cap', message: 'The assistant has reached its spending limit for today. Please order from the menu as usual.' });
        return finish();
      }

      let response;
      try {
        response = await this.model.complete({ messages: session.messages, tools: TOOL_SCHEMAS });
      } catch {
        emit({ type: 'error', code: 'model_unavailable', message: 'The assistant is unavailable right now. Please try again shortly.' });
        return finish();
      }
      this.usage.record({ customerId: ctx.customerId, sessionId: session.id, model: this.model.model, usage: response.usage });
      session.messages.push(response.message);

      const calls = response.message.tool_calls ?? [];
      if (calls.length === 0) {
        const reply = typeof response.message.content === 'string' ? response.message.content.trim() : '';
        emit({ type: 'reply', text: reply || 'Sorry, I could not answer that. Please try again.' });
        return finish();
      }

      for (const tc of calls) {
        const outcome = await executeTool(tc.function.name, tc.function.arguments, {
          ctx,
          sessionId: session.id,
          state: session.state,
          port: this.port,
          proposals: this.proposals,
          nudges: this.nudges,
        });
        session.messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(outcome.result) });
        emit({
          type: 'step',
          tool: tc.function.name,
          status: outcome.ok ? 'done' : 'failed',
          label: outcome.label,
          ...(outcome.data !== undefined ? { data: outcome.data } : {}),
        });
        if (outcome.proposal) emit({ type: 'awaiting_approval', proposal: outcome.proposal });
      }
    }

    emit({ type: 'error', code: 'call_cap', message: 'That took too many steps, so I stopped. Please try a simpler request.' });
    return finish();
  }

  #session(ctx: CustomerContext, id?: string): Session {
    const existing = id ? this.#sessions.get(id) : undefined;
    if (existing && existing.customerId === ctx.customerId) return existing;
    const s: Session = {
      id: `ses_${randomUUID()}`,
      customerId: ctx.customerId,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }],
      state: newSessionState(),
    };
    this.#sessions.set(s.id, s);
    return s;
  }
}
