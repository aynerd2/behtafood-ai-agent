// First-use consent, in plain words and in the chosen language: what is sent,
// to whom, what is never sent, and how to turn the assistant off. The host app
// stores the answer and shows this before the first chat.

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TranslationKey } from '../i18n/translations';
import { AssistantI18nProvider, useI18n } from './i18n';
import { useAssistantTheme } from './theme';

export interface ConsentScreenProps {
  /** The reply language the customer picked (Auto → English). */
  language?: string | null;
  onAgree: () => void;
  onDecline: () => void;
  onOpenPrivacyPolicy?: () => void;
}

const POINTS: { key: TranslationKey; icon: 'chatbubbles-outline' | 'server-outline' | 'lock-closed-outline' | 'image-outline' | 'settings-outline' }[] = [
  { key: 'consent.what', icon: 'chatbubbles-outline' },
  { key: 'consent.who', icon: 'server-outline' },
  { key: 'consent.never', icon: 'lock-closed-outline' },
  { key: 'consent.photos', icon: 'image-outline' },
  { key: 'consent.off', icon: 'settings-outline' },
];

export function ConsentScreen(props: ConsentScreenProps) {
  return (
    <AssistantI18nProvider language={props.language}>
      <ConsentBody {...props} />
    </AssistantI18nProvider>
  );
}

function ConsentBody({ onAgree, onDecline, onOpenPrivacyPolicy }: ConsentScreenProps) {
  const { colors, fonts } = useAssistantTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { backgroundColor: colors.white, paddingTop: insets.top + 16, paddingBottom: Math.max(insets.bottom, 16) }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.badge, { backgroundColor: colors.accent }]}>
          <Ionicons name="sparkles" size={22} color={colors.primary} />
        </View>
        <Text style={[styles.title, { fontFamily: fonts.bold, color: colors.black }]}>{t('consent.title')}</Text>
        {POINTS.map((p) => (
          <View key={p.key} style={styles.point}>
            <Ionicons name={p.icon} size={20} color={colors.primary} style={styles.icon} />
            <Text style={[styles.body, { fontFamily: fonts.regular, color: colors.black }]}>{t(p.key)}</Text>
          </View>
        ))}
        {onOpenPrivacyPolicy ? (
          <Pressable onPress={onOpenPrivacyPolicy} accessibilityRole="link" hitSlop={8}>
            <Text style={[styles.link, { fontFamily: fonts.semibold, color: colors.primary }]}>{t('consent.privacy')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <View style={styles.buttons}>
        <Pressable onPress={onAgree} accessibilityRole="button" style={[styles.button, { backgroundColor: colors.primary }]}>
          <Text style={[styles.buttonText, { fontFamily: fonts.semibold, color: colors.white }]}>{t('consent.agree')}</Text>
        </Pressable>
        <Pressable onPress={onDecline} accessibilityRole="button" style={[styles.button, { borderWidth: 1, borderColor: colors.greyLight }]}>
          <Text style={[styles.buttonText, { fontFamily: fonts.semibold, color: colors.greyDark }]}>{t('consent.notNow')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 24, paddingBottom: 16 },
  badge: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { fontSize: 22, lineHeight: 30, marginBottom: 16 },
  point: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  icon: { marginTop: 2 },
  body: { flex: 1, fontSize: 16, lineHeight: 24 },
  link: { fontSize: 15, marginTop: 8 },
  buttons: { paddingHorizontal: 24, gap: 10 },
  button: { borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  buttonText: { fontSize: 16 },
});
