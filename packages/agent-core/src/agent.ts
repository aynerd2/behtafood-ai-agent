// The agent loop: one customer message in, timeline events out.
//
// Order of checks per message: length (500 characters), rate limit, the
// override check (scope.ts), the health guard, then up to 8 model calls, each
// preceded by a spend-cap check. Every tool result produces one timeline step,
// emitted only after the tool call has returned.
//
// Every turn ends with the model calling send_reply { text, in_scope }. If
// in_scope is false or missing, the model's text is dropped and a fixed,
// translated redirect is sent instead, and any approval card made this turn is
// cancelled. Every reply passes through sanitizeReply (no dashes, ₦2,500)
// before it is shown or saved.

import { randomUUID } from 'node:crypto';
import { isHealthAdviceRequest } from './guard';
import { checkImageDataUrl } from './image';
import { serverMessage } from './messages';
import { MAX_USER_CHARS, ScopeCounters, isOverrideAttempt, type ScopeEvent } from './scope';
import { sanitizeReply } from './text';
import { RateLimiter } from './limits';
import type { ChatMessage, ContentPart, ModelClient } from './model';
import { NudgeService } from './nudges';
import type { BehtafoodPort, CustomerContext } from './port';
import { LANGUAGE_REFUSAL, SYSTEM_PROMPT, isAssistantLanguage, systemPromptFor, type AssistantLanguage } from './prompt';
import { ProposalStore, type ProposalView } from './proposals';
import { MODEL_TOOL_SCHEMAS, SEND_REPLY, executeTool, newSessionState, type SessionState } from './tools';
import { UsageMeter } from './usage';

export const MAX_MODEL_CALLS_PER_MESSAGE = 8;

export type AgentErrorCode = 'rate_limited' | 'spend_cap' | 'call_cap' | 'model_unavailable' | 'bad_request';

export type TimelineEvent =
  | { type: 'session'; sessionId: string }
  | {
      type: 'step';
      tool: string;
      status: 'done' | 'failed';
      /** English label (older apps); newer apps translate labelKey + labelParams. */
      label: string;
      labelKey?: string;
      labelParams?: Record<string, string | number>;
      data?: unknown;
    }
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
  /** Counts of out-of-scope and blocked messages (never their text). */
  scope?: ScopeCounters;
  onScopeEvent?: (event: ScopeEvent) => void;
}

interface Session {
  id: string;
  customerId: string;
  messages: ChatMessage[];
  state: SessionState;
}


