// Opt-in evaluation against the real model. Costs money; nothing runs without
// META_API_KEY in the environment (the key is never printed).
//
//   npm run agent:eval -- --dry            plan and cost estimate only
//   npm run agent:eval                     run, stop at $2.00 spent
//   npm run agent:eval -- --max-usd 3      a higher cap (ask the owner first)
//   npm run agent:eval -- --limit 10       the first 10 runs only
//   npm run agent:eval -- --only u9,t1.yo --out eval-rerun.md   chosen runs, own report
//
// Writes docs/eval-report.md: each prompt and reply for human review, plus the
// automated checks (checks.ts). Runs against the mock API, so prices are known.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Agent, MetaModelClient, MODEL_PRICES, RateLimiter, UsageMeter,
  type AssistantLanguage, type ReasoningEffort, type TimelineEvent,
} from '../../packages/agent-core/src/index';
import { MockBehtafoodPort } from '../../apps/mock-api/src/mockPort';
import { seedCustomers, seedMenu, seedRestaurants } from '../../apps/mock-api/src/data';
import { checkRun, type RunRecord } from './checks';
import { PROMPTS } from './prompts';

const LANGS: AssistantLanguage[] = ['en', 'pcm', 'yo', 'ha', 'ig'];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Every amount the mock data can honestly produce: prices, extras, fees and their simple sums. */
function knownAmounts(): Set<number> {
  const items = seedMenu();
  // Delivery fees to every saved address: base, distance part, and the two together.
  const distanceParts = seedCustomers().flatMap((c) => (c.addresses ?? []).map((a) => a.distanceFeeNaira));
  const fees = [...new Set(seedRestaurants().flatMap((r) => [r.deliveryFeeNaira, ...distanceParts, ...distanceParts.map((d) => r.deliveryFeeNaira + d)]))];
  const unit = new Set<number>();
  for (const m of items) {
    unit.add(m.priceNaira);
    const extras = (m.choices ?? []).flatMap((g) => g.options.map((o) => o.priceNaira));
    for (const e of extras) {
      unit.add(e);
      unit.add(m.priceNaira + e);
    }
  }
  const out = new Set<number>([...unit, ...fees, 0]);
  const units = [...unit];
  for (const a of units) {
    for (const q of [2, 3]) out.add(a * q);
    for (const f of fees) out.add(a + f);
    for (const b of units) {
      out.add(a + b);
      for (const f of fees) out.add(a + b + f);
    }
  }
  return out;
}

interface Planned {
  id: string;
  category: string;
  text: string;
  expect: RunRecord['expect'];
  language: AssistantLanguage;
}

function plan(): Planned[] {
  const runs: Planned[] = PROMPTS.map((p) => ({ id: p.id, category: p.category, text: p.text, expect: p.expect, language: 'auto' as AssistantLanguage }));
  for (const p of PROMPTS.filter((x) => x.allLanguages)) {
    for (const l of LANGS) runs.push({ id: `${p.id}.${l}`, category: p.category, text: p.text, expect: p.expect, language: l });
  }
  return runs;
}

/** A deliberately cautious estimate: 2.5 model calls a run, 6,000 input tokens a call (half cached), 400 output. */
export function estimateUsd(runs: number, model: string): number {
  const price = MODEL_PRICES[model] ?? { input: 1.25, cached: 0.15, output: 4.25 };
  const perCall = (3000 * price.input + 3000 * price.cached + 400 * price.output) / 1e6;
  return runs * 2.5 * perCall;
}

