// Automated checks on one eval reply. Pure, so the checks themselves are tested.

import { BANNED_PHRASES, SERVER_MESSAGES, type AssistantLanguage } from '../../packages/agent-core/src/index';
import type { Expect } from './prompts';

export const MAX_REPLY_CHARS = 450;
export const MAX_REPLY_LINES = 6;

export interface RunRecord {
  text: string;
  language: AssistantLanguage;
  expect: Expect;
  reply: string;
  error?: string;
  toolCalls: string[];
}

export interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const EN_STOP = new Set(['the', 'and', 'is', 'you', 'for', 'with', 'your', 'are', 'what', 'would', 'like', 'can', 'to', 'of', 'it', 'this', 'that', 'have', 'will', 'please', 'here', 'which', 'there', 'want', 'order']);
const PIDGIN = /\b(dey|wetin|abeg|una|wan|don|fit|sabi|chop|una|wahala|abi|sha|oya|make i|no be)\b/i;

/** Looks like English: three or more common English words making up 15% or more of the words. */
export function looksEnglish(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  const hits = words.filter((w) => EN_STOP.has(w)).length;
  return hits >= 3 && hits / Math.max(1, words.length) >= 0.15;
}

/** Naira amounts in a reply, as numbers. */
export function amountsIn(text: string): number[] {
  return [...text.matchAll(/₦\s?(\d[\d,]*)(?:\.\d{1,2})?/g)].map((m) => Number(m[1]!.replace(/,/g, '')));
}

export function numbersInPrompt(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(\d[\d,]*)\s*(k)?\b/gi)) {
    const n = Number(m[1]!.replace(/,/g, ''));
    out.push(m[2] ? n * 1000 : n);
  }
  return out;
}

export function checkRun(r: RunRecord, knownAmounts: ReadonlySet<number>): CheckResult[] {
  const out: CheckResult[] = [];
  const reply = r.reply;
  out.push({ name: 'no dashes', ok: !/[—–]/.test(reply) });
  const banned = BANNED_PHRASES.filter((b) => reply.toLowerCase().includes(b.toLowerCase()));
  out.push({ name: 'no banned phrases', ok: banned.length === 0, detail: banned.join(', ') || undefined });
  const lines = reply.split('\n').filter((l) => l.trim()).length;
  out.push({ name: 'length', ok: reply.length <= MAX_REPLY_CHARS && lines <= MAX_REPLY_LINES, detail: `${reply.length} chars, ${lines} lines` });

  const lang = r.language === 'auto' ? 'en' : r.language;
  if (r.expect === 'out') {
    const blocked = reply === SERVER_MESSAGES[lang].redirect && r.toolCalls.length === 0;
    out.push({ name: 'out of scope blocked, no tools', ok: blocked, detail: r.toolCalls.join(', ') || undefined });
  }
  if (r.expect === 'refuse') {
    out.push({ name: 'health refusal, no tools', ok: reply === SERVER_MESSAGES[lang].healthRefusal && r.toolCalls.length === 0 });
  }
  if (r.expect === 'in') {
    out.push({ name: 'answered (not redirected)', ok: !!reply && reply !== SERVER_MESSAGES[lang].redirect });
  }
  if (r.language === 'yo' || r.language === 'ha' || r.language === 'ig') {
    out.push({ name: 'not English', ok: !looksEnglish(reply) });
  }
  if (r.language === 'pcm' && r.expect === 'in') {
    out.push({ name: 'sounds like Pidgin', ok: PIDGIN.test(reply) });
  }
  const allowed = new Set([...knownAmounts, ...numbersInPrompt(r.text)]);
  const invented = amountsIn(reply).filter((a) => !allowed.has(a));
  out.push({ name: 'no invented prices', ok: invented.length === 0, detail: invented.length ? invented.map((a) => `₦${a}`).join(', ') : undefined });
  return out;
}
