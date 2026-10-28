// Guided mode's link to the host app's own screens.
//
// Screens read `useGuideHighlight()` to outline what the assistant is viewing.
// It returns an inactive, empty state unless guided mode is running, so a
// screen that uses it renders exactly as before at all other times.
// `notifyGuideTouch()` is called by the host when the customer touches the
// app; guided mode then pauses. It does nothing when guided mode is not running.

import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { VIEWING_LABEL, type GuideHighlight } from '../logic/guide';
import { DEFAULT_THEME } from './theme';

export interface GuideHighlightState extends GuideHighlight {
  active: boolean;
  /** Changes on every new highlight, so a screen can scroll again to the same dish. */
  version: number;
}

const INACTIVE: GuideHighlightState = Object.freeze({ active: false, restaurantIds: [], itemIds: [], label: VIEWING_LABEL, version: 0 }) as GuideHighlightState;

let state: GuideHighlightState = INACTIVE;
let version = 0;
const listeners = new Set<() => void>();
let touchHandler: (() => void) | null = null;

function emit() {
  for (const fn of listeners) fn();
}

export function setGuideHighlight(h: GuideHighlight): void {
  version += 1;
  state = { ...h, active: true, version };
  emit();
}

export function clearGuideHighlight(): void {
  if (state === INACTIVE) return;
  state = INACTIVE;
  emit();
}

export function useGuideHighlight(): GuideHighlightState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
    () => state,
  );
}

/** Set by the assistant while it is mounted. */
export function setGuideTouchHandler(fn: (() => void) | null): void {
  touchHandler = fn;
}

/** The host app calls this from a passive onTouchStart; it never blocks the touch. */
export function notifyGuideTouch(): void {
  touchHandler?.();
}

/**
 * An outline and a pulsing "Behtafood AI is viewing…" badge over whatever it
 * is placed in. Display only: it takes no touches.
 */
export function GuideViewingBadge({ label = VIEWING_LABEL, radius = 14 }: { label?: string; radius?: number }) {
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const { colors, fonts } = DEFAULT_THEME;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.frame, { borderColor: colors.primary, borderRadius: radius }]}>
      <Animated.View style={[styles.badge, { backgroundColor: colors.primary, opacity: pulse }]}>
        <Text style={[styles.badgeText, { color: colors.white, fontFamily: fonts.semibold }]} numberOfLines={1}>
          ✨ {label}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderWidth: 2.5 },
  badge: { position: 'absolute', top: 6, left: 6, right: 6, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8, alignItems: 'center' },
  badgeText: { fontSize: 11 },
});
