// Every assistant message passes through sanitizeReply before it is shown or
// saved. The prompt asks for the same things; this makes them hold even when
// the model forgets.
//
//   • No em dash (—) or en dash (–), ever. Before details such as a price the
//     dash becomes a colon; between two numbers ("10–15") it becomes "to";
//     anywhere else it becomes a comma.
//   • Naira amounts get thousands separators: ₦2500 → ₦2,500.
//   • Markdown emphasis, headings and code fences are removed (the chat shows
//     plain text; the app adds its own bold for dish names and prices).

const DASH = /[—–]/;
const DASHES = /[—–]/g;

export function hasDash(text: string): boolean {
  return DASH.test(text);
}

/** "₦2500" / "₦ 2500.50" / "N2500" → "₦2,500" / "₦2,500.50". Numbers already grouped are left alone. */
export function formatNairaInText(text: string): string {
  return text.replace(/(?:₦|\bN(?=\d))\s?(\d{4,})(\.\d{1,2})?(?![\d,])/g, (_m, whole: string, frac = '') =>
    `₦${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac}`,
  );
}

function replaceDashes(text: string): string {
  // A dash at the very start of a line (used as a bullet) is dropped.
  let out = text.replace(/^[ \t]*[—–]+[ \t]*/gm, '');
  // Number ranges: "10–15 minutes" reads as "10 to 15 minutes".
  out = out.replace(/(\d)[ \t]*[—–][ \t]*(\d)/g, '$1 to $2');
  // Before details such as a price: a colon. Anywhere else: a comma.
  out = out.replace(/[ \t]*[—–]+[ \t]*(?=(\S)?)/g, (_m, next: string | undefined, offset: number, all: string) => {
    if (!next) return ''; // a trailing dash just goes
    const rest = all.slice(offset + _m.length);
    return /^(₦|N\d|\d)/.test(rest) ? ': ' : ', ';
  });
  return out.replace(DASHES, ',');
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|\s)\*(\S.*?)\*(?=\s|$|[.,!?])/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1');
}

export function sanitizeReply(text: string): string {
  const cleaned = formatNairaInText(replaceDashes(stripMarkdown(text)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return cleaned;
}
