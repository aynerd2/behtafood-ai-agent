// Guided mode's panel: a small bar while the assistant works (screens move
// beneath it), expanding to a sheet for the approval card and for any
// question or choice. Stop is always on screen.

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Dimensions, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { latestChoicePrompt, timelineRows } from '../logic/conversation';
import type { AssistantController } from '../logic/controller';
import { choicesText, plainReply } from '../logic/format';
import { guidedLayout, type GuideMode, type GuideSession } from '../logic/guidedMode';
import { ApprovalCard } from './ApprovalCard';
import { ChoiceChips } from './Cards';
import { useAssistantState, useNow } from './hooks';
import { ModeToggle } from './ModeToggle';
import { useAssistantTheme } from './theme';

const SUGGESTIONS = ['Jollof rice and chicken under ₦4,000', 'Find me something filling around ₦3,000'];

export interface GuidedPanelProps {
  controller: AssistantController;
  session: GuideSession;
  onModeChange: (m: GuideMode) => void;
  onClose: () => void;
  onOpenOrder?: (orderId: string) => void;
  /** Dishes flying into the AI's cart (key changes per animation). */
  fly?: { key: string; label: string } | null;
}

export function GuidedPanel({ controller, session, onModeChange, onClose, onOpenOrder, fly }: GuidedPanelProps) {
  const { colors, fonts } = useAssistantTheme();
  const insets = useSafeAreaInsets();
  const state = useAssistantState(controller);
  const now = useNow(15_000);
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);
  const auto = guidedLayout(state, now);
  const sheet = auto === 'sheet' || expanded;
  const turn = state.turns.at(-1);
  const prompt = latestChoicePrompt(state);
  const lastCart = turn?.carts.at(-1);

  // A new message collapses a manually expanded sheet back to the bar.
  useEffect(() => controller.onActivity((a) => a.type === 'turn_started' && setExpanded(false)), [controller]);

  const status = session.status;
  const working = turn && (turn.status === 'sending' || turn.status === 'running');
  const stepLabel =
    status === 'paused'
      ? "Paused: you're in control."
      : status === 'stopped'
        ? "Stopped. Screens won't move until your next message."
        : session.current?.label ?? (working ? 'Working…' : 'Ask me for food and a budget.');

  const send = (text: string) => {
    if (!text.trim() || state.busy) return;
    setDraft('');
    void controller.send(text);
  };

  const controls = (
    <View style={styles.controls}>
      <ModeToggle mode="guided" onChange={onModeChange} compact />
      {status === 'paused' ? (
        <SmallButton icon="play" label="Resume" onPress={() => session.resume()} />
      ) : status === 'stopped' ? null : (
        <SmallButton icon="stop" label="Stop" danger onPress={() => session.stop()} />
      )}
      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close the assistant" hitSlop={10}>
        <Ionicons name="close" size={22} color={colors.greyDark} />
      </Pressable>
    </View>
  );

  const barLine = (
    <Pressable
      onPress={() => setExpanded((e) => !e)}
      accessibilityRole="button"
      accessibilityLabel={sheet ? 'Collapse the assistant' : 'Expand the assistant'}
      style={styles.stepRow}
    >
      {working && status === 'navigating' ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Ionicons name={status === 'paused' ? 'pause-circle' : status === 'stopped' ? 'stop-circle' : 'sparkles'} size={18} color={status === 'stopped' ? colors.error : colors.primary} />
      )}
      <Text numberOfLines={2} style={[styles.stepText, { fontFamily: fonts.medium, color: colors.black }]}>
        {stepLabel}
      </Text>
      <Ionicons name={sheet ? 'chevron-down' : 'chevron-up'} size={18} color={colors.greyMedium} />
    </Pressable>
  );

  return (
    <>
      {fly ? <CartFly key={fly.key} label={fly.label} /> : null}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 8) }]}
        pointerEvents="box-none"
      >
        <View style={[styles.panel, { backgroundColor: colors.white, borderColor: colors.greyLight }, sheet && { maxHeight: Dimensions.get('window').height * 0.7 }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { fontFamily: fonts.bold, color: colors.black }]}>Behtafood Assistant</Text>
            {controls}
          </View>
          {barLine}
          {lastCart ? (
            <Text numberOfLines={2} style={[styles.cartLine, { fontFamily: fonts.regular, color: colors.greyDark }]}>
              <Ionicons name="cart-outline" size={12} color={colors.primary} /> AI cart:{' '}
              {lastCart.items.map((i) => `${i.quantity} x ${i.name}${i.choices?.length ? ` (${choicesText(i.choices)})` : ''}`).join(', ')}
            </Text>
          ) : null}

          {sheet ? (
            <>
              <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
                {!turn ? (
                  <View style={styles.suggestions}>
                    {SUGGESTIONS.map((s) => (
                      <Pressable key={s} onPress={() => send(s)} style={[styles.suggestion, { borderColor: colors.greyLight, backgroundColor: colors.offWhite }]}>
                        <Text style={{ fontFamily: fonts.medium, color: colors.black, fontSize: 14 }}>{s}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {turn ? (
                  <Text style={[styles.you, { fontFamily: fonts.medium, color: colors.greyDark }]} numberOfLines={2}>
                    You: {turn.userText}
                  </Text>
                ) : null}
                {turn?.error ? <Text style={{ color: colors.error, fontFamily: fonts.regular, fontSize: 14 }}>{turn.error.message}</Text> : null}
                {turn?.reply ? <Text style={[styles.reply, { fontFamily: fonts.regular, color: colors.black }]}>{plainReply(turn.reply)}</Text> : null}
                {turn?.proposalIds.map((id) => {
                  const card = state.cards[id];
                  if (!card) return null;
                  return (
                    <ApprovalCard
                      key={id}
                      card={card}
                      now={now}
                      onApprove={() => void controller.approve(id)}
                      onCancel={() => void controller.cancel(id)}
                      onAskAgain={() => void controller.askAgain(id)}
                      onOpenOrder={onOpenOrder}
                    />
                  );
                })}
                {prompt ? <ChoiceChips prompt={prompt} disabled={state.busy} onPick={(o) => void controller.pickChoice(o)} /> : null}
                {turn && timelineRows(turn, state.cards, now).some((r) => r.status === 'failed') ? (
                  <Text style={[styles.hint, { fontFamily: fonts.regular, color: colors.greyMedium }]}>Switch to Chat to see every step.</Text>
                ) : null}
              </ScrollView>
              <View style={[styles.inputRow, { borderTopColor: colors.greyLight }]}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={state.busy ? 'Working on it…' : 'Reply or ask for food'}
                  placeholderTextColor={colors.greyMedium}
                  editable={!state.busy}
                  style={[styles.input, { fontFamily: fonts.regular, color: colors.black, backgroundColor: colors.offWhite, borderColor: colors.greyLight }]}
                  onSubmitEditing={() => send(draft)}
                  returnKeyType="send"
                  accessibilityLabel="Message to the assistant"
                />
                <Pressable
                  onPress={() => send(draft)}
                  disabled={state.busy || !draft.trim()}
                  accessibilityRole="button"
                  accessibilityLabel="Send"
                  style={[styles.send, { backgroundColor: colors.primary, opacity: state.busy || !draft.trim() ? 0.4 : 1 }]}
                >
                  <Ionicons name="arrow-up" size={18} color={colors.white} />
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

function SmallButton({ icon, label, onPress, danger }: { icon: 'stop' | 'play'; label: string; onPress: () => void; danger?: boolean }) {
  const { colors, fonts } = useAssistantTheme();
  const tint = danger ? colors.error : colors.primary;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={[styles.small, { borderColor: tint }]} hitSlop={6}>
      <Ionicons name={icon} size={12} color={tint} />
      <Text style={{ color: tint, fontFamily: fonts.semibold, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

/** A dish label gliding down into the AI's cart (shown on the bar). Display only. */
function CartFly({ label }: { label: string }) {
  const { colors, fonts } = useAssistantTheme();
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 1100, useNativeDriver: true }).start();
  }, [t]);
  const { height } = Dimensions.get('window');
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.fly,
        { backgroundColor: colors.primary, top: height * 0.4 },
        {
          opacity: t.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 1, 1, 0] }),
          transform: [
            { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, height * 0.45] }) },
            { scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 0.6] }) },
          ],
        },
      ]}
    >
      <Text numberOfLines={1} style={{ color: colors.white, fontFamily: fonts.semibold, fontSize: 13 }}>
        ＋ {label} → AI cart
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10 },
  panel: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 14, flexShrink: 1 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  stepText: { flex: 1, fontSize: 13, lineHeight: 18 },
  cartLine: { fontSize: 12, lineHeight: 16, marginBottom: 4 },
  sheetScroll: { flexGrow: 0 },
  sheetContent: { paddingBottom: 8, gap: 6 },
  suggestions: { gap: 8 },
  suggestion: { borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  you: { fontSize: 12 },
  reply: { fontSize: 14, lineHeight: 20 },
  hint: { fontSize: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, paddingTop: 8 },
  input: { flex: 1, height: 40, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, fontSize: 14 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  small: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 9 },
  fly: { position: 'absolute', alignSelf: 'center', left: 40, right: 40, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, alignItems: 'center', zIndex: 50, elevation: 12 },
});
