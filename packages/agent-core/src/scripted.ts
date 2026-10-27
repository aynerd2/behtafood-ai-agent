// ScriptedDemoModel: a deterministic, offline stand-in for the real model, so a
// fresh clone runs the demo path with no API key. It reads the conversation and
// the tool results and picks the next step with simple rules. It is clearly
// not intelligent and only handles English demo-style requests; the real
// agent runs on MetaModelClient.

import type { ChatMessage, ModelClient, ModelRequest, ModelResponse, ToolCall } from './model';
import { ZERO_USAGE } from './usage';

const FOOD_WORDS = ['rice', 'jollof', 'fried', 'chicken', 'turkey', 'beef', 'shawarma', 'amala', 'ewedu', 'yam', 'egusi', 'chops', 'zobo', 'plantain', 'suya', 'beans', 'soup', 'snacks', 'drink'];

interface MenuResultItem {
  id: string;
  name: string;
  price_naira: number;
  choices?: { group: string; required: boolean; options: { name: string; extra_price_naira: number }[] }[];
}

interface Option {
  restaurantId: string;
  restaurantName: string;
  items: { id: string; name: string; price: number; choices: { group: string; option: string }[] }[];
  food: number;
  fee: number;
  total: number;
}

const naira = (n: number) => `₦${n.toLocaleString('en-NG')}`;

function textOf(m: ChatMessage | undefined): string {
  if (!m) return '';
  if (typeof m.content === 'string') return m.content;
  return (m.content ?? []).map((p) => (p.type === 'text' ? p.text : '')).join(' ');
}

export function parseBudgetNaira(text: string): number | undefined {
  const t = text.toLowerCase().replace(/,/g, '');
  const k = t.match(/(\d+(?:\.\d+)?)\s?k\b/);
  if (k) return Math.round(Number(k[1]) * 1000);
  const n = t.match(/(?:₦|ngn|n)\s?(\d{3,7})\b/) ?? t.match(/\b(\d{3,7})\s*(?:naira)?\b/);
  return n ? Number(n[1]) : undefined;
}

function parsePick(text: string): number | undefined {
  const t = text.toLowerCase();
  const m = t.match(/\b([1-3])\b/);
  if (m) return Number(m[1]);
  const words: Record<string, number> = { first: 1, one: 1, second: 2, two: 2, third: 3, three: 3 };
  for (const [w, n] of Object.entries(words)) if (new RegExp(`\\b${w}\\b`).test(t)) return n;
  return undefined;
}

