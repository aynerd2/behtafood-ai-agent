// The live list of what the assistant actually did. Each row is drawn from a
// server event: done only when the event says so, failures in red, and
// "waiting for your approval" as its own state.

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { TimelineRow } from '../logic/conversation';
import { useAssistantTheme } from './theme';

const ICONS = {
  done: 'checkmark-circle',
  failed: 'close-circle',
  awaiting: 'time-outline',
  info: 'information-circle-outline',
} as const;

export function ActionTimeline({ rows }: { rows: TimelineRow[] }) {
  const { colors, fonts } = useAssistantTheme();
  if (rows.length === 0) return null;
  const tint = { done: colors.success, failed: colors.error, awaiting: colors.primary, info: colors.greyMedium, working: colors.primary };
  return (
    <View style={[styles.box, { backgroundColor: colors.offWhite, borderColor: colors.greyLight }]} accessibilityRole="summary">
      {rows.map((r) => (
        <View key={r.key} style={styles.row} accessibilityLabel={`${r.status}: ${r.label}`}>
          <View style={styles.icon}>
            {r.status === 'working' ? (
              <ActivityIndicator size="small" color={tint.working} />
            ) : (
              <Ionicons name={ICONS[r.status]} size={18} color={tint[r.status]} />
            )}
          </View>
          <Text
            style={[
              styles.label,
              { fontFamily: r.status === 'awaiting' ? fonts.semibold : fonts.regular, color: r.status === 'failed' ? colors.error : colors.greyDark },
            ]}
          >
            {r.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, marginTop: 8, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 24, alignItems: 'center', marginRight: 8 },
  label: { flex: 1, fontSize: 13, lineHeight: 18 },
});
