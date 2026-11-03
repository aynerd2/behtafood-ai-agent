// Attach one food photo: pick it from the library (expo-image-picker), shrink
// it so the longest edge is 1024 px and save it as JPEG (an invisible
// react-native-webview canvas does this, so no extra native module is
// needed), check it, and show a small preview with a remove button.
//
// Peers: expo-image-picker and react-native-webview (both already in the
// Behtafood customer app).

import React, { useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { PHOTO_JPEG_QUALITY, PHOTO_MAX_EDGE, checkPhoto } from '../logic/photo';
import { PREVIEW_SIZE, REMOVE_BUTTON_SIZE } from '../logic/photoLayout';
import { useI18n } from './i18n';
import { useAssistantTheme } from './theme';

// Draws the photo onto a canvas at the smaller size and returns a JPEG.
const RESIZER_HTML = `<!doctype html><html><body><script>
window.resizePhoto = function (src, max, quality) {
  var img = new Image();
  img.onload = function () {
    var s = Math.min(1, max / Math.max(img.width, img.height));
    var w = Math.round(img.width * s), h = Math.round(img.height * s);
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
    window.ReactNativeWebView.postMessage(JSON.stringify({ ok: true, data: c.toDataURL('image/jpeg', quality) }));
  };
  img.onerror = function () { window.ReactNativeWebView.postMessage(JSON.stringify({ ok: false })); };
  img.src = src;
};
window.ReactNativeWebView.postMessage(JSON.stringify({ ready: true }));
</script></body></html>`;

const RESIZE_TIMEOUT_MS = 10_000;

export interface PhotoButtonProps {
  disabled?: boolean;
  /** Called with a checked JPEG or PNG data URL, ready to send. */
  onPhoto: (dataUrl: string) => void;
  onError: (message: string) => void;
}

/** The attach button, plus the invisible resizer while a photo is being prepared. */
export function PhotoButton({ disabled, onPhoto, onError }: PhotoButtonProps) {
  const { colors } = useAssistantTheme();
  const { t } = useI18n();
  const [source, setSource] = useState<string | null>(null);
  const web = useRef<WebView>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const done = (result: string | null) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const original = source;
    setSource(null);
    if (result && checkPhoto(result)) onPhoto(result);
    else if (original && checkPhoto(original)) onPhoto(original); // resizing failed, but the original already fits
    else onError(t('photo.prepareFailed'));
  };

  const pick = async () => {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, base64: true });
      const asset = r.canceled ? undefined : r.assets?.[0];
      if (!asset?.base64) return;
      const mime = asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
      setSource(`data:${mime};base64,${asset.base64}`);
      timer.current = setTimeout(() => done(null), RESIZE_TIMEOUT_MS);
    } catch {
      onError(t('photo.openFailed'));
    }
  };

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: { ready?: boolean; ok?: boolean; data?: string };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.ready && source) {
      web.current?.injectJavaScript(`window.resizePhoto(${JSON.stringify(source)}, ${PHOTO_MAX_EDGE}, ${PHOTO_JPEG_QUALITY}); true;`);
    } else if (msg.ok !== undefined) {
      done(msg.ok && typeof msg.data === 'string' ? msg.data : null);
    }
  };

  const busy = !!source;
  return (
    <>
      <Pressable
        onPress={pick}
        disabled={disabled || busy}
        accessibilityRole="button"
        accessibilityLabel={t('photo.attach')}
        style={[styles.button, { borderColor: colors.greyLight, backgroundColor: colors.offWhite, opacity: disabled ? 0.4 : 1 }]}
      >
        {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="image-outline" size={20} color={colors.primary} />}
      </Pressable>
      {source ? (
        <View style={styles.hidden} pointerEvents="none">
          <WebView ref={web} originWhitelist={['*']} source={{ html: RESIZER_HTML }} onMessage={onMessage} javaScriptEnabled style={styles.hidden} />
        </View>
      ) : null}
    </>
  );
}

/** The attached photo before sending (96 pt), with a clear remove button. */
export function PhotoPreview({ photo, onRemove }: { photo: string; onRemove: () => void }) {
  const { colors, fonts } = useAssistantTheme();
  const { t } = useI18n();
  return (
    <View style={styles.previewRow}>
      <View>
        <Image source={{ uri: photo }} style={[styles.thumb, { borderColor: colors.greyLight }]} accessibilityLabel={t('photo.attached')} />
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={t('photo.remove')}
          hitSlop={10}
          style={[styles.remove, { backgroundColor: colors.black, borderColor: colors.white }]}
        >
          <Ionicons name="close" size={16} color={colors.white} />
        </Pressable>
      </View>
      <Text style={{ flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.greyDark }}>
        {t('photo.attachedHint')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12, paddingTop: 12 },
  thumb: { width: PREVIEW_SIZE, height: PREVIEW_SIZE, borderRadius: 14, borderWidth: 1 },
  remove: {
    position: 'absolute', top: -8, right: -8, width: REMOVE_BUTTON_SIZE, height: REMOVE_BUTTON_SIZE,
    borderRadius: REMOVE_BUTTON_SIZE / 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center',
  },
});
