// The approval card: the server's quote, line by line with the customer's
// picks, and the only button in the app that can start an assistant order.

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { cardActions, effectiveStatus, minutesLeft, statusMessage, type ApprovalCardState, type ApprovalStatus } from '../logic/approval';
import { choicesText, naira } from '../logic/format';
import { Thumb } from './Cards';
import { useAssistantTheme } from './theme';

const TITLES: Record<ApprovalStatus, string> = {
  awaiting: 'Approve your order',
  approving: 'Placing your order…',
  placed: 'Order placed',
  price_changed: 'The price changed',
  refused: 'Order not placed',
  expired: 'Quote expired',
  lost: 'Quote no longer available',
  superseded: 'Replaced by a newer quote',
  cancelling: 'Cancelling…',
  cancelled: 'Cancelled',
  uncertain: 'Not confirmed yet',
  checking: 'Checking your order…',
  not_placed: 'No order was placed',
  unverified: "Couldn't check your order",
  failed: 'Order not placed',
};

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
  const status = effectiveStatus(card, now);
  const actions = cardActions(card, now);
  const p = card.proposal;
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
        <Text style={[styles.title, { fontFamily: fonts.bold, color: colors.black }]}>{TITLES[status]}</Text>
      </View>
      <View style={[styles.thumbRow, { marginBottom: 8 }]}>
        <Thumb url={p.restaurantImageUrl} icon="restaurant-outline" width={28} height={28} radius={6} />
        <Text style={[styles.small, { fontFamily: fonts.medium, color: colors.greyDark }]}>{p.restaurantName}</Text>
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
      {row('Food', naira(p.subtotalNaira))}
      {row('Delivery', naira(p.deliveryFeeNaira))}
      {p.discountNaira ? row('Discount', `-${naira(p.discountNaira)}`) : null}
      {card.previousTotalNaira !== undefined && status === 'price_changed' ? row('Was', naira(card.previousTotalNaira)) : null}
      {row('Total', naira(p.totalNaira), true)}
      <Text style={[styles.small, { fontFamily: fonts.regular, color: colors.greyMedium, marginTop: 4 }]}>
        Paid from your Behtafood wallet.{actions.cancel ? ` Valid for ${minutesLeft(card, now)} min.` : ''}
      </Text>

      {status === 'placed' && card.order ? (
        <Text style={[styles.body, { fontFamily: fonts.semibold, color: colors.success, marginTop: 8 }]}>Your order was placed: {card.order.reference}</Text>
      ) : null}
      {message && status !== 'placed' ? (
        <Text style={[styles.body, { fontFamily: fonts.regular, color: status === 'refused' || status === 'failed' ? colors.error : colors.greyDark, marginTop: 8 }]}>
          {message}
        </Text>
      ) : null}

      <View style={styles.buttons}>
        {status === 'approving' || status === 'cancelling' || status === 'checking' ? <ActivityIndicator color={colors.primary} /> : null}
        {actions.cancel ? <Button label="Cancel" kind="secondary" onPress={onCancel} /> : null}
        {actions.approve ? (
          <Button
            label={status === 'unverified' ? 'Check again' : status === 'uncertain' ? 'Check and approve' : `Approve ${naira(p.totalNaira)}`}
            onPress={onApprove}
          />
        ) : null}
        {actions.askAgain ? <Button label="Ask again" kind="secondary" onPress={onAskAgain} /> : null}
        {actions.openOrder && card.order && onOpenOrder ? <Button label="View order" onPress={() => onOpenOrder(card.order!.orderId)} /> : null}
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
