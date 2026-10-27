// HTTP client for the agent endpoints. Every call carries the customer's own
// login token; the app never holds any model key.
//
//   POST {api}/agent/chat                   -> { runId, sessionId }
//   GET  {api}/agent/runs/:id/events?after=N -> { finished, events }
//   POST {api}/agent/approve                -> ApproveResult
//   POST {api}/agent/cancel                 -> { cancelled }

import type { ApproveResult, StoredEvent } from './types';

export type AgentApiErrorKind = 'signed_out' | 'unavailable' | 'rate_limited' | 'network' | 'server' | 'bad_request';

export class AgentApiError extends Error {
  constructor(
    readonly kind: AgentApiErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AgentApiError';
  }
}

export interface AgentClient {
  chat(text: string, sessionId?: string): Promise<{ runId: string; sessionId: string | null }>;
  events(runId: string, after: number): Promise<{ finished: boolean; events: StoredEvent[] }>;
  approve(proposalId: string): Promise<ApproveResult>;
  cancel(proposalId: string): Promise<{ cancelled: boolean }>;
}

export interface AgentClientOptions {
  /** The app's API base, e.g. http://192.168.0.2:7001/api */
  apiUrl: string;
  /** The signed-in customer's token, or null when signed out. */
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_MESSAGES: Record<AgentApiErrorKind, string> = {
  signed_out: 'Please sign in again to use the assistant.',
  unavailable: 'The assistant is not available right now.',
  rate_limited: 'Too many requests. Wait a moment and try again.',
  network: 'You seem to be offline. Check your connection and try again.',
  server: 'Something went wrong on our side. Please try again.',
  bad_request: 'That request could not be handled.',
};

function kindFor(status: number): AgentApiErrorKind {
  if (status === 401 || status === 403) return 'signed_out';
  if (status === 404 || status === 503) return 'unavailable';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'bad_request';
}

export function createAgentClient(opts: AgentClientOptions): AgentClient {
  const base = `${opts.apiUrl.replace(/\/+$/, '')}/agent`;
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const token = await opts.getToken();
    if (!token) throw new AgentApiError('signed_out', DEFAULT_MESSAGES.signed_out);
    // AbortSignal.timeout is not available on every React Native engine.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: abort.signal,
      });
    } catch {
      throw new AgentApiError('network', DEFAULT_MESSAGES.network);
    } finally {
      clearTimeout(timer);
    }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const kind = kindFor(res.status);
      // Server text is shown only where it is meant for the customer.
      const useServerText = (kind === 'bad_request' || kind === 'rate_limited') && typeof json?.message === 'string';
      throw new AgentApiError(kind, useServerText ? json.message : DEFAULT_MESSAGES[kind], res.status);
    }
    return json?.data as T;
  }

  return {
    chat: (text, sessionId) => request('POST', '/chat', { text, ...(sessionId ? { sessionId } : {}) }),
    events: (runId, after) => request('GET', `/runs/${encodeURIComponent(runId)}/events?after=${after}`),
    approve: (proposalId) => request('POST', '/approve', { proposalId }),
    cancel: (proposalId) => request('POST', '/cancel', { proposalId }),
  };
}
