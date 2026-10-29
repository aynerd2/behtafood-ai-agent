// The chat: the customer's messages, the live action timeline under each one,
// the restaurant / cart / approval cards, the assistant's reply, and choice
// buttons when the assistant asked for a pick. The header holds the reply
// language dropdown. Motion is presentation only (see ./motion).

import React, { useEffect, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { latestChoicePrompt, timelineRows, type Turn } from '../logic/conversation';
import type { AssistantLanguage } from '../logic/language';
import { typingStatus, typingVisible } from '../logic/motion';
import type { ApprovalCardState } from '../logic/approval';
import type { TrackingState } from '../logic/tracking';
import { TrackingCard } from './TrackingCard';
import type { AssistantController } from '../logic/controller';
import { plainReply } from '../logic/format';
import type { GuideMode } from '../logic/guidedMode';
import { ModeToggle } from './ModeToggle';
import { PhotoButton, PhotoPreview } from './PhotoAttach';
import { ActionTimeline } from './ActionTimeline';
import { ApprovalCard } from './ApprovalCard';
import { CartCard, ChoiceChips, RestaurantCards } from './Cards';
import { LanguagePicker } from './LanguagePicker';
import { FadeSlideIn, RevealText, TypingDots } from './motion';
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
  /** Called after the customer picks a reply language (to remember it). */
  onLanguageChange?: (language: AssistantLanguage) => void;
}

export function ChatPanel({ controller, onClose, onOpenOrder, title = 'Behtafood Assistant', mode, onModeChange, onLanguageChange }: ChatPanelProps) {
  const { colors, fonts } = useAssistantTheme();
  const insets = useSafeAreaInsets();
  const state = useAssistantState(controller);
  const now = useNow(15_000);
  const [draft, setDraft] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const follow = useRef(true);
  const prompt = latestChoicePrompt(state);
  // Turns already on screen when the panel opened are shown still; only new
  // ones animate in.
  const [existing] = useState(() => new Set(state.turns.map((t) => t.id)));

  useEffect(() => {
    const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [state.turns, state.cards]);

  const send = (text: string) => {
    if ((!text.trim() && !photo) || state.busy) return;
    setDraft('');
    setPhoto(null);
    follow.current = true;
    void controller.send(text, photo ?? undefined);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.white, paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { borderBottomColor: colors.greyLight }]}>
        <Avatar />
        <Text numberOfLines={1} style={[styles.headerTitle, { fontFamily: fonts.semibold, color: colors.black }]}>{title}</Text>
        <LanguagePicker
          value={state.language}
          onChange={(l) => {
            controller.setLanguage(l);
            onLanguageChange?.(l);
          }}
        />
        {mode && onModeChange ? <ModeToggle mode={mode} onChange={onModeChange} /> : null}
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close the assistant" hitSlop={12}>
          <Ionicons name="close" size={24} color={colors.greyDark} />
        </Pressable>
      </View>

      <ScrollView
        ref={scroll}
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        // Keep the newest text in view while it reveals, unless the customer scrolled away.
        onScrollBeginDrag={() => (follow.current = false)}
        onContentSizeChange={() => follow.current && scroll.current?.scrollToEnd({ animated: true })}
      >
        {state.turns.length === 0 ? (
          <FadeSlideIn>
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
          </FadeSlideIn>
        ) : null}

        {state.turns.map((t) => (
          <TurnView
            key={t.id}
            turn={t}
            cards={state.cards}
            tracking={state.tracking}
            controller={controller}
            now={now}
            onOpenOrder={onOpenOrder}
            animate={!existing.has(t.id)}
          />
        ))}

        {prompt ? (
          <FadeSlideIn style={styles.indent}>
            <ChoiceChips prompt={prompt} disabled={state.busy} onPick={(o) => void controller.pickChoice(o)} />
          </FadeSlideIn>
        ) : null}
      </ScrollView>

      {photo ? <PhotoPreview photo={photo} onRemove={() => setPhoto(null)} /> : null}
      {photoError ? <Text style={[styles.photoError, { color: colors.error, fontFamily: fonts.regular }]}>{photoError}</Text> : null}
      <View style={[styles.inputRow, { borderTopColor: colors.greyLight, paddingBottom: Math.max(insets.bottom, 8) }]}>
        <PhotoButton
          disabled={state.busy}
          onPhoto={(p) => {
            setPhoto(p);
            setPhotoError(null);
          }}
          onError={setPhotoError}
        />
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
          disabled={state.busy || (!draft.trim() && !photo)}
          accessibilityRole="button"
          accessibilityLabel="Send"
          style={[styles.send, { backgroundColor: colors.primary, opacity: state.busy || (!draft.trim() && !photo) ? 0.4 : 1 }]}
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
  tracking: Record<string, TrackingState>;
  controller: AssistantController;
  now: number;
  onOpenOrder?: (orderId: string) => void;
  /** False for turns that were already on screen when the panel opened. */
  animate: boolean;
}

