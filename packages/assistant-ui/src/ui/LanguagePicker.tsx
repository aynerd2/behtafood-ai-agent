// The reply-language dropdown in the chat header. The choice goes out with
// every message; Yoruba, Hausa and Igbo carry a "beta" tag.

import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LANGUAGE_OPTIONS, type AssistantLanguage } from '../logic/language';
import { LANGUAGE_NAMES } from '../i18n/translations';
import { useI18n } from './i18n';
import { useAssistantTheme } from './theme';

export function LanguagePicker({ value, onChange, disabled }: { value: AssistantLanguage; onChange: (l: AssistantLanguage) => void; disabled?: boolean }) {
  const { colors, fonts } = useAssistantTheme();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const current = LANGUAGE_OPTIONS.find((o) => o.code === value) ?? LANGUAGE_OPTIONS[0]!;
  // Language names are shown in their own language; only Auto is translated.
  const nameOf = (code: AssistantLanguage) => (code === 'auto' ? t('lang.auto') : LANGUAGE_NAMES[code]);
  const shortOf = (code: AssistantLanguage) => (code === 'auto' ? t('lang.short.auto') : LANGUAGE_NAMES[code]);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={t('lang.button', { name: nameOf(current.code) })}
        hitSlop={6}
        style={({ pressed }) => [styles.pill, { borderColor: colors.greyLight, backgroundColor: pressed ? colors.accent : colors.offWhite, opacity: disabled ? 0.5 : 1 }]}
      >
        <Ionicons name="language-outline" size={14} color={colors.primary} />
        <Text style={[styles.pillText, { fontFamily: fonts.medium, color: colors.black }]}>{shortOf(current.code)}</Text>
        <Ionicons name="chevron-down" size={12} color={colors.greyDark} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel={t('lang.close')}>
          {/* Swallows taps inside the list so only the backdrop closes it. */}
          <Pressable onPress={() => {}} style={[styles.sheet, { backgroundColor: colors.white }]} accessibilityRole="menu">
            <Text style={[styles.sheetTitle, { fontFamily: fonts.semibold, color: colors.black }]}>{t('lang.title')}</Text>
            {LANGUAGE_OPTIONS.map((o) => {
              const on = o.code === value;
              return (
                <Pressable
                  key={o.code}
                  onPress={() => {
                    setOpen(false);
                    if (!on) onChange(o.code);
                  }}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={o.beta ? `${nameOf(o.code)}, ${t('lang.beta')}` : nameOf(o.code)}
                  style={({ pressed }) => [styles.option, { backgroundColor: on ? colors.accent : pressed ? colors.offWhite : 'transparent' }]}
                >
                  <Text style={[styles.optionText, { fontFamily: on ? fonts.semibold : fonts.regular, color: colors.black }]}>{nameOf(o.code)}</Text>
                  {o.beta ? (
                    <View style={[styles.beta, { borderColor: colors.greyMedium }]}>
                      <Text style={[styles.betaText, { fontFamily: fonts.medium, color: colors.greyDark }]}>{t('lang.beta')}</Text>
                    </View>
                  ) : null}
                  {on ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
            <Text style={[styles.note, { fontFamily: fonts.regular, color: colors.greyDark }]}>
              {t('lang.betaHint')}
            </Text>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 },
  pillText: { fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: 'rgba(17, 24, 39, 0.35)', justifyContent: 'center', padding: 24 },
  sheet: { borderRadius: 18, paddingVertical: 12, paddingHorizontal: 8 },
  sheetTitle: { fontSize: 15, paddingHorizontal: 12, paddingVertical: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12 },
  optionText: { flex: 1, fontSize: 15 },
  beta: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  betaText: { fontSize: 11 },
  note: { fontSize: 12, lineHeight: 17, paddingHorizontal: 12, paddingTop: 8 },
});
