// Restaurant, cart and choice cards. Display only: they show what the server
// returned. A choice button sends the customer's pick as their next message;
// nothing is ever pre-selected. Thumbnails come from display data the model
// never sees.

import React, { createContext, useContext, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CartCardData, ChoicePrompt, RestaurantCardData } from '../logic/conversation';
import { choicesText, imageSource, naira } from '../logic/format';
import { useAssistantTheme } from './theme';

/** The API URL that relative image paths resolve against (FloatingAssistant provides it). */
export const ImageApiContext = createContext('');

/** A card thumbnail, or the card's icon when there is no usable image or it fails to load. Never an empty slot. */
export function Thumb({ url, icon, width, height, radius = 8 }: { url?: string; icon: keyof typeof Ionicons.glyphMap; width: number; height: number; radius?: number }) {
  const { colors } = useAssistantTheme();
  const src = imageSource(url, useContext(ImageApiContext));
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const box = { width, height, borderRadius: radius, backgroundColor: colors.accent };
  if (!src || failed) {
    return (
      <View style={[box, styles.thumbIcon]}>
        <Ionicons name={icon} size={Math.min(20, height * 0.5)} color={colors.primary} />
      </View>
    );
  }
  return <Image source={{ uri: src }} style={box} resizeMode="cover" onError={() => setFailed(true)} accessibilityIgnoresInvertColors />;
}

export function RestaurantCards({ restaurants }: { restaurants: RestaurantCardData[] }) {
  const { colors, fonts } = useAssistantTheme();
  if (restaurants.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hScroll} contentContainerStyle={styles.hRow}>
      {restaurants.map((r) => (
        <View key={r.id} style={[styles.restaurant, { borderColor: colors.greyLight, backgroundColor: colors.white }]}>
          <Thumb url={r.imageUrl} icon="restaurant-outline" width={128} height={68} />
          <Text numberOfLines={2} style={[styles.restaurantName, { fontFamily: fonts.semibold, color: colors.black }]}>
            {r.name}
          </Text>
          <Text style={[styles.small, { fontFamily: fonts.regular, color: colors.greyDark }]}>Delivery {naira(r.deliveryFeeNaira)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

export function CartCard({ cart }: { cart: CartCardData }) {
  const { colors, fonts } = useAssistantTheme();
  return (
    <View style={[styles.card, { borderColor: colors.greyLight, backgroundColor: colors.white }]}>
      <View style={styles.cardHead}>
        <Ionicons name="cart-outline" size={16} color={colors.primary} />
        <Text style={[styles.cardTitle, { fontFamily: fonts.semibold, color: colors.black }]}>Cart</Text>
      </View>
      {cart.items.map((it, i) => (
        <View key={i} style={[styles.line, styles.thumbRow]}>
          <Thumb url={it.imageUrl} icon="fast-food-outline" width={40} height={40} />
          <View style={styles.thumbText}>
            <Text style={[styles.body, { fontFamily: fonts.medium, color: colors.black }]}>
              {it.quantity} x {it.name}
            </Text>
            {it.choices?.length ? (
              <Text style={[styles.small, { fontFamily: fonts.regular, color: colors.greyDark }]}>{choicesText(it.choices)}</Text>
            ) : null}
          </View>
        </View>
      ))}
      <Text style={[styles.small, { fontFamily: fonts.regular, color: colors.greyMedium, marginTop: 4 }]}>Prices come from the server quote.</Text>
    </View>
  );
}

export function ChoiceChips({ prompt, disabled, onPick }: { prompt: ChoicePrompt; disabled: boolean; onPick: (option: string) => void }) {
  const { colors, fonts } = useAssistantTheme();
  return (
    <View style={[styles.card, { borderColor: colors.primary, backgroundColor: colors.accent }]}>
      <Text style={[styles.body, { fontFamily: fonts.semibold, color: colors.black }]}>
        Pick a {prompt.group} for {prompt.itemName}
      </Text>
      <View style={styles.chips}>
        {prompt.options.map((o) => (
          <Pressable
            key={o.name}
            disabled={disabled}
            onPress={() => onPick(o.name)}
            accessibilityRole="button"
            accessibilityLabel={`${o.name}${o.extraPriceNaira ? `, adds ${naira(o.extraPriceNaira)}` : ''}`}
            style={({ pressed }) => [
              styles.chip,
              { borderColor: colors.primary, backgroundColor: colors.white, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.chipText, { fontFamily: fonts.medium, color: colors.primary }]}>
              {o.name}
              {o.extraPriceNaira ? ` +${naira(o.extraPriceNaira)}` : ''}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hScroll: { marginTop: 8 },
  hRow: { gap: 8, paddingRight: 8 },
  restaurant: { width: 150, borderWidth: 1, borderRadius: 12, padding: 10, gap: 4 },
  restaurantName: { fontSize: 13, lineHeight: 17 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 8 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  cardTitle: { fontSize: 14 },
  line: { marginBottom: 4 },
  thumbRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  thumbText: { flex: 1 },
  thumbIcon: { alignItems: 'center', justifyContent: 'center' },
  body: { fontSize: 14, lineHeight: 19 },
  small: { fontSize: 12, lineHeight: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  chipText: { fontSize: 13 },
});
