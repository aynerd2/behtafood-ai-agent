// Terminal chat against the mock backend. Plays the part of the app: it shows
// the timeline, and only YOU can approve an order.
//
//   npm run chat            interactive, offline scripted model
//   npm run chat -- --live  interactive, Muse Spark (needs META_API_KEY)
//   npm run demo            runs the PRD demo path automatically

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Agent, type OrderStatus, type ProposalView, type TimelineEvent } from '@behtafood-agent/agent-core';
import { MockBehtafoodPort } from './mockPort';
import { modelFromEnv } from './modelFromEnv';

const DEMO_ASK = 'Find me something filling around ₦3,000. I want rice and chicken delivered to my location.';
const ADA = { customerId: 'cus_ada' };
const naira = (n: number) => `₦${n.toLocaleString('en-NG')}`;

const port = new MockBehtafoodPort();
const model = modelFromEnv(process.argv);
const agent = new Agent({ port, model });
let sessionId: string | undefined;
let pending: ProposalView | undefined;

function show(e: TimelineEvent) {
  switch (e.type) {
    case 'step':
      console.log(`  ${e.status === 'done' ? '✓' : '✗'} ${e.label}`);
      break;
    case 'awaiting_approval':
      pending = e.proposal;
      console.log(`  ⏸ Waiting for your approval`);
      console.log(`    ${e.proposal.restaurantName}`);
      for (const l of e.proposal.lines) console.log(`    ${l.quantity} x ${l.name}  ${naira(l.lineTotalNaira)}`);
      console.log(`    Delivery ${naira(e.proposal.deliveryFeeNaira)}  Discount ${naira(e.proposal.discountNaira)}  Total ${naira(e.proposal.totalNaira)}`);
      break;
    case 'reply':
      console.log(`\nAssistant: ${e.text}\n`);
      break;
    case 'error':
      console.log(`  ! ${e.message}`);
      break;
    case 'session':
      sessionId = e.sessionId;
      break;
    case 'done':
      console.log(`  (${e.modelCalls} model calls so far, $${e.costUsd.toFixed(4)})`);
      break;
  }
}

async function say(text: string) {
  console.log(`You: ${text}`);
  await agent.handleMessage(ADA, { sessionId, text }, show);
}

async function approve(): Promise<string | undefined> {
  if (!pending) return void console.log('  Nothing to approve.');
  const r = await agent.proposals.approve(ADA, pending.proposalId);
  if (r.status === 'placed') {
    console.log(`  ✓ Order placed: ${r.order.reference}, ${naira(r.order.totalNaira)} paid from wallet (balance ${naira(port.wallet(ADA.customerId))})`);
    pending = undefined;
    return r.order.orderId;
  }
  if (r.status === 'price_changed') {
    pending = r.proposal;
    console.log(`  ! Price changed from ${naira(r.previousTotalNaira)} to ${naira(r.proposal.totalNaira)}. Approve again to accept.`);
  } else {
    console.log(`  ✗ Not placed: ${r.message}`);
  }
  return undefined;
}

async function demo() {
  console.log(`Model: ${model.model}\n`);
  await say(DEMO_ASK);
  await say('I will take option 1');
  console.log('\n[You tap Approve]');
  const orderId = await approve();
  if (!orderId) return;
  console.log('\n[The vendor and rider act; status updates arrive with zero model calls]');
  const before = agent.usage.report().modelCalls;
  for (const s of ['accepted', 'preparing', 'rider_assigned', 'on_the_way', 'delivered'] as OrderStatus[]) {
    port.advanceOrder(orderId, s);
    const st = await port.getOrderStatus(ADA, orderId);
    console.log(`  • ${st.reference}: ${st.status.replace(/_/g, ' ')}`);
  }
  const u = agent.usage.report();
  console.log(`\nModel calls during status updates: ${u.modelCalls - before}. Whole flow: ${u.modelCalls} model calls, $${u.costUsd.toFixed(4)}.`);
}

async function interactive() {
  console.log(`Behtafood assistant (mock data, model: ${model.model}). Commands: /approve /cancel /quit\n`);
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    for (;;) {
      const line = (await rl.question('> ')).trim();
      if (!line) continue;
      if (line === '/quit') break;
      if (line === '/approve') await approve();
      else if (line === '/cancel') console.log(pending && agent.proposals.cancel(ADA, pending.proposalId) ? '  Cancelled.' : '  Nothing to cancel.');
      else await agent.handleMessage(ADA, { sessionId, text: line }, show);
      if (pending) console.log('  Type /approve to place this order, or /cancel.');
    }
  } finally {
    rl.close();
  }
}

await (process.argv.includes('--demo') ? demo() : interactive());
