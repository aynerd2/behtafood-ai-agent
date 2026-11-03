// Fixed texts the SERVER sends (redirects, refusals, errors) and the names of
// the on-screen buttons, in every assistant language.
//
// The app's own interface strings live in packages/assistant-ui/src/i18n.
// The button names here must match that file exactly (a test checks), because
// they are passed to the model so it names the button the customer sees.
//
// Yoruba, Hausa and Igbo are UNVERIFIED DRAFTS awaiting native-speaker review
// (see TRANSLATIONS_REVIEW.md). English is the fallback for a missing key.

import type { AssistantLanguage } from './prompt';

export type UiLanguage = 'en' | 'pcm' | 'yo' | 'ha' | 'ig';

export const SERVER_MESSAGE_KEYS = [
  'redirect', 'healthRefusal', 'tooLong', 'empty', 'rateLimited', 'spendCap',
  'callCap', 'modelUnavailable', 'imageRefusal', 'fallbackReply',
  'walletShort', 'walletOnly', 'addAddress',
] as const;
export type ServerMessageKey = (typeof SERVER_MESSAGE_KEYS)[number];

export const BUTTON_KEYS = ['approve', 'cancel', 'askAgain', 'viewOrder', 'send'] as const;
export type ButtonKey = (typeof BUTTON_KEYS)[number];

type Table = Record<ServerMessageKey, string> & { buttons: Record<ButtonKey, string> };

