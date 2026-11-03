// How a reply is laid out: short paragraphs (8 px apart), with only dish names
// and prices in bold. Pure, so it is tested without a phone.
//
// Dish names come from the menus and carts the assistant read in this
// conversation (real data, not guesses); prices are naira amounts.

export interface ReplySpan {
  text: string;
  bold: boolean;
  /** Prices use tabular figures so columns of amounts line up. */
  price: boolean;
}

export type ReplyParagraph = ReplySpan[];

const PRICE = /₦\s?\d[\d,]*(?:\.\d{1,2})?/g;

/** Splits on blank lines and single line breaks: each line of options is its own paragraph. */
export function paragraphsOf(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Bold spans for known dish names (longest first, whole words, any case) and
 * prices. Everything else is regular weight.
 */
export function spansOf(paragraph: string, dishNames: readonly string[]): ReplySpan[] {
  type Mark = { start: number; end: number; price: boolean };
  const marks: Mark[] = [];
  const taken = (s: number, e: number) => marks.some((m) => s < m.end && e > m.start);
  for (const m of paragraph.matchAll(PRICE)) marks.push({ start: m.index!, end: m.index! + m[0].length, price: true });
  const names = [...new Set(dishNames.map((n) => n.trim()).filter((n) => n.length >= 3))].sort((a, b) => b.length - a.length);
  const lower = paragraph.toLowerCase();
  for (const name of names) {
    const needle = name.toLowerCase();
    let from = 0;
    for (;;) {
      const i = lower.indexOf(needle, from);
      if (i < 0) break;
      const end = i + needle.length;
      const before = i === 0 ? ' ' : lower[i - 1]!;
      const after = end >= lower.length ? ' ' : lower[end]!;
      if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after) && !taken(i, end)) marks.push({ start: i, end, price: false });
      from = end;
    }
  }
  marks.sort((a, b) => a.start - b.start);
  const out: ReplySpan[] = [];
  let at = 0;
  for (const m of marks) {
    if (m.start > at) out.push({ text: paragraph.slice(at, m.start), bold: false, price: false });
    out.push({ text: paragraph.slice(m.start, m.end), bold: true, price: m.price });
    at = m.end;
  }
  if (at < paragraph.length) out.push({ text: paragraph.slice(at), bold: false, price: false });
  return out;
}

export function formatReply(text: string, dishNames: readonly string[]): ReplyParagraph[] {
  return paragraphsOf(text).map((p) => spansOf(p, dishNames));
}
