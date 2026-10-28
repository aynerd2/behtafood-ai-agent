// HTTP server for the agent against the mock backend. Same routes the private
// backend will expose: /api/agent/chat (server-sent events), /api/agent/approve,
// /api/agent/check, /api/agent/cancel, /api/agent/usage. All of them 404 unless
// the agent is enabled.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  Agent,
  PortError,
  StageClock,
  delayThresholdsFromEnv,
  nudgeResultText,
  trackingSnapshot,
  type ModelClient,
  type NudgeParty,
  type OrderStatus,
  type TimelineEvent,
} from '@behtafood-agent/agent-core';
import { MockBehtafoodPort } from './mockPort';

export interface MockServerOptions {
  agentEnabled: boolean;
  model: ModelClient;
  clock?: () => number;
}

const MAX_BODY_BYTES = 6 * 1024 * 1024; // room for one compressed photo
const ORDER_STATUSES: OrderStatus[] = ['pending', 'accepted', 'preparing', 'ready', 'rider_assigned', 'picked_up', 'on_the_way', 'delivered', 'cancelled'];

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Body too large');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    const v: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Body must be a JSON object');
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function createMockServer(opts: MockServerOptions) {
  const port = new MockBehtafoodPort(opts.clock);
  const agent = new Agent({ port, model: opts.model, clock: opts.clock });
  const stageClock = new StageClock();
  const now = opts.clock ?? Date.now;

  const server = createServer(async (req, res) => {
    // Permissive CORS: this server only ever serves fake data (for the web demo).
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();

    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/health') return sendJson(res, 200, { ok: true, agentEnabled: opts.agentEnabled });
      if (!opts.agentEnabled || !(url.pathname.startsWith('/api/agent/') || url.pathname.startsWith('/mock/'))) {
        return sendJson(res, 404, { error: 'Not found' });
      }

      const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      const customer = port.customerByToken(token);
      if (!customer) return sendJson(res, 401, { error: 'Sign in required' });
      const ctx = { customerId: customer.id };

      if (req.method === 'POST' && url.pathname === '/api/agent/chat') {
        const body = await readJson(req);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        const emit = (e: TimelineEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
        await agent.handleMessage(
          ctx,
          {
            text: typeof body.message === 'string' ? body.message : '',
            sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
            imageDataUrl: typeof body.imageDataUrl === 'string' && body.imageDataUrl.startsWith('data:image/') ? body.imageDataUrl : undefined,
          },
          emit,
        );
        return void res.end();
      }

      if (req.method === 'POST' && url.pathname === '/api/agent/approve') {
        const body = await readJson(req);
        if (typeof body.proposalId !== 'string') throw new HttpError(400, 'proposalId is required');
        return sendJson(res, 200, await agent.proposals.approve(ctx, body.proposalId));
      }

      // Read-only: is there an order for this proposal? Asked before "Ask again".
      if (req.method === 'POST' && url.pathname === '/api/agent/check') {
        const body = await readJson(req);
        if (typeof body.proposalId !== 'string') throw new HttpError(400, 'proposalId is required');
        return sendJson(res, 200, await agent.proposals.check(ctx, body.proposalId));
      }

      if (req.method === 'POST' && url.pathname === '/api/agent/cancel') {
        const body = await readJson(req);
        if (typeof body.proposalId !== 'string') throw new HttpError(400, 'proposalId is required');
        return sendJson(res, 200, { cancelled: agent.proposals.cancel(ctx, body.proposalId) });
      }

      // Order tracking: the backend's status plus any delay. No model call.
      const status = url.pathname.match(/^\/api\/agent\/orders\/([\w-]+)\/status$/);
      if (req.method === 'GET' && status) {
        try {
          const info = await port.getOrderStatus(ctx, status[1]!);
          const snap = trackingSnapshot(info, stageClock, delayThresholdsFromEnv(process.env), now());
          return sendJson(res, 200, { ...snap, modelCalls: agent.usage.report(customer.id).modelCalls });
        } catch (err) {
          if (err instanceof PortError) throw new HttpError(404, 'Order not found');
          throw err;
        }
      }

      // A fixed, polite reminder to the restaurant or rider, at the customer's request.
      if (req.method === 'POST' && url.pathname === '/api/agent/nudge') {
        const body = await readJson(req);
        const party = body.party as NudgeParty;
        if (typeof body.orderId !== 'string' || (party !== 'vendor' && party !== 'rider')) throw new HttpError(400, 'orderId and party are required');
        const r = await agent.nudges.nudge(ctx, { orderId: body.orderId, party, customerConfirmed: true });
        return sendJson(res, 200, { sent: r.sent, ...(r.sent ? {} : { code: r.code }), text: nudgeResultText(party, r) });
      }

      if (req.method === 'GET' && url.pathname === '/api/agent/usage') {
        return sendJson(res, 200, agent.usage.report(customer.id));
      }

      // Demo controls standing in for the vendor and rider apps (fake data only).
      const advance = url.pathname.match(/^\/mock\/orders\/([\w-]+)\/advance$/);
      if (req.method === 'POST' && advance) {
        const body = await readJson(req);
        const status = body.status as OrderStatus;
        if (!ORDER_STATUSES.includes(status)) throw new HttpError(400, 'Unknown status');
        await port.getOrderStatus(ctx, advance[1]!); // own orders only
        port.advanceOrder(advance[1]!, status);
        return sendJson(res, 200, await port.getOrderStatus(ctx, advance[1]!));
      }

      return sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      if (res.headersSent) return void res.end();
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      return sendJson(res, 500, { error: 'Internal error' });
    }
  });

  return { server, port, agent };
}
