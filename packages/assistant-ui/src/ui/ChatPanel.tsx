// The chat: the customer's messages, the live action timeline under each one,
// the restaurant / cart / approval cards, the assistant's reply, and choice
// buttons when the assistant asked for a pick. The header holds the reply
// language dropdown. Motion is presentation only (see ./motion).
//
// Everything the customer reads is in the chosen language (./i18n). A sent
// photo is shown on its own (./PhotoView); text typed with it goes in a normal
// bubble underneath. Replies: 16 on 24, short paragraphs 8 apart, bold only for
// dish names and prices, tabular figures for prices.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { latestChoicePrompt, timelineRows, type ConversationState, type Turn } from '../logic/conversation';
import type { AssistantLanguage } from '../logic/language';
import { typingStatus, typingVisible } from '../logic/motion';
import type { ApprovalCardState } from '../logic/approval';
import type { TrackingState } from '../logic/tracking';
import { TrackingCard } from './TrackingCard';
import type { AssistantController } from '../logic/controller';
import { plainReply } from '../logic/format';
import { formatReply } from '../logic/replyFormat';
import { MAX_MESSAGE_CHARS, PHOTO_ONLY_TEXT } from '../logic/limits';
import type { GuideMode } from '../logic/guidedMode';
import { ModeToggle } from './ModeToggle';
import { PhotoButton, PhotoPreview } from './PhotoAttach';
import { SentPhoto } from './PhotoView';
import { ActionTimeline } from './ActionTimeline';
import { ApprovalCard } from './ApprovalCard';
import { CartCard, ChoiceChips, RestaurantCards } from './Cards';
import { LanguagePicker } from './LanguagePicker';
import { FadeSlideIn, RevealText, TypingDots } from './motion';
import { useAssistantState, useNow } from './hooks';
import { AssistantI18nProvider, useI18n } from './i18n';
import { useAssistantTheme } from './theme';

export interface ChatPanelProps {
  controller: AssistantController;
  onClose: () => void;
  onOpenOrder?: (orderId: string) => void;
  /** Overrides the translated title. */
  title?: string;
  /** When given, the header shows the Chat | Guided switch. */
  mode?: GuideMode;
  onModeChange?: (mode: GuideMode) => void;
  /** Called after the customer picks a reply language (to remember it). */
  onLanguageChange?: (language: AssistantLanguage) => void;
}

export function ChatPanel(props: ChatPanelProps) {
  const state = useAssistantState(props.controller);
  return (
    <AssistantI18nProvider language={state.language}>
      <ChatPanelBody {...props} />
    </AssistantI18nProvider>
  );
}

/** Dish names the assistant actually read in this conversation (bolded in replies). */
export function dishNamesOf(state: Pick<ConversationState, 'turns' | 'cards' | 'menuItems'>): string[] {
  const names = new Set<string>();
  for (const m of Object.values(state.menuItems)) names.add(m.itemName);
  for (const t of state.turns) for (const c of t.carts) for (const i of c.items) names.add(i.name);
  for (const c of Object.values(state.cards)) for (const l of c.proposal.lines) names.add(l.name);
  return [...names];
}

