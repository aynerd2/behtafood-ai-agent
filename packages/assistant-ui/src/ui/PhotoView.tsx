// A sent photo, shown on its own: no bubble behind it, rounded corners, about
// 75% of the screen width in its own shape (height capped). Tapping opens it
// full screen with pinch zoom.
//
// Pinch uses react-native-gesture-handler (already in the customer app) with
// React Native's own Animated; no other library.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView, PinchGestureHandler, State, type PinchGestureHandlerStateChangeEvent } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { clampZoom, fitPhotoSize, sentPhotoSize, type Size } from '../logic/photoLayout';
import { useI18n } from './i18n';
import { useAssistantTheme } from './theme';

function useNaturalSize(uri: string): Size | null {
  const [size, setSize] = useState<Size | null>(null);
  useEffect(() => {
    let live = true;
    Image.getSize(uri, (width, height) => live && setSize({ width, height }), () => live && setSize(null));
    return () => {
      live = false;
    };
  }, [uri]);
  return size;
}

export function SentPhoto({ uri }: { uri: string }) {
  const { t } = useI18n();
  const screen = useWindowDimensions();
  const natural = useNaturalSize(uri);
  const size = sentPhotoSize(screen, natural);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="imagebutton" accessibilityLabel={t('photo.open')} style={styles.sentWrap}>
        <Image source={{ uri }} style={[styles.sent, size]} resizeMode="cover" accessibilityLabel={t('chat.yourPhoto')} />
      </Pressable>
      {open ? <PhotoViewer uri={uri} natural={natural} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function PhotoViewer({ uri, natural, onClose }: { uri: string; natural: Size | null; onClose: () => void }) {
  const { t } = useI18n();
  const { colors } = useAssistantTheme();
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const fit = fitPhotoSize(screen, natural);
  const base = useRef(1);
  const pinch = useRef(new Animated.Value(1)).current;
  const baseScale = useRef(new Animated.Value(1)).current;
  const scale = Animated.multiply(baseScale, pinch);

  const onPinch = Animated.event([{ nativeEvent: { scale: pinch } }], { useNativeDriver: true });
  const onPinchState = (e: PinchGestureHandlerStateChangeEvent) => {
    if (e.nativeEvent.oldState === State.ACTIVE) {
      base.current = clampZoom(base.current * e.nativeEvent.scale);
      baseScale.setValue(base.current);
      pinch.setValue(1);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={[styles.viewer, { backgroundColor: colors.black }]}>
        <PinchGestureHandler onGestureEvent={onPinch} onHandlerStateChange={onPinchState}>
          <Animated.View style={styles.center}>
            <Animated.Image source={{ uri }} style={[fit, { transform: [{ scale }] }]} resizeMode="contain" accessibilityLabel={t('chat.yourPhoto')} />
          </Animated.View>
        </PinchGestureHandler>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('photo.close')}
          hitSlop={12}
          style={[styles.close, { top: insets.top + 12 }]}
        >
          <Ionicons name="close" size={26} color={colors.white} />
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sentWrap: { alignSelf: 'flex-end' },
  sent: { borderRadius: 16 },
  viewer: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', right: 16, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
});
