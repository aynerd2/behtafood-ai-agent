// The floating button and the full-screen chat it opens.
//
// The host app decides WHEN the button shows (`visible`) and whether the
// customer may use it (`canUse`, i.e. signed in). Keep this mounted while the
// app runs so the conversation survives closing and reopening the panel.

import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ChatPanel } from './ChatPanel';
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

function FloatingAssistantInner({ apiUrl, getToken, visible, canUse, onSignInRequired, onOpenOrder, bottomOffset = 96 }: FloatingAssistantProps) {
  const { colors } = useAssistantTheme();
  const controller = useAssistantController({ apiUrl, getToken });
  const [open, setOpen] = useState(false);

  const onPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (!canUse) {
      onSignInRequired?.();
      return;
    }
    setOpen(true);
  };

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
      <Modal visible={open && canUse} animationType="slide" onRequestClose={() => setOpen(false)}>
        <ChatPanel
          controller={controller}
          onClose={() => setOpen(false)}
          onOpenOrder={
            onOpenOrder
              ? (orderId) => {
                  setOpen(false);
                  onOpenOrder(orderId);
                }
              : undefined
          }
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