let callSeq = 0;
const call = (name: string, args: unknown): ToolCall => ({ id: `scripted_${++callSeq}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });

/** Tool results in `messages`, in order, paired with the tool name and arguments that produced them. */
function toolResults(messages: ChatMessage[]): { name: string; args: Record<string, unknown>; result: Record<string, unknown> }[] {
  const byId = new Map<string, ToolCall>();
  const out: { name: string; args: Record<string, unknown>; result: Record<string, unknown> }[] = [];
  for (const m of messages) {
    for (const tc of m.tool_calls ?? []) byId.set(tc.id, tc);
    if (m.role === 'tool' && m.tool_call_id) {
      const tc = byId.get(m.tool_call_id);
      if (!tc) continue;
      out.push({ name: tc.function.name, args: JSON.parse(tc.function.arguments || '{}'), result: JSON.parse(textOf(m) || '{}') });
    }
  }
  return out;
}

/** Options from the latest search and the menus read after it. Budget includes delivery. */
function computeOptions(messages: ChatMessage[]): { options: Option[]; budget?: number } {
  const results = toolResults(messages);
  const searchIdx = results.map((r) => r.name).lastIndexOf('search_restaurants');
  if (searchIdx < 0) return { options: [] };
  const search = results[searchIdx]!;
  const budget = typeof search.result.budget_naira === 'number' ? search.result.budget_naira : undefined;
  const words = String(search.args.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const restaurants = (search.result.restaurants ?? []) as { id: string; name: string; delivery_fee_naira: number }[];

  const all: (Option & { score: number })[] = [];
  for (const menu of results.slice(searchIdx + 1).filter((r) => r.name === 'get_menu' && Array.isArray(r.result.items))) {
    const r = restaurants.find((x) => x.id === menu.result.restaurant_id);
    if (!r) continue;
    // A required choice is offered as its first option, named in the option
    // text, so the choice is the customer's when they pick that option.
    const items = (menu.result.items as MenuResultItem[]).map((i) => {
      const choices = (i.choices ?? []).filter((g) => g.required && g.options.length).map((g) => ({ group: g.group, option: g.options[0]!.name, extra: g.options[0]!.extra_price_naira }));
      const label = choices.length ? ` (${choices.map((c) => `${c.group}: ${c.option}`).join(', ')})` : '';
      return {
        id: i.id,
        name: `${i.name}${label}`,
        price: i.price_naira + choices.reduce((s, c) => s + c.extra, 0),
        choices: choices.map(({ group, option }) => ({ group, option })),
      };
    });
    const combos: (typeof items)[] = [...items.map((i) => [i]), ...items.flatMap((a, i) => items.slice(i + 1).map((b) => [a, b]))];
    for (const c of combos) {
      const food = c.reduce((s, i) => s + i.price, 0);
      const total = food + r.delivery_fee_naira;
      if (budget !== undefined && total > budget) continue;
      const names = c.map((i) => i.name.toLowerCase()).join(' ');
      const score = words.filter((w) => names.includes(w)).length;
      all.push({ restaurantId: r.id, restaurantName: r.name, items: c, food, fee: r.delivery_fee_naira, total, score });
    }
  }
  const best = Math.max(0, ...all.map((o) => o.score));
  const options = all
    .filter((o) => best === 0 || o.score > 0)
    .sort((a, b) => b.score - a.score || b.total - a.total)
    .slice(0, 3);
  return { options, budget };
}

export class ScriptedDemoModel implements ModelClient {
  readonly model = 'scripted-demo';

  async complete(req: ModelRequest): Promise<ModelResponse> {
    return { message: { role: 'assistant', ...this.#decide(req.messages) }, usage: ZERO_USAGE };
  }

  #decide(messages: ChatMessage[]): Omit<ChatMessage, 'role'> {
    const lastUser = messages.map((m) => m.role).lastIndexOf('user');
    const userText = textOf(messages[lastUser]);
    // Tool results produced since the customer's latest message.
    const since = toolResults(messages).slice(toolResults(messages.slice(0, lastUser + 1)).length);
    const reply = (content: string) => ({ content });

    if (since.length === 0) {
      const pick = parsePick(userText);
      const { options } = computeOptions(messages.slice(0, lastUser));
      const chosen = pick !== undefined ? options[pick - 1] : undefined;
      if (chosen) {
        return { content: null, tool_calls: [call('build_cart', { restaurant_id: chosen.restaurantId, items: chosen.items.map((i) => ({ item_id: i.id, quantity: 1, ...(i.choices.length ? { choices: i.choices } : {}) })) })] };
      }
      if (/last time|same (thing|order)|again/i.test(userText)) return { content: null, tool_calls: [call('get_my_recent_orders', {})] };
      const words = FOOD_WORDS.filter((w) => userText.toLowerCase().includes(w));
      const budget = parseBudgetNaira(userText);
      return {
        content: null,
        tool_calls: [call('search_restaurants', { query: words.length ? words.join(' ') : userText.slice(0, 80), ...(budget ? { budget_naira: budget } : {}) })],
      };
    }

    const last = since.at(-1)!;
    const error = typeof last.result.error === 'string' ? String(last.result.message ?? last.result.error) : undefined;
    if (error) return reply(`Sorry, that did not work: ${error}`);

    switch (last.name) {
      case 'search_restaurants': {
        const found = (last.result.restaurants ?? []) as { id: string }[];
        if (found.length === 0) return reply("I couldn't find an open restaurant for that right now.");
        return { content: null, tool_calls: found.slice(0, 2).map((r) => call('get_menu', { restaurant_id: r.id })) };
      }
      case 'get_menu': {
        const { options, budget } = computeOptions(messages);
        if (options.length === 0) return reply(budget ? `I couldn't find anything within ${naira(budget)} including delivery.` : "I couldn't find a match on those menus.");
        const lines = options.map(
          (o, i) => `${i + 1}. ${o.items.map((it) => it.name).join(' + ')} at ${o.restaurantName}: ${naira(o.food)} + ${naira(o.fee)} delivery = ${naira(o.total)}`,
        );
        return reply(`Here are some options${budget ? ` within ${naira(budget)} including delivery` : ''}:\n${lines.join('\n')}\nWhich one would you like?`);
      }
      case 'build_cart':
        return { content: null, tool_calls: [call('quote_order', { cart_id: last.result.cart_id })] };
      case 'quote_order':
        if (last.result.within_budget === false) {
          return reply(`The total is ${naira(Number(last.result.total_naira))}, which is over your budget. Want a cheaper option?`);
        }
        return { content: null, tool_calls: [call('propose_order', { quote_id: last.result.quote_id })] };
      case 'propose_order':
        return reply(`Your order is ready for approval: ${naira(Number(last.result.total_naira))} in total. Tap Approve to place it. Nothing is charged until you do.`);
      case 'get_my_recent_orders': {
        const orders = (last.result.orders ?? []) as { restaurant: string; items: { name: string; quantity: number }[]; total_naira: number }[];
        if (orders.length === 0) return reply("You don't have any past orders yet. What would you like to eat?");
        const o = orders[0]!;
        return reply(`Last time you had ${o.items.map((i) => `${i.quantity} x ${i.name}`).join(', ')} from ${o.restaurant} (${naira(o.total_naira)}). Want the same again?`);
      }
      default:
        return reply('Done.');
    }
  }
}