async function main() {
  // --only id,id: re-run chosen runs (e.g. the ones that failed); ids as in the report ("t1.yo", "u9").
  const only = arg('--only')?.split(',').map((x) => x.trim()).filter(Boolean);
  const runs = plan()
    .filter((r) => !only || only.includes(r.id))
    .slice(0, arg('--limit') ? Number(arg('--limit')) : undefined);
  const model = process.env.AGENT_MODEL || 'muse-spark-1.3';
  const cap = Number(arg('--max-usd') ?? 2);
  const estimate = estimateUsd(runs.length, model);
  console.log(`${PROMPTS.length} prompts; ${runs.length} runs (each prompt once with Auto, ${PROMPTS.filter((p) => p.allLanguages).length} also in all 5 languages).`);
  console.log(`Model ${model}. Estimated cost: about $${estimate.toFixed(2)}. Hard stop at $${cap.toFixed(2)}.`);
  if (process.argv.includes('--dry')) return;
  const apiKey = process.env.META_API_KEY;
  if (!apiKey) {
    console.error('Set META_API_KEY in the environment to run the evaluation (it is never printed).');
    process.exit(1);
  }

  const client = new MetaModelClient({ apiKey, model, reasoningEffort: (process.env.AGENT_REASONING_EFFORT as ReasoningEffort) || 'low' });
  const amounts = knownAmounts();
  const records: (RunRecord & Planned & { checks: ReturnType<typeof checkRun>; costUsd: number })[] = [];
  let spent = 0;
  let stopped = false;

  for (const run of runs) {
    if (spent >= cap) {
      stopped = true;
      break;
    }
    // A fresh agent per run: no history, generous limits, the real model.
    const usage = new UsageMeter({ customerDailyCapUsd: 100, globalDailyCapUsd: 100 });
    const agent = new Agent({ port: new MockBehtafoodPort(), model: client, usage, messageLimiter: new RateLimiter(1000, 60_000) });
    const events: TimelineEvent[] = [];
    try {
      await agent.handleMessage({ customerId: 'cus_ada' }, { text: run.text, language: run.language }, (e) => events.push(e));
    } catch (err) {
      events.push({ type: 'error', code: 'model_unavailable', message: String((err as Error).message) });
    }
    const done = events.find((e) => e.type === 'done') as { costUsd: number } | undefined;
    const cost = done?.costUsd ?? 0;
    spent += cost;
    const reply = (events.find((e) => e.type === 'reply') as { text: string } | undefined)?.text ?? '';
    const error = (events.find((e) => e.type === 'error') as { message: string } | undefined)?.message;
    const record: RunRecord = {
      text: run.text,
      language: run.language,
      expect: run.expect,
      reply: reply || '',
      ...(error ? { error } : {}),
      toolCalls: events.filter((e) => e.type === 'step').map((e) => (e as { tool: string }).tool),
    };
    const checks = checkRun(record, amounts);
    records.push({ ...run, ...record, checks, costUsd: cost });
    const failed = checks.filter((c) => !c.ok).map((c) => c.name);
    console.log(`${run.id.padEnd(8)} ${failed.length ? 'FAIL ' + failed.join('; ') : 'ok'}  ($${spent.toFixed(3)})`);
  }

  const total = records.length;
  const allChecks = records.flatMap((r) => r.checks);
  const byName = new Map<string, { ok: number; all: number }>();
  for (const c of allChecks) {
    const v = byName.get(c.name) ?? { ok: 0, all: 0 };
    v.all += 1;
    if (c.ok) v.ok += 1;
    byName.set(c.name, v);
  }
  const lines: string[] = [];
  lines.push('# Assistant evaluation report');
  lines.push('');
  lines.push(`Run ${new Date().toISOString()} against the mock API with \`${model}\`. ${total} of ${runs.length} planned runs completed${stopped ? ` (stopped at the $${cap.toFixed(2)} cap)` : ''}.`);
  lines.push(`Cost: **$${spent.toFixed(3)}**.`);
  lines.push('');
  lines.push('## Automated checks');
  lines.push('');
  lines.push('| Check | Passed |');
  lines.push('|---|---|');
  for (const [name, v] of byName) lines.push(`| ${name} | ${v.ok} / ${v.all} |`);
  lines.push('');
  lines.push('## Every prompt and reply (for human review)');
  lines.push('');
  for (const r of records) {
    const failed = r.checks.filter((c) => !c.ok);
    lines.push(`### ${r.id} · ${r.category} · language: ${r.language} · expected: ${r.expect}`);
    lines.push('');
    lines.push(`**Customer:** ${r.text}`);
    lines.push('');
    lines.push(`**Assistant:** ${r.reply ? r.reply.replace(/\n/g, '  \n') : `_(no reply${r.error ? `: ${r.error}` : ''})_`}`);
    lines.push('');
    lines.push(`Tools: ${r.toolCalls.join(', ') || 'none'} · Checks: ${failed.length ? failed.map((c) => `FAIL ${c.name}${c.detail ? ` (${c.detail})` : ''}`).join('; ') : 'all passed'}`);
    lines.push('');
  }
  // --out name.md writes elsewhere in docs/ (a re-run keeps the full report).
  const file = join(import.meta.dirname, '..', '..', 'docs', arg('--out') ?? 'eval-report.md');
  writeFileSync(file, lines.join('\n'));
  console.log(`\nWrote ${file}. Spent $${spent.toFixed(3)}.`);
  if (stopped) console.log(`Stopped at the $${cap.toFixed(2)} cap. Re-run with --max-usd only with the owner's OK.`);
}

void main();
