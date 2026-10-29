// Motion for the chat. Presentation only: each piece animates something that
// has already arrived from the server, never ahead of it. Animations use React
// Native's Animated with the native driver, and all of them turn off when the
// device asks for reduced motion. The reply reveal changes text, which a
// native-driver animation cannot do, so it uses a short timer instead.

import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { revealDurationMs, revealedLength } from '../logic/motion';

/** True when the device asks for reduced motion. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => live && setReduce(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/** Fades in and slides up 8 px when it first appears. */
export function FadeSlideIn({ children, animate = true, style }: { children: ReactNode; animate?: boolean; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const run = animate && !reduce;
  const progress = useRef(new Animated.Value(run ? 0 : 1)).current;
  useEffect(() => {
    if (!run) {
      progress.setValue(1);
      return;
    }
    const a = Animated.timing(progress, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [run, progress]);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  return <Animated.View style={[style, { opacity: progress, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

/** Three bouncing dots. With reduced motion they stay still. */
export function TypingDots({ color }: { color: string }) {
  const reduce = useReduceMotion();
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (reduce) {
      dots.forEach((d) => d.setValue(0));
      return;
    }
    const bounce = (d: Animated.Value) =>
      Animated.sequence([
        Animated.timing(d, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(d, { toValue: 0, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]);
    const loop = Animated.loop(Animated.sequence([Animated.stagger(140, dots.map(bounce)), Animated.delay(200)]));
    loop.start();
    return () => loop.stop();
  }, [reduce, dots]);
  return (
    <View style={styles.dots} accessibilityLabel="The assistant is working">
      {dots.map((d, i) => (
        <Animated.View
          key={i}
          style={[styles.dot, { backgroundColor: color, transform: [{ translateY: d.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }]}
        />
      ))}
    </View>
  );
}

/** Scales in once, for a tick that just turned green. */
export function PopIn({ children, animate = true }: { children: ReactNode; animate?: boolean }) {
  const reduce = useReduceMotion();
  const run = animate && !reduce;
  const scale = useRef(new Animated.Value(run ? 0.4 : 1)).current;
  useEffect(() => {
    if (!run) {
      scale.setValue(1);
      return;
    }
    const a = Animated.spring(scale, { toValue: 1, friction: 5, tension: 160, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [run, scale]);
  return <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>;
}

/**
 * The reply text, revealed at about 20 ms a character (1.5 s at most). A tap
 * shows it all at once; reduced motion shows it all at once too. The full text
 * is always available to screen readers.
 */
export function RevealText({ text, animate = true, style }: { text: string; animate?: boolean; style?: StyleProp<TextStyle> }) {
  const reduce = useReduceMotion();
  const run = animate && !reduce && revealDurationMs(text) > 0;
  const [shown, setShown] = useState(run ? 0 : text.length);
  const [skipped, setSkipped] = useState(false);
  useEffect(() => {
    if (!run || skipped) {
      setShown(text.length);
      return;
    }
    const started = Date.now();
    const t = setInterval(() => {
      const n = revealedLength(text, Date.now() - started);
      setShown(n);
      if (n >= text.length) clearInterval(t);
    }, 32);
    return () => clearInterval(t);
  }, [text, run, skipped]);
  const done = shown >= text.length;
  return (
    <Pressable onPress={() => setSkipped(true)} disabled={done} accessibilityLabel={text} accessibilityHint={done ? undefined : 'Tap to show the whole reply'}>
      <Text style={style}>{done ? text : text.slice(0, shown)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 18 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
