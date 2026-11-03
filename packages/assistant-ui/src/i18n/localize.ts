// Shows app text in the chosen language.
//
// The pure logic (conversation, approval, tracking, guide) produces English
// strings, which its tests pin. Rather than thread a translator through every
// function, the screens pass each string through `localize`: an English string
// that matches a template in translations.ts is shown from that key in the
// chosen language, with its variables (themselves localized: "5 minutes",
// a status line) carried over. Anything else (a server message already in the
// right language, a restaurant or dish name) is shown as it is.

import { TRANSLATIONS, TRANSLATION_KEYS, t, uiLanguageOf, type TranslationKey, type Vars } from './translations';

interface Matcher {
  key: TranslationKey;
  re: RegExp;
  names: string[];
  literal: number;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function build(): Matcher[] {
  const en = TRANSLATIONS.en;
  const out: Matcher[] = [];
  for (const key of TRANSLATION_KEYS) {
    const template = en[key]!;
    const names: string[] = [];
    const pattern = template
      .split(/(\{\w+\})/)
      .map((part) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (m) {
          names.push(m[1]!);
          return '(.+?)';
        }
        return escape(part);
      })
      .join('');
    out.push({ key, re: new RegExp(`^${pattern}$`), names, literal: template.replace(/\{\w+\}/g, '').length });
  }
  // Most specific first: more fixed text wins over a template that is mostly variables.
  return out.sort((a, b) => b.literal - a.literal);
}

let MATCHERS: Matcher[] | null = null;

/** The key and variables an English string came from, or null. */
export function keyOf(english: string): { key: TranslationKey; vars: Vars } | null {
  MATCHERS ??= build();
  for (const m of MATCHERS) {
    const hit = m.re.exec(english);
    if (!hit) continue;
    const vars: Vars = {};
    m.names.forEach((n, i) => (vars[n] = hit[i + 1]!));
    return { key: m.key, vars };
  }
  return null;
}

export function localize(text: string | undefined | null, language: string | null | undefined, depth = 0): string {
  if (!text) return '';
  const lang = uiLanguageOf(language);
  if (lang === 'en') return text;
  const found = keyOf(text);
  if (!found) return text;
  const vars: Vars = {};
  for (const [k, v] of Object.entries(found.vars)) vars[k] = depth < 2 ? localize(String(v), lang, depth + 1) : v;
  return t(lang, found.key, vars);
}

/** A server step: its key when the server sent one, otherwise its English label. */
export function stepLabel(
  step: { label: string; labelKey?: string; labelParams?: Record<string, string | number> },
  language: string | null | undefined,
): string {
  const key = step.labelKey as TranslationKey | undefined;
  if (key && (TRANSLATION_KEYS as string[]).includes(key)) {
    const vars: Vars = { ...(step.labelParams ?? {}) };
    if (typeof vars.status === 'string') {
      const statusKey = `tracking.status.${vars.status}` as TranslationKey;
      if ((TRANSLATION_KEYS as string[]).includes(statusKey)) vars.status = t(language, statusKey);
    }
    return t(language, key, vars);
  }
  return localize(step.label, language);
}
