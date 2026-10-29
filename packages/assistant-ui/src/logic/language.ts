// The reply language the customer picks in the chat header. Sent with every
// message as `language`; the server checks it against the same codes.
// Yoruba, Hausa and Igbo are marked beta: tested by us, not yet checked by
// native speakers.

export type AssistantLanguage = 'auto' | 'en' | 'pcm' | 'yo' | 'ha' | 'ig';

export interface LanguageOption {
  code: AssistantLanguage;
  label: string;
  beta: boolean;
}

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { code: 'auto', label: 'Auto (match my message)', beta: false },
  { code: 'en', label: 'English', beta: false },
  { code: 'pcm', label: 'Nigerian Pidgin', beta: false },
  { code: 'yo', label: 'Yoruba', beta: true },
  { code: 'ha', label: 'Hausa', beta: true },
  { code: 'ig', label: 'Igbo', beta: true },
];

export function isAssistantLanguage(value: unknown): value is AssistantLanguage {
  return LANGUAGE_OPTIONS.some((o) => o.code === value);
}

/** The remembered choice, or Auto when there is none or it is unknown. */
export function initialLanguage(stored: string | null | undefined): AssistantLanguage {
  return isAssistantLanguage(stored) ? stored : 'auto';
}
