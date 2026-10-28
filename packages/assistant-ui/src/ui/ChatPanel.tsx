// The chat: the customer's messages, the live action timeline under each one,
// the restaurant / cart / approval cards, the assistant's reply, and choice
// buttons when the assistant asked for a pick.

import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { latestChoicePrompt, timelineRows, type Turn } from '../logic/conversation';
import type { ApprovalCardState } from '../logic/approval';
import type { AssistantController } from '../logic/controller';
import { plainReply } from '../logic/format';
import type { GuideMode } from '../logic/guidedMode';
import { ModeToggle } from './ModeToggle';
import { ActionTimeline } from './ActionTimeline';
import { ApprovalCard } from './ApprovalCard';
import { CartCard, ChoiceChips, RestaurantCards } from './Cards';
import { useAssistantState, useNow } from './hooks';
import { useAssistantTheme } from './theme';

const SUGGESTIONS = [
  'Find me something filling around ₦3,000',
  'Jollof rice and chicken under ₦4,000',
  'What did I order last time?',
];

export interface ChatPanelProps {
  controller: AssistantController;
  onClose: () => void;
  onOpenOrder?: (orderId: string) => void;
  title?: string;
  /** When given, the header shows the Chat | Guided switch. */
  mode?: GuideMode;
  onModeChange?: (mode: GuideMode) => void;
}

export function ChatPanel({ controller, onClose, onOpenOrder, title = 'Behtafood Assistant', mode, onModeChange }: ChatPanelProps) {
  const { colors, fonts } = useAssistantTheme();
  const insets = useSafeAreaInsets();
  const state = useAssistantState(controller);
  const now = useNow(15_000);
  const [draft, setDraft] = useState('');
  const scroll = useRef<ScrollView>(null);
  const prompt = latestChoicePrompt(state);

  useEffect(() => {
    const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [state.turns, state.cards]);

  const send = (text: string) => {
    if (!text.trim() || state.busy) return;
    setDraft('');
    void controller.send(text);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.white, paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { borderBottomColor: colors.greyLight }]}>
        <Ionicons name="sparkles" size={18} color={colors.primary} />
        <Text style={[styles.headerTitle, { fontFamily: fonts.bold, color: colors.black }]}>{title}</Text>
        {mode && onModeChange ? <ModeToggle mode={mode} onChange={onModeChange} /> : null}
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close the assistant" hitSlop={12}>
          <Ionicons name="close" size={24} color={colors.greyDark} />
        </Pressable>
      </View>

      <ScrollView ref={scroll} style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {state.turns.length === 0 ? (
          <View>
            <Text style={[styles.intro, { fontFamily: fonts.regular, color: colors.greyDark }]}>
              Tell me what you feel like eating and your budget. I will find options, show you the real price, and order only when you tap Approve.
            </Text>
            <View style={styles.suggestions}>
              {SUGGESTIONS.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => send(s)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.suggestion, { borderColor: colors.greyLight, backgroundColor: pressed ? colors.accent : colors.offWhite }]}
                >
                  <Text style={[styles.body, { fontFamily: fonts.medium, color: colors.black }]}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {state.turns.map((t) => (
          <TurnView key={t.id} turn={t} cards={state.cards} controller={controller} now={now} onOpenOrder={onOpenOrder} />
        ))}

        {prompt ? <ChoiceChips prompt={prompt} disabled={state.busy} onPick={(o) => void controller.pickChoice(o)} /> : null}
      </ScrollView>

      <View style={[styles.inputRow, { borderTopColor: colors.greyLight, paddingBottom: Math.max(insets.bottom, 8) }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={state.busy ? 'Working on it…' : 'Ask for food, e.g. rice under ₦3,000'}
          placeholderTextColor={colors.greyMedium}
          editable={!state.busy}
          multiline
          maxLength={1000}
          style={[styles.input, { fontFamily: fonts.regular, color: colors.black, backgroundColor: colors.offWhite, borderColor: colors.greyLight }]}
          accessibilityLabel="Message to the assistant"
        />
        <Pressable
          onPress={() => send(draft)}
          disabled={state.busy || !draft.trim()}
          accessibilityRole="button"
          accessibilityLabel="Send"
          style={[styles.send, { backgroundColor: colors.primary, opacity: state.busy || !draft.trim() ? 0.4 : 1 }]}
        >
          <Ionicons name="arrow-up" size={20} color={colors.white} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

interface TurnViewProps {
  turn: Turn;
  cards: Record<string, ApprovalCardState>;
  controller: AssistantController;
  now: number;
  onOpenOrder?: (orderId: string) => void;
}

function TurnView({ turn, cards, controller, now, onOpenOrder }: TurnViewProps) {
  const { colors, fonts } = useAssistantTheme();
  return (
    <View style={styles.turn}>
      <View style={[styles.userBubble, { backgroundColor: colors.primary }]}>
        <Text style={[styles.body, { fontFamily: fonts.medium, color: colors.white }]}>{turn.userText}</Text>
      </View>
      <ActionTimeline rows={timelineRows(turn, cards, now)} />
      {turn.restaurants?.length ? <RestaurantCards restaurants={turn.restaurants} /> : null}
      {turn.carts.map((c) => (
        <CartCard key={c.cartId} cart={c} />
      ))}
      {turn.proposalIds.map((id) => {
        const card = cards[id];
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
      {turn.reply ? (
        <View style={[styles.botBubble, { backgroundColor: colors.greyLight }]}>
          <Text style={[styles.body, { fontFamily: fonts.regular, color: colors.black }]}>{plainReply(turn.reply)}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  headerTitle: { flex: 1, fontSize: 17 },
  content: { padding: 16, paddingBottom: 24 },
  intro: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  suggestions: { gap: 8 },
  suggestion: { borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  turn: { marginBottom: 16 },
  userBubble: { alignSelf: 'flex-end', maxWidth: '85%', borderRadius: 16, borderBottomRightRadius: 4, paddingVertical: 8, paddingHorizontal: 12 },
  botBubble: { alignSelf: 'flex-start', maxWidth: '90%', borderRadius: 16, borderBottomLeftRadius: 4, paddingVertical: 8, paddingHorizontal: 12, marginTop: 8 },
  body: { fontSize: 14, lineHeight: 20 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderRadius: 22, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 11, fontSize: 15 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
