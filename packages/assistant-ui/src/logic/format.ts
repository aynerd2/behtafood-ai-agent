// Formatting without Intl, which is not guaranteed on every phone's JS engine.

export function naira(n: number): string {
  const whole = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}₦${whole}`;
}

/**
 * The model sometimes answers in Markdown. The chat shows plain text, so the
 * common marks are removed rather than shown as asterisks and hashes.
 */
export function plainReply(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .trim();
}

/**
 * A card thumbnail's URL: an absolute http(s) link as is, a root-relative path
 * ("/assets/food/x.jpg") on the API's own host, anything else undefined (the
 * card then shows its icon, never an empty or broken image).
 */
export function imageSource(url: unknown, apiUrl: string): string | undefined {
  if (typeof url !== 'string' || /\s/.test(url)) return undefined;
  if (/^https?:\/\/[^/?#]+/i.test(url)) return url;
  if (!/^\/[^/]/.test(url)) return undefined;
  const origin = /^(https?:\/\/[^/?#\s]+)/i.exec(apiUrl)?.[1];
  return origin ? origin + url : undefined;
}

/** "Protein: Chicken, Extras: Coleslaw" */
export function choicesText(choices: { group: string; option: string }[] | undefined): string {
  return (choices ?? []).map((c) => `${c.group}: ${c.option}`).join(', ');
}