function ChatPanelBody({ controller, onClose, onOpenOrder, title, mode, onModeChange, onLanguageChange }: ChatPanelProps) {
  const { colors, fonts } = useAssistantTheme();
  const { t } = useI18n();
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
  const [existing] = useState(() => new Set(state.turns.map((tn) => tn.id)));
  const dishes = useMemo(() => dishNamesOf(state), [state.turns, state.cards, state.menuItems]);
  const chips = [t('chip.1'), t('chip.2'), t('chip.3')];

  useEffect(() => {
    const timer = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timer);
  }, [state.turns, state.cards]);

  const send = (text: string) => {
    if ((!text.trim() && !photo) || state.busy) return;
    setDraft('');
    setPhoto(null);
    follow.current = true;
    void controller.send(text, photo ?? undefined);
  };
  const canSend = !state.busy && (!!draft.trim() || !!photo);

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.white, paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { borderBottomColor: colors.greyLight }]}>
        <Avatar />
        <Text numberOfLines={1} style={[styles.headerTitle, { fontFamily: fonts.semibold, color: colors.black }]}>{title ?? t('chat.title')}</Text>
        <LanguagePicker
          value={state.language}
          onChange={(l) => {
            controller.setLanguage(l);
            onLanguageChange?.(l);
          }}
        />
        {mode && onModeChange ? <ModeToggle mode={mode} onChange={onModeChange} /> : null}
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('chat.close')} hitSlop={12}>
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
            <Text style={[styles.emptyTitle, { fontFamily: fonts.semibold, color: colors.black }]}>{t('chat.emptyTitle')}</Text>
            <Text style={[styles.intro, { fontFamily: fonts.regular, color: colors.greyDark }]}>{t('chat.emptyBody')}</Text>
            <View style={styles.suggestions}>
              {chips.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => send(s)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.suggestion, { borderColor: colors.greyLight, backgroundColor: pressed ? colors.accent : colors.offWhite }]}
                >
                  <Text style={[styles.chip, { fontFamily: fonts.medium, color: colors.black }]}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </FadeSlideIn>
        ) : null}

        {state.turns.map((tn) => (
          <TurnView
            key={tn.id}
            turn={tn}
            cards={state.cards}
            tracking={state.tracking}
            controller={controller}
            now={now}
            dishes={dishes}
            onOpenOrder={onOpenOrder}
            animate={!existing.has(tn.id)}
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
      {draft.length >= MAX_MESSAGE_CHARS ? (
        <Text style={[styles.photoError, { color: colors.greyDark, fontFamily: fonts.regular }]}>{t('chat.tooLong', { max: MAX_MESSAGE_CHARS })}</Text>
      ) : null}
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
          placeholder={state.busy ? t('chat.placeholderBusy') : t('chat.placeholder')}
          placeholderTextColor={colors.greyMedium}
          editable={!state.busy}
          multiline
          maxLength={MAX_MESSAGE_CHARS}
          style={[styles.input, { fontFamily: fonts.regular, color: colors.black, backgroundColor: colors.offWhite, borderColor: colors.greyLight }]}
          accessibilityLabel={t('chat.messageLabel')}
        />
        <Pressable
          onPress={() => send(draft)}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel={t('buttons.send')}
          style={[styles.send, { backgroundColor: colors.primary, opacity: canSend ? 1 : 0.4 }]}
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
  dishes: string[];
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

/** The finished reply: paragraphs 8 apart, bold dish names and prices, tabular figures for prices. */
function ReplyBody({ text, dishes }: { text: string; dishes: string[] }) {
  const { colors, fonts } = useAssistantTheme();
  const regular = fonts.replyRegular ?? fonts.regular;
  const bold = fonts.replyBold ?? fonts.bold;
  const paragraphs = formatReply(text, dishes);
  return (
    <View>
      {paragraphs.map((spans, i) => (
        <Text key={i} style={[styles.reply, { fontFamily: regular, color: colors.black }, i < paragraphs.length - 1 && styles.paragraphGap]}>
          {spans.map((s, j) => (
            <Text key={j} style={s.bold ? [{ fontFamily: bold }, s.price && styles.tabular] : undefined}>
              {s.text}
            </Text>
          ))}
        </Text>
      ))}
    </View>
  );
}

function TurnView({ turn, cards, tracking, controller, now, dishes, onOpenOrder, animate }: TurnViewProps) {
  const { colors, fonts } = useAssistantTheme();
  const { t, l } = useI18n();
  // The typing dots stand in for the "Working…" row; every other row is a real event.
  const rows = timelineRows(turn, cards, now).filter((r) => r.key !== 'working');
  const typing = typingVisible(turn);
  const status = typing ? typingStatus(turn) : null;
  const botBubble = [styles.botBubble, { backgroundColor: colors.offWhite, borderColor: colors.greyLight }];
  // A photo sent without words carries a stand-in text for the server; it is not shown.
  const typed = turn.photo && turn.userText === PHOTO_ONLY_TEXT ? '' : turn.userText;
  const reply = turn.reply ? plainReply(turn.reply) : '';
  return (
    <View style={styles.turn}>
      {turn.photo ? (
        <FadeSlideIn animate={animate} style={styles.photoRow}>
          <SentPhoto uri={turn.photo} />
        </FadeSlideIn>
      ) : null}
      {typed ? (
        <FadeSlideIn animate={animate} style={[styles.userBubble, turn.photo ? styles.underPhoto : null, { backgroundColor: colors.primary }]}>
          <Text style={[styles.userText, { fontFamily: fonts.medium, color: colors.white }]}>{typed}</Text>
        </FadeSlideIn>
      ) : null}

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
                {track ? <TrackingCard tracking={track} fulfilment={card.proposal.fulfilment} onRemind={(p) => void controller.remind(track.orderId, p)} /> : null}
              </FadeSlideIn>
            );
          })}
          {typing ? (
            <FadeSlideIn style={botBubble}>
              <TypingDots color={colors.primary} label={t('motion.working')} />
              {status ? (
                <Text numberOfLines={1} style={[styles.status, { fontFamily: fonts.regular, color: colors.greyDark }]}>
                  {l(status)}
                </Text>
              ) : null}
            </FadeSlideIn>
          ) : null}
          {reply ? (
            <FadeSlideIn animate={animate} style={botBubble}>
              <RevealText
                text={reply}
                animate={animate}
                hint={t('motion.tapToShow')}
                style={[styles.reply, { fontFamily: fonts.replyRegular ?? fonts.regular, color: colors.black }]}
                renderDone={() => <ReplyBody text={reply} dishes={dishes} />}
              />
            </FadeSlideIn>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// Type scale: title 17, reply 16/24, body 15/22, labels 13/18, small 12.
const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  headerTitle: { flex: 1, fontSize: 17, letterSpacing: -0.2 },
  content: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 28 },
  emptyTitle: { fontSize: 20, lineHeight: 28, marginBottom: 6 },
  intro: { fontSize: 15, lineHeight: 22, marginBottom: 16 },
  suggestions: { gap: 10 },
  suggestion: { borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  chip: { fontSize: 15, lineHeight: 22 },
  turn: { marginBottom: 24 },
  photoRow: { alignSelf: 'flex-end' },
  userBubble: { alignSelf: 'flex-end', maxWidth: '82%', borderRadius: 18, borderBottomRightRadius: 6, paddingVertical: 10, paddingHorizontal: 14 },
  underPhoto: { marginTop: 6 },
  userText: { fontSize: 16, lineHeight: 24 },
  botRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12 },
  botColumn: { flex: 1, minWidth: 0 },
  avatar: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  indent: { marginLeft: 36 },
  botBubble: { alignSelf: 'flex-start', maxWidth: '100%', borderWidth: 1, borderRadius: 18, borderTopLeftRadius: 6, paddingVertical: 12, paddingHorizontal: 14, marginTop: 10 },
  reply: { fontSize: 16, lineHeight: 24, textAlign: 'left' },
  paragraphGap: { marginBottom: 8 },
  tabular: { fontVariant: ['tabular-nums'] },
  status: { fontSize: 12, lineHeight: 16, marginTop: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: 1 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderRadius: 22, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 16 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  photoError: { fontSize: 12, paddingHorizontal: 12, paddingTop: 6 },
});