export class Agent {
  readonly port: BehtafoodPort;
  readonly model: ModelClient;
  readonly proposals: ProposalStore;
  readonly usage: UsageMeter;
  readonly nudges: NudgeService;
  readonly scope: ScopeCounters;
  readonly #onScope?: (event: ScopeEvent) => void;
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
    this.scope = opts.scope ?? new ScopeCounters();
    this.#onScope = opts.onScopeEvent;
  }

  #scopeEvent(event: ScopeEvent): void {
    this.scope.record(event);
    this.#onScope?.(event);
  }

  async handleMessage(
    ctx: CustomerContext,
    input: { sessionId?: string; text: string; imageDataUrl?: string; language?: AssistantLanguage },
    emit: (e: TimelineEvent) => void,
  ): Promise<{ sessionId: string }> {
    const session = this.#session(ctx, input.sessionId);
    emit({ type: 'session', sessionId: session.id });
    // The photo is used for this message only; afterwards the conversation keeps
    // a note instead, so it is never stored or sent to the model again.
    let photoMessage: ChatMessage | undefined;
    const finish = () => {
      if (photoMessage) photoMessage.content = `${text}\n[The customer sent a photo with this message. It is not kept.]`;
      const s = this.usage.session(session.id);
      emit({ type: 'done', modelCalls: s.modelCalls, costUsd: s.costUsd });
      return { sessionId: session.id };
    };

    const language = input.language ?? 'auto';
    if (!isAssistantLanguage(language)) {
      emit({ type: 'error', code: 'bad_request', message: LANGUAGE_REFUSAL });
      return finish();
    }
    const say = (key: Parameters<typeof serverMessage>[1], vars?: Record<string, string | number>) => serverMessage(language, key, vars);
    const image = input.imageDataUrl ? input.imageDataUrl : undefined;
    if (image && !checkImageDataUrl(image).ok) {
      emit({ type: 'error', code: 'bad_request', message: say('imageRefusal') });
      return finish();
    }
    const text = (input.text ?? '').trim() || (image ? 'Find me something like this.' : '');
    if (!text) {
      emit({ type: 'error', code: 'bad_request', message: say('empty') });
      return finish();
    }
    if (text.length > MAX_USER_CHARS) {
      this.#scopeEvent('too_long');
      emit({ type: 'error', code: 'bad_request', message: say('tooLong', { max: MAX_USER_CHARS }) });
      return finish();
    }
    if (!this.#limiter.hit(ctx.customerId)) {
      emit({ type: 'error', code: 'rate_limited', message: say('rateLimited') });
      return finish();
    }
    // An attempt to change the rules or read the prompt: the fixed redirect,
    // no model call, no tools, and nothing added to the conversation.
    if (isOverrideAttempt(text)) {
      this.#scopeEvent('override_blocked');
      emit({ type: 'reply', text: say('redirect') });
      return finish();
    }
    if (isHealthAdviceRequest(text)) {
      emit({ type: 'reply', text: say('healthRefusal') });
      return finish();
    }

    const content: string | ContentPart[] = image
      ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: image, detail: 'low' } }]
      : text;
    // The language applies to this message; the next one may choose another.
    session.messages[0] = { role: 'system', content: systemPromptFor(language) };
    const userMessage: ChatMessage = { role: 'user', content };
    session.messages.push(userMessage);
    if (image) photoMessage = userMessage;
    const proposedThisTurn: string[] = [];

    for (let call = 0; call < this.#maxCalls; call++) {
      const spend = this.usage.canSpend(ctx.customerId);
      if (!spend.ok) {
        emit({ type: 'error', code: 'spend_cap', message: say('spendCap') });
        return finish();
      }

      let response;
      try {
        response = await this.model.complete({ messages: session.messages, tools: MODEL_TOOL_SCHEMAS });
      } catch {
        emit({ type: 'error', code: 'model_unavailable', message: say('modelUnavailable') });
        return finish();
      }
      this.usage.record({ customerId: ctx.customerId, sessionId: session.id, model: this.model.model, usage: response.usage });
      const calls = response.message.tool_calls ?? [];
      const final = calls.find((tc) => tc.function.name === SEND_REPLY);
      if (calls.length === 0 || final) {
        // The turn is over. Only a send_reply with in_scope: true lets the
        // model's words through; anything else gets the fixed redirect.
        let args: { text?: unknown; in_scope?: unknown } = {};
        try {
          args = final ? JSON.parse(final.function.arguments || '{}') : {};
        } catch {
          args = {};
        }
        let shown: string;
        if (args.in_scope === true && typeof args.text === 'string') {
          shown = sanitizeReply(args.text) || say('fallbackReply');
        } else {
          this.#scopeEvent(final && args.in_scope === false ? 'out_of_scope' : 'missing_flag');
          for (const id of proposedThisTurn) this.proposals.cancel(ctx, id);
          shown = say('redirect');
        }
        // Saved as plain text: replaced words never stay in the history, and
        // other tool calls in that same message never run.
        session.messages.push({ role: 'assistant', content: shown });
        emit({ type: 'reply', text: shown });
        return finish();
      }
      session.messages.push(response.message);

      for (const tc of calls) {
        const outcome = await executeTool(tc.function.name, tc.function.arguments, {
          ctx,
          language,
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
          ...(outcome.labelKey ? { labelKey: outcome.labelKey } : {}),
          ...(outcome.labelParams ? { labelParams: outcome.labelParams } : {}),
          ...(outcome.data !== undefined ? { data: outcome.data } : {}),
        });
        if (outcome.proposal) {
          proposedThisTurn.push(outcome.proposal.proposalId);
          emit({ type: 'awaiting_approval', proposal: outcome.proposal });
        }
      }
    }

    emit({ type: 'error', code: 'call_cap', message: say('callCap') });
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