/** The assistant's small round avatar. */
function Avatar() {
  const { colors } = useAssistantTheme();
  return (
    <View
      style={[styles.avatar, { backgroundColor: colors.accent, borderColor: colors.greyLight }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Ionicons name="sparkles" size={13} color={colors.primary} />
    </View>
  );
}

function TurnView({ turn, cards, tracking, controller, now, onOpenOrder, animate }: TurnViewProps) {
  const { colors, fonts } = useAssistantTheme();
  // The typing dots stand in for the "Working…" row; every other row is a real event.
  const rows = timelineRows(turn, cards, now).filter((r) => r.key !== 'working');
  const typing = typingVisible(turn);
  const status = typing ? typingStatus(turn) : null;
  const botBubble = [styles.botBubble, { backgroundColor: colors.offWhite, borderColor: colors.greyLight }];
  return (
    <View style={styles.turn}>
      <FadeSlideIn animate={animate} style={[styles.userBubble, { backgroundColor: colors.primary }]}>
        {turn.photo ? <Image source={{ uri: turn.photo }} style={styles.sentPhoto} accessibilityLabel="Your photo" /> : null}
        <Text style={[styles.body, { fontFamily: fonts.medium, color: colors.white }]}>{turn.userText}</Text>
      </FadeSlideIn>

      <View style={styles.botRow}>
        <Avatar />
        <View style={styles.botColumn}>
          <ActionTimeline rows={rows} animate={animate} />
          {turn.restaurants?.length ? (
            <FadeSlideIn animate={animate}>
              <RestaurantCards restaurants={turn.restaurants} />
            </FadeSlideIn>
          ) : null}
          {turn.carts.map((c) => (
            <FadeSlideIn key={c.cartId} animate={animate}>
              <CartCard cart={c} />
            </FadeSlideIn>
          ))}
          {turn.proposalIds.map((id) => {
            const card = cards[id];
            if (!card) return null;
            const track = card.order ? tracking[card.order.orderId] : undefined;
            return (
              <FadeSlideIn key={id} animate={animate}>
                <ApprovalCard
                  card={card}
                  now={now}
                  onApprove={() => void controller.approve(id)}
                  onCancel={() => void controller.cancel(id)}
                  onAskAgain={() => void controller.askAgain(id)}
                  onOpenOrder={onOpenOrder}
                />
                {track ? <TrackingCard tracking={track} onRemind={(p) => void controller.remind(track.orderId, p)} /> : null}
              </FadeSlideIn>
            );
          })}
          {typing ? (
            <FadeSlideIn style={botBubble}>
              <TypingDots color={colors.primary} />
              {status ? (
                <Text numberOfLines={1} style={[styles.status, { fontFamily: fonts.regular, color: colors.greyDark }]}>
                  {status}
                </Text>
              ) : null}
            </FadeSlideIn>
          ) : null}
          {turn.reply ? (
            <FadeSlideIn animate={animate} style={botBubble}>
              <RevealText
                text={plainReply(turn.reply)}
                animate={animate}
                style={[styles.body, { fontFamily: fonts.regular, color: colors.black }]}
              />
            </FadeSlideIn>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// Type scale: title 17, body 15/22, labels 13/18, small 12.
const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  headerTitle: { flex: 1, fontSize: 17, letterSpacing: -0.2 },
  content: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 28 },
  intro: { fontSize: 15, lineHeight: 22, marginBottom: 16 },
  suggestions: { gap: 10 },
  suggestion: { borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  turn: { marginBottom: 24 },
  userBubble: { alignSelf: 'flex-end', maxWidth: '82%', borderRadius: 18, borderBottomRightRadius: 6, paddingVertical: 10, paddingHorizontal: 14 },
  botRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12 },
  botColumn: { flex: 1, minWidth: 0 },
  avatar: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  indent: { marginLeft: 36 },
  botBubble: { alignSelf: 'flex-start', maxWidth: '100%', borderWidth: 1, borderRadius: 18, borderTopLeftRadius: 6, paddingVertical: 10, paddingHorizontal: 14, marginTop: 10 },
  body: { fontSize: 15, lineHeight: 22 },
  status: { fontSize: 12, lineHeight: 16, marginTop: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: 1 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderRadius: 22, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 15 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  photoError: { fontSize: 12, paddingHorizontal: 12, paddingTop: 6 },
  sentPhoto: { width: 120, height: 120, borderRadius: 12, marginBottom: 6 },
});
