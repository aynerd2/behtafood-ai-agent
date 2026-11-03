// The chosen language for every assistant screen. Auto (and anything
// unknown) shows the interface in English; replies follow the customer.

import React, { createContext, useContext, useMemo, type ReactNode } from 'react';
import { localize, stepLabel } from '../i18n/localize';
import { translator, uiLanguageOf, type Translate, type UiLanguage } from '../i18n/translations';

export interface AssistantI18n {
  /** The interface language (Auto → en). */
  lang: UiLanguage;
  t: Translate;
  /** App text made by the logic in English, shown in the chosen language. */
  l: (text: string | undefined | null) => string;
  /** A server timeline step in the chosen language. */
  step: (s: Parameters<typeof stepLabel>[0]) => string;
}

function make(language: string | null | undefined): AssistantI18n {
  const lang = uiLanguageOf(language);
  return {
    lang,
    t: translator(lang),
    l: (text) => localize(text, lang),
    step: (s) => stepLabel(s, lang),
  };
}

const I18nContext = createContext<AssistantI18n>(make('en'));

export function AssistantI18nProvider({ language, children }: { language: string | null | undefined; children: ReactNode }) {
  const value = useMemo(() => make(language), [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): AssistantI18n {
  return useContext(I18nContext);
}
