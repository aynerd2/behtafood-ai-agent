// The approval card: the server's quote, line by line with the customer's
// picks, and the only button in the app that can start an assistant order.

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { cardActions, effectiveStatus, minutesLeft, statusMessage, type ApprovalCardState, type ApprovalStatus } from '../logic/approval';
import { choicesText, naira } from '../logic/format';
import { Thumb } from './Cards';
import { useI18n } from './i18n';
import { useAssistantTheme } from './theme';
import type { TranslationKey } from '../i18n/translations';


export interface ApprovalCardProps {
  card: ApprovalCardState;
  now: number;
  onApprove: () => void;
  onCancel: () => void;
  onAskAgain: () => void;
  onOpenOrder?: (orderId: string) => void;
}

export function ApprovalCard({ card, now, onApprove, onCancel, onAskAgain, onOpenOrder }: ApprovalCardProps) {
  const { colors, fonts } = useAssistantTheme();
  const { t, l } = useI18n();
  const status = effectiveStatus(card, now);
  const actions = cardActions(card, now);
  const p = card.proposal;
  const pickup = p.fulfilment === 'pickup';
  const message = statusMessage(card, now);
  const dimmed = status === 'superseded' || status === 'cancelled' || status === 'expired' || status === 'lost';
  const accent = status === 'placed' ? colors.success : status === 'refused' || status === 'failed' || status === 'unverified' ? colors.error : colors.primary;

  const row = (label: string, value: string, strong = false) => (
    <View style={styles.row}>
      <Text style={[styles.body, { fontFamily: strong ? fonts.bold : fonts.regular, color: colors.greyDark }]}>{label}</Text>
      <Text style={[styles.body, { fontFamily: strong ? fonts.bold : fonts.medium, color: colors.black }]}>{value}</Text>
    </View>
  );

  return (
    <View style={[styles.card, { borderColor: accent, backgroundColor: colors.white, opacity: dimmed ? 0.7 : 1 }]}>
      <View style={styles.head}>
        <Ionicons name={status === 'placed' ? 'checkmark-circle' : 'receipt-outline'} size={18} color={accent} />
        <Text style={[styles.title, { fontFamily: fonts.bold, color: colors.black }]}>{t(`card.title.${status}` as TranslationKey)}</Text>
      </View>
      <View style={[styles.thumbRow, { marginBottom: 8 }]}>
        <Thumb url={p.restaurantImageUrl} icon="restaurant-outline" width={28} height={28} radius={6} />
        <Text style={[styles.small, { fontFamily: fonts.medium, color: colors.greyDark }]}>{p.restaurantName}</Text>
        <View style={[styles.mode, { backgroundColor: colors.accent }]}>
          <Ionicons name={pickup ? 'bag-handle-outline' : 'bicycle-outline'} size={12} color={colors.primary} />
          <Text style={[styles.modeText, { fontFamily: fonts.semibold, color: colors.primary }]}>{t(pickup ? 'card.mode.pickup' : 'card.mode.delivery')}</Text>
        </View>
      </View>

      {p.lines.map((l, i) => (
        <View key={`${l.itemId}:${i}`} style={[styles.line, styles.thumbRow]}>
          <Thumb url={l.imageUrl} icon="fast-food-outline" width={40} height={40} />
          <View style={styles.lineText}>
            <View style={styles.row}>
              <Text style={[styles.body, styles.lineName, { fontFamily: fonts.medium, color: colors.black }]}>
                {l.quantity} x {l.name}
              </Text>
              <Text style={[styles.body, { fontFamily: fonts.medium, color: colors.black }]}>{naira(l.lineTotalNaira)}</Text>
            </View>
            {l.choices?.length ? (
              <Text style={[styles.small, { fontFamily: fonts.regular, color: colors.greyDark }]}>
                {l.choices.map((c) => `${c.group}: ${c.option}${c.priceNaira ? ` (+${naira(c.priceNaira)})` : ''}`).join(', ')}
              </Text>
            ) : null}
          </View>
        </View>
      ))}

      <View style={[styles.divider, { backgroundColor: colors.greyLight }]} />
      {row(t('card.food'), naira(p.subtotalNaira))}
      {/* Pickup has no delivery fee; delivery shows the server's fee. */}
      {pickup ? row(t('card.mode.pickup'), t('card.noFee')) : row(t('card.delivery'), naira(p.deliveryFeeNaira))}
      {p.discountNaira ? row(t('card.discount'), `-${naira(p.discountNaira)}`) : null}
      {card.previousTotalNaira !== undefined && status === 'price_changed' ? row(t('card.was'), naira(card.previousTotalNaira)) : null}
      {row(t('card.total'), naira(p.totalNaira), true)}
      {p.walletBalanceNaira !== undefined ? row(t('card.walletBalance'), naira(p.walletBalanceNaira)) : null}
      <Text style={[styles.small, { fontFamily: fonts.regular, color: colors.greyMedium, marginTop: 4 }]}>
        {t('card.paidFromWallet')}{actions.cancel ? ` ${t('card.validFor', { minutes: minutesLeft(card, now) })}` : ''}
      </Text>

      {status === 'placed' && card.order ? (
        <Text style={[styles.body, { fontFamily: fonts.semibold, color: colors.success, marginTop: 8 }]}>{t('msg.placed', { reference: card.order.reference })}</Text>
      ) : null}
      {message && status !== 'placed' ? (
        <Text style={[styles.body, { fontFamily: fonts.regular, color: status === 'refused' || status === 'failed' ? colors.error : colors.greyDark, marginTop: 8 }]}>
          {l(message)}
        </Text>
      ) : null}

      <View style={styles.buttons}>
        {status === 'approving' || status === 'cancelling' || status === 'checking' ? <ActivityIndicator color={colors.primary} /> : null}
        {actions.cancel ? <Button label={t('buttons.cancel')} kind="secondary" onPress={onCancel} /> : null}
        {actions.approve ? (
          <Button
            label={status === 'unverified' ? t('card.checkAgain') : status === 'uncertain' ? t('card.checkAndApprove') : t('card.approveAmount', { amount: naira(p.totalNaira) })}
            onPress={onApprove}
          />
        ) : null}
        {actions.askAgain ? <Button label={t('buttons.askAgain')} kind="secondary" onPress={onAskAgain} /> : null}
        {actions.openOrder && card.order && onOpenOrder ? <Button label={t('buttons.viewOrder')} onPress={() => onOpenOrder(card.order!.orderId)} /> : null}
      </View>
    </View>
  );
}

function Button({ label, onPress, kind = 'primary' }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' }) {
  const { colors, fonts } = useAssistantTheme();
  const primary = kind === 'primary';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: primary ? colors.primary : colors.white, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Text style={[styles.buttonText, { fontFamily: fonts.semibold, color: primary ? colors.white : colors.primary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mode: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 },
  modeText: { fontSize: 11 },
  card: { borderWidth: 1.5, borderRadius: 14, padding: 14, marginTop: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 16 },
  line: { marginBottom: 6 },
  thumbRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lineText: { flex: 1 },
  lineName: { flex: 1, marginRight: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 },
  divider: { height: 1, marginVertical: 8 },
  body: { fontSize: 14, lineHeight: 19 },
  small: { fontSize: 12, lineHeight: 16 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  button: { borderWidth: 1, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 },
  buttonText: { fontSize: 14 },
});
