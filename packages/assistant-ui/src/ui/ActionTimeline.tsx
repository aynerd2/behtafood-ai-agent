// The live list of what the assistant actually did. Each row is drawn from a
// server event: done only when the event says so, failures in red, and
// "waiting for your approval" as its own state. A spinner shows while a step
// is running; a tick scales in when the server reports success.

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { TimelineRow } from '../logic/conversation';
import { FadeSlideIn, PopIn } from './motion';
import { useI18n } from './i18n';
import { useAssistantTheme } from './theme';

const ICONS = {
  done: 'checkmark-circle',
  failed: 'close-circle',
  awaiting: 'time-outline',
  info: 'information-circle-outline',
} as const;

/** Light red behind a failed row. */
const FAILED_BG = 'rgba(239, 68, 68, 0.08)';

export function ActionTimeline({ rows, animate = true }: { rows: TimelineRow[]; animate?: boolean }) {
  const { colors, fonts } = useAssistantTheme();
  const { step } = useI18n();
  if (rows.length === 0) return null;
  const tint = { done: colors.success, failed: colors.error, awaiting: colors.primary, info: colors.greyMedium, working: colors.primary };
  return (
    <View style={[styles.box, { backgroundColor: colors.offWhite, borderColor: colors.greyLight }]} accessibilityRole="summary">
      {rows.map((r) => {
        // Server steps carry a key; app rows are English text shown in the chosen language.
        const label = step(r);
        return (
        <FadeSlideIn key={r.key} animate={animate}>
          <View style={[styles.row, r.status === 'failed' && { backgroundColor: FAILED_BG }]} accessibilityLabel={label}>
            <View style={styles.icon}>
              {r.status === 'working' ? (
                <ActivityIndicator size="small" color={tint.working} />
              ) : r.status === 'done' ? (
                <PopIn animate={animate}>
                  <Ionicons name={ICONS.done} size={18} color={tint.done} />
                </PopIn>
              ) : (
                <Ionicons name={ICONS[r.status]} size={18} color={tint[r.status]} />
              )}
            </View>
            <Text
              style={[
                styles.label,
                {
                  fontFamily: r.status === 'awaiting' || r.status === 'failed' ? fonts.semibold : fonts.regular,
                  color: r.status === 'failed' ? colors.error : colors.greyDark,
                },
              ]}
            >
              {label}
            </Text>
          </View>
        </FadeSlideIn>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 14, paddingVertical: 6, paddingHorizontal: 6, marginTop: 10, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: 8, paddingVertical: 5, paddingHorizontal: 6 },
  icon: { width: 22, alignItems: 'center', marginRight: 8 },
  label: { flex: 1, fontSize: 13, lineHeight: 18 },
});
