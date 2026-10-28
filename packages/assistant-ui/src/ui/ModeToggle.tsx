// Chat | Guided switch, shown in the chat header and on the guided bar.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GuideMode } from '../logic/guidedMode';
import { useAssistantTheme } from './theme';

export function ModeToggle({ mode, onChange, compact = false }: { mode: GuideMode; onChange: (m: GuideMode) => void; compact?: boolean }) {
  const { colors, fonts } = useAssistantTheme();
  const option = (m: GuideMode, label: string) => {
    const on = mode === m;
    return (
      <Pressable
        key={m}
        onPress={() => !on && onChange(m)}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${label} mode`}
        style={[styles.option, compact && styles.compact, { backgroundColor: on ? colors.primary : 'transparent' }]}
      >
        <Text style={[styles.text, { fontFamily: fonts.semibold, color: on ? colors.white : colors.primary }]}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={[styles.wrap, { borderColor: colors.primary }]}>
      {option('chat', 'Chat')}
      {option('guided', 'Guided')}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', borderWidth: 1, borderRadius: 999, overflow: 'hidden' },
  option: { paddingVertical: 6, paddingHorizontal: 12 },
  compact: { paddingVertical: 4, paddingHorizontal: 9 },
  text: { fontSize: 12 },
});