export const SERVER_MESSAGES: Record<UiLanguage, Table> = {
  en: {
    redirect: 'I can only help with food and orders on Behtafood. What would you like to eat?',
    healthRefusal: "I can't give health, allergy or nutrition advice. Please ask the restaurant about ingredients, or a health professional about your diet. I can still help you find and order food.",
    tooLong: 'Please keep your message under {max} characters.',
    empty: 'Please type a message.',
    rateLimited: 'Too many messages. Please wait a minute and try again.',
    spendCap: 'The assistant has reached its limit for today. Please order from the menu as usual.',
    callCap: 'That took too many steps, so I stopped. Please ask in a simpler way.',
    modelUnavailable: 'The assistant is unavailable right now. Please try again shortly.',
    imageRefusal: 'Photos must be JPEG or PNG and at most 1.5 MB.',
    fallbackReply: "Sorry, I couldn't answer that. Please try again.",
    walletShort: "Your wallet is short by {amount}. Top up in Wallet in the app, or choose pickup or a cheaper option.",
    walletOnly: "I can only pay from your Behtafood wallet. To pay by card or cash, use the normal checkout in the app.",
    addAddress: "To get delivery, add a delivery address in the app first.",
    buttons: { approve: 'Approve', cancel: 'Cancel', askAgain: 'Ask again', viewOrder: 'View order', send: 'Send' },
  },
  pcm: {
    redirect: 'Na only food and orders for Behtafood I fit help you with. Wetin you wan chop?',
    healthRefusal: 'I no fit give health, allergy or nutrition advice. Ask the restaurant wetin dem put for the food. I still fit help you find food.',
    tooLong: 'Abeg, make your message no pass {max} letters.',
    empty: 'Abeg, type something.',
    rateLimited: 'Message don too much. Wait one minute, then try again.',
    spendCap: 'The assistant don reach im limit for today. Abeg order from the menu as you dey do before.',
    callCap: 'E take too many steps, so I stop. Abeg ask am simple.',
    modelUnavailable: 'The assistant no dey available now. Abeg try again small time.',
    imageRefusal: 'I no fit read this photo. Abeg send small JPEG or PNG photo.',
    fallbackReply: 'Sorry, I no fit answer that one. Abeg try again.',
    walletShort: "Your wallet dey short by {amount}. Top up for Wallet inside the app, or choose pickup or something wey cheap pass.",
    walletOnly: "Na only your Behtafood wallet I fit take pay. If you wan pay with card or cash, use the normal checkout for the app.",
    addAddress: "If you want delivery, first add delivery address for the app.",
    buttons: { approve: 'Approve', cancel: 'Cancel', askAgain: 'Ask again', viewOrder: 'See order', send: 'Send' },
  },
  yo: {
    redirect: 'Oúnjẹ àti àṣẹ lórí Behtafood nìkan ni mo lè bá ọ ṣe. Kí lo fẹ́ jẹ?',
    healthRefusal: 'Mi ò lè fún ọ ní ìmọ̀ràn nípa ìlera, àléjì tàbí oúnjẹ aṣaralóore. Bi ilé oúnjẹ léèrè ohun tí wọ́n fi sè é. Mo ṣì lè bá ọ wá oúnjẹ.',
    tooLong: 'Jọ̀ọ́, má jẹ́ kí ọ̀rọ̀ rẹ ju lẹ́tà {max} lọ.',
    empty: 'Jọ̀ọ́, kọ nǹkan síbí.',
    rateLimited: 'Ọ̀rọ̀ ti pọ̀ jù. Dúró fún ìṣẹ́jú kan, kí o tún gbìyànjú.',
    spendCap: 'Olùrànlọ́wọ́ ti dé òpin rẹ̀ fún òní. Jọ̀ọ́, pàṣẹ láti inú àtòjọ oúnjẹ bí o ti máa ń ṣe.',
    callCap: 'Ó gba ìgbésẹ̀ tó pọ̀ jù, mo dá dúró. Jọ̀ọ́, béèrè ní ọ̀nà tó rọrùn.',
    modelUnavailable: 'Olùrànlọ́wọ́ kò sí báyìí. Jọ̀ọ́, gbìyànjú lẹ́ẹ̀kan sí i láìpẹ́.',
    imageRefusal: 'Mi ò lè ka fọ́tò yìí. Jọ̀ọ́, fi fọ́tò JPEG tàbí PNG kékeré ránṣẹ́.',
    fallbackReply: 'Ẹ má bínú, mi ò lè dáhùn ìyẹn. Jọ̀ọ́, gbìyànjú lẹ́ẹ̀kan sí i.',
    walletShort: "Owó inú àpò rẹ kù ní {amount}. Fi owó sí i nínú Wallet nínú áàpù, tàbí yan pickup tàbí oúnjẹ tó dín owó.",
    walletOnly: "Láti inú àpò owó Behtafood rẹ nìkan ni mo lè sanwó. Láti san pẹ̀lú káàdì tàbí owó lọ́wọ́, lo checkout déédéé nínú áàpù.",
    addAddress: "Kí a tó lè gbé e wá, kọ́kọ́ fi àdírẹ́sì ìgbéwá kún un nínú áàpù.",
    buttons: { approve: 'Fọwọ́ sí i', cancel: 'Fagilé', askAgain: 'Béèrè lẹ́ẹ̀kan sí i', viewOrder: 'Wo àṣẹ', send: 'Fi ránṣẹ́' },
  },
  ha: {
    redirect: 'Abinci da oda a Behtafood kawai zan iya taimaka maka da su. Me kake so ka ci?',
    healthRefusal: 'Ba zan iya ba da shawara kan lafiya, rashin jituwar abinci ko gina jiki ba. Tambayi gidan abincin abin da suka sa a ciki. Har yanzu zan iya taimaka maka ka sami abinci.',
    tooLong: 'Don Allah, kada saƙonka ya wuce haruffa {max}.',
    empty: 'Don Allah, rubuta saƙo.',
    rateLimited: 'Saƙonni sun yi yawa. Jira minti ɗaya, sannan ka sake gwadawa.',
    spendCap: 'Mataimakin ya kai iyakarsa ta yau. Don Allah, yi oda daga menu kamar yadda ka saba.',
    callCap: 'Ya ɗauki matakai da yawa, don haka na tsaya. Don Allah, ka tambaya a sauƙaƙe.',
    modelUnavailable: 'Mataimakin ba ya samuwa yanzu. Don Allah, sake gwadawa nan ba da jimawa ba.',
    imageRefusal: 'Ba zan iya karanta wannan hoton ba. Don Allah, aika ƙaramin hoton JPEG ko PNG.',
    fallbackReply: 'Yi haƙuri, ban iya amsa wannan ba. Don Allah, sake gwadawa.',
    walletShort: "Kuɗin walat ɗinka ya rage {amount}. Ƙara kuɗi a Wallet cikin manhajar, ko ka zaɓi pickup ko abinci mai rahusa.",
    walletOnly: "Daga walat ɗinka na Behtafood kawai zan iya biya. Don biya da kati ko tsabar kuɗi, yi amfani da checkout na yau da kullum a manhajar.",
    addAddress: "Don a kawo maka, fara ƙara adireshin kawowa a manhajar.",
    buttons: { approve: 'Amince', cancel: 'Soke', askAgain: 'Sake tambaya', viewOrder: 'Duba oda', send: 'Aika' },
  },
  ig: {
    redirect: 'Ọ bụ naanị nri na ịtụ nri na Behtafood ka m nwere ike inyere gị aka. Gịnị ka ị chọrọ iri?',
    healthRefusal: 'Enweghị m ike inye ndụmọdụ gbasara ahụike, nfụkasị ahụ ma ọ bụ nri na-edozi ahụ. Jụọ ụlọ nri ihe ha tinyere na nri ahụ. Enwere m ike inyere gị aka ịchọta nri.',
    tooLong: 'Biko, ozi gị agafela mkpụrụedemede {max}.',
    empty: 'Biko, dee ozi.',
    rateLimited: 'Ozi ahụ dị ọtụtụ. Chere otu nkeji, wee nwaa ọzọ.',
    spendCap: 'Onye enyemaka eruola oke ya taa. Biko, tụọ nri site na menu dịka ị na-eme.',
    callCap: 'O were ọtụtụ nzọụkwụ, ya mere m kwụsịrị. Biko, jụọ ya n’ụzọ dị mfe.',
    modelUnavailable: 'Onye enyemaka adịghị ugbu a. Biko, nwaa ọzọ n’oge na-adịghị anya.',
    imageRefusal: 'Enweghị m ike ịgụ foto a. Biko, zipu obere foto JPEG ma ọ bụ PNG.',
    fallbackReply: 'Ndo, enweghị m ike ịza nke ahụ. Biko, nwaa ọzọ.',
    walletShort: "Ego dị n’obere akpa gị fọdụrụ {amount}. Tinye ego na Wallet n’ime ngwa ahụ, ma ọ bụ họrọ pickup ma ọ bụ nri dị ọnụ ala.",
    walletOnly: "Ọ bụ naanị site n’obere akpa ego Behtafood gị ka m nwere ike ịkwụ ụgwọ. Iji kaadị ma ọ bụ ego aka kwụọ, jiri checkout nkịtị n’ime ngwa ahụ.",
    addAddress: "Iji nweta izipu, buru ụzọ tinye adreesị izipu n’ime ngwa ahụ.",
    buttons: { approve: 'Kwado', cancel: 'Kagbuo', askAgain: 'Jụọ ọzọ', viewOrder: 'Lee ihe i tụrụ', send: 'Zipu' },
  },
};

/** The interface language for a reply-language choice: Auto uses English. */
export function uiLanguageFor(language: AssistantLanguage | undefined): UiLanguage {
  return !language || language === 'auto' ? 'en' : language;
}

export function serverMessage(
  language: AssistantLanguage | undefined,
  key: ServerMessageKey,
  vars: Record<string, string | number> = {},
): string {
  const lang = uiLanguageFor(language);
  const template = SERVER_MESSAGES[lang]?.[key] ?? SERVER_MESSAGES.en[key];
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export function buttonNames(language: AssistantLanguage | undefined): Record<ButtonKey, string> {
  return { ...SERVER_MESSAGES.en.buttons, ...SERVER_MESSAGES[uiLanguageFor(language)].buttons };
}
