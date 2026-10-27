// Colours and fonts. The defaults are the Behtafood Customer app's own (brand
// green, its neutrals, and the font family names it registers at start-up);
// the host app passes its theme in so the two can never drift.

import React, { createContext, useContext, useMemo, type ReactNode } from 'react';

export interface AssistantColors {
  primary: string;
  accent: string;
  white: string;
  offWhite: string;
  greyLight: string;
  greyMedium: string;
  greyDark: string;
  black: string;
  error: string;
  success: string;
}

export interface AssistantFonts {
  regular: string;
  medium: string;
  semibold: string;
  bold: string;
}

export interface AssistantTheme {
  colors: AssistantColors;
  fonts: AssistantFonts;
}

export const DEFAULT_THEME: AssistantTheme = {
  colors: {
    primary: '#004225',
    accent: '#ECFDF5',
    white: '#FFFFFF',
    offWhite: '#F9FAFB',
    greyLight: '#F3F4F6',
    greyMedium: '#9CA3AF',
    greyDark: '#4B5563',
    black: '#111827',
    error: '#EF4444',
    success: '#10B981',
  },
  fonts: {
    regular: 'Montserrat-Regular',
    medium: 'Montserrat-Medium',
    semibold: 'Montserrat-SemiBold',
    bold: 'Montserrat-Bold',
  },
};

export interface AssistantThemeInput {
  colors?: Partial<AssistantColors>;
  fonts?: Partial<AssistantFonts>;
}

const ThemeContext = createContext<AssistantTheme>(DEFAULT_THEME);

export function AssistantThemeProvider({ theme, children }: { theme?: AssistantThemeInput; children: ReactNode }) {
  const value = useMemo<AssistantTheme>(
    () => ({ colors: { ...DEFAULT_THEME.colors, ...theme?.colors }, fonts: { ...DEFAULT_THEME.fonts, ...theme?.fonts } }),
    [theme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAssistantTheme(): AssistantTheme {
  return useContext(ThemeContext);
}
