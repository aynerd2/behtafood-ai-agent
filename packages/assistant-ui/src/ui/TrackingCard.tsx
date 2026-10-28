// Order tracking after approval: the backend's real stages, a delay message
// with reminder buttons, the honest result of each reminder, and a count of
// AI calls since the order (it stays at 0: tracking uses no model).

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { openDelay, trackingRows, type ReminderParty, type TrackingState } from '../logic/tracking';
import { ActionTimeline } from './ActionTimeline';
import { useAssistantTheme } from './theme';

const REMIND_LABEL: Record<ReminderParty, string> = { vendor: 'Remind the restaurant', rider: 'Remind the rider' };

export function TrackingCard({ tracking, onRemind }: { tracking: TrackingState; onRemind: (party: ReminderParty) => void }) {
  const { colors, fonts } = useAssistantTheme();
  const delay = openDelay(tracking);
  return (
    <View style={[styles.card, { borderColor: colors.greyLight, backgroundColor: colors.white }]}>
      <View style={styles.head}>
        <Ionicons name="bicycle-outline" size={18} color={colors.primary} />
        <Text style={[styles.title, { fontFamily: fonts.bold, color: colors.black }]}>Tracking {tracking.reference}</Text>
      </View>
      <ActionTimeline rows={trackingRows(tracking)} />
      {delay ? (
        <View style={styles.buttons}>
          {tracking.sending ? <ActivityIndicator color={colors.primary} /> : null}
          {delay.parties
            .filter((p) => p === 'vendor' || tracking.riderAssigned)
            .map((p) => (
              <Pressable
                key={p}
                disabled={!!tracking.sending}
                onPress={() => onRemind(p)}
                accessibilityRole="button"
                accessibilityLabel={REMIND_LABEL[p]}
                style={({ pressed }) => [styles.button, { borderColor: colors.primary, backgroundColor: colors.primary, opacity: tracking.sending ? 0.5 : pressed ? 0.8 : 1 }]}
              >
                <Text style={{ color: colors.white, fontFamily: fonts.semibold, fontSize: 14 }}>{REMIND_LABEL[p]}</Text>
              </Pressable>
            ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 15 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 10 },
  button: { borderWidth: 1, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 },
});
