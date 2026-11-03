// Order tracking after approval: the backend's real stages, a delay message
// with reminder buttons, the honest result of each reminder, and a count of
// AI calls since the order (it stays at 0: tracking uses no model).

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { openDelay, trackingRows, type ReminderParty, type TrackingState } from '../logic/tracking';
import { ActionTimeline } from './ActionTimeline';
import { useI18n } from './i18n';
import { useAssistantTheme } from './theme';

const REMIND_KEY = { vendor: 'tracking.remindVendor', rider: 'tracking.remindRider' } as const satisfies Record<ReminderParty, string>;

export function TrackingCard({ tracking, onRemind, fulfilment }: { tracking: TrackingState; onRemind: (party: ReminderParty) => void; fulfilment?: 'delivery' | 'pickup' }) {
  const { colors, fonts } = useAssistantTheme();
  const { t } = useI18n();
  const delay = openDelay(tracking);
  return (
    <View style={[styles.card, { borderColor: colors.greyLight, backgroundColor: colors.white }]}>
      <View style={styles.head}>
        <Ionicons name={fulfilment === 'pickup' ? 'bag-handle-outline' : 'bicycle-outline'} size={18} color={colors.primary} />
        <Text style={[styles.title, { fontFamily: fonts.bold, color: colors.black }]}>{t('tracking.heading', { reference: tracking.reference })} · {t(fulfilment === 'pickup' ? 'card.mode.pickup' : 'card.mode.delivery')}</Text>
      </View>
      <ActionTimeline rows={trackingRows(tracking)} />
      {delay ? (
        <View style={styles.buttons}>
          {tracking.sending ? <ActivityIndicator color={colors.primary} /> : null}
          {delay.parties
            .filter((p) => p === 'vendor' || (tracking.fulfilment === 'delivery' && tracking.riderAssigned))
            .map((p) => (
              <Pressable
                key={p}
                disabled={!!tracking.sending}
                onPress={() => onRemind(p)}
                accessibilityRole="button"
                accessibilityLabel={t(REMIND_KEY[p])}
                style={({ pressed }) => [styles.button, { borderColor: colors.primary, backgroundColor: colors.primary, opacity: tracking.sending ? 0.5 : pressed ? 0.8 : 1 }]}
              >
                <Text style={{ color: colors.white, fontFamily: fonts.semibold, fontSize: 14 }}>{t(REMIND_KEY[p])}</Text>
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
