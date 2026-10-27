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

/** "Protein: Chicken, Extras: Coleslaw" */
export function choicesText(choices: { group: string; option: string }[] | undefined): string {
  return (choices ?? []).map((c) => `${c.group}: ${c.option}`).join(', ');
}
