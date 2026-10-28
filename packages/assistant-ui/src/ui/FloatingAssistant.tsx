// The floating button, and the assistant it opens in one of two modes:
//
//   Chat    the full-screen chat panel with the live timeline.
//   Guided  a small bar; the host app's real screens follow the assistant's
//           real, successful steps (see logic/guide.ts and logic/guidedMode.ts).
//
// The host app decides WHEN the button shows (`visible`), whether the customer
// may use it (`canUse`, i.e. signed in), and how to open its own screens
// (`onNavigate`). Without onNavigate, only Chat mode is offered. Keep this
// mounted while the app runs so the conversation survives closing the panel.

import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { guideActionForPlaced, guideEffects, initialGuideMap, mapGuideEvent, type GuideAction, type GuideRoute } from '../logic/guide';
import { GuideSession, type GuideMode } from '../logic/guidedMode';
import { ChatPanel } from './ChatPanel';
import { clearGuideHighlight, setGuideHighlight, setGuideTouchHandler } from './guideHighlights';
import { GuidedPanel } from './GuidedPanel';
import { useAssistantController } from './hooks';
import { AssistantThemeProvider, useAssistantTheme, type AssistantThemeInput } from './theme';

export interface FloatingAssistantProps {
  /** The app's API base, e.g. http://192.168.0.2:7001/api */
  apiUrl: string;
  /** The signed-in customer's token. */
  getToken: () => Promise<string | null>;
  /** Show the floating button (the panel, once open, stays open). */
  visible: boolean;
  /** Signed in as a customer. When false, a tap calls onSignInRequired instead. */
  canUse: boolean;
  onSignInRequired?: () => void;
  /** Open the app's own order screen for a placed order. */
  onOpenOrder?: (orderId: string) => void;
  /** Open one of the app's own screens for guided mode. */
  onNavigate?: (route: GuideRoute) => void;
  /** The remembered mode (Guided when there is none). */
  initialMode?: GuideMode;
  onModeChange?: (mode: GuideMode) => void;
  /** Distance from the bottom of the screen, to clear a tab bar. */
  bottomOffset?: number;
  theme?: AssistantThemeInput;
}

export function FloatingAssistant(props: FloatingAssistantProps) {
  return (
    <AssistantThemeProvider theme={props.theme}>
      <FloatingAssistantInner {...props} />
    </AssistantThemeProvider>
  );
}

function FloatingAssistantInner({
  apiUrl,
  getToken,
  visible,
  canUse,
  onSignInRequired,
  onOpenOrder,
  onNavigate,
  initialMode = 'guided',
  onModeChange,
  bottomOffset = 96,
}: FloatingAssistantProps) {
  const { colors } = useAssistantTheme();
  const controller = useAssistantController({ apiUrl, getToken });
  const guidedAvailable = !!onNavigate;
  const [open, setOpen] = useState(false);
  const [mode, setModeState] = useState<GuideMode>(guidedAvailable ? initialMode : 'chat');
  const [fly, setFly] = useState<{ key: string; label: string } | null>(null);
  const [, setTick] = useState(0);
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;

  const sessionRef = useRef<GuideSession | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = new GuideSession({
      mode,
      // Each screen stays long enough to see what the assistant is viewing.
      minDwellMs: 1200,
      apply: (a: GuideAction) => {
        const fx = guideEffects(a);
        if (fx.highlight === null) clearGuideHighlight();
        else if (fx.highlight) setGuideHighlight(fx.highlight);
        if (fx.route) navigateRef.current?.(fx.route);
        if (fx.fly?.length) setFly({ key: a.key, label: fx.fly.map((f) => `${f.quantity} x ${f.name}`).join(', ') });
      },
      clear: () => {
        clearGuideHighlight();
        setFly(null);
      },
    });
  }
  const session = sessionRef.current;

  // Re-render on every guided state change (status, current step).
  useEffect(() => session.subscribe(() => setTick((t) => t + 1)), [session]);

  // Successful steps -> guided actions. Each event arrives here exactly once.
  useEffect(() => {
    let map = initialGuideMap();
    return controller.onActivity((a) => {
      if (a.type === 'turn_started') session.newRun();
      else if (a.type === 'placed') session.receive(guideActionForPlaced(a.order, `placed:${a.proposalId}`));
      else {
        const r = mapGuideEvent(map, `${a.turnId}:${a.event.seq}`, a.event.event);
        map = r.state;
        if (r.action) session.receive(r.action);
      }
    });
  }, [controller, session]);

  // Any touch on the app (reported by the host) pauses guided navigation.
  useEffect(() => {
    setGuideTouchHandler(() => session.touch());
    return () => {
      setGuideTouchHandler(null);
      clearGuideHighlight();
    };
  }, [session]);

  useEffect(() => session.setOpen(open && canUse), [session, open, canUse]);

  const setMode = (m: GuideMode) => {
    setModeState(m);
    session.setMode(m);
    onModeChange?.(m);
  };

  const onPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (!canUse) {
      onSignInRequired?.();
      return;
    }
    setOpen(true);
  };

  const openOrder = onOpenOrder
    ? (orderId: string) => {
        if (mode === 'chat') setOpen(false);
        onOpenOrder(orderId);
      }
    : undefined;

  return (
    <>
      {visible && !open ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel="Open the Behtafood ordering assistant"
          style={({ pressed }) => [styles.fab, { bottom: bottomOffset, backgroundColor: colors.primary }, pressed && styles.pressed]}
        >
          <Ionicons name="sparkles" size={24} color={colors.white} />
        </Pressable>
      ) : null}
      {open && canUse && mode === 'guided' ? (
        <GuidedPanel controller={controller} session={session} onModeChange={setMode} onClose={() => setOpen(false)} onOpenOrder={openOrder} fly={fly} />
      ) : null}
      <Modal visible={open && canUse && mode === 'chat'} animationType="slide" onRequestClose={() => setOpen(false)}>
        <ChatPanel
          controller={controller}
          onClose={() => setOpen(false)}
          onOpenOrder={openOrder}
          mode={guidedAvailable ? mode : undefined}
          onModeChange={guidedAvailable ? setMode : undefined}
        />
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
});
