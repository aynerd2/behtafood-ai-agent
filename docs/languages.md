# Language results

Measured on 2026-10-27 with `muse-spark-1.3` at low reasoning effort, **text only**. Each language had 10 prompts asking for food and a budget; we checked the first turn (understand, search, offer options) against fake restaurants.

| Language | Understood the budget | Understood the dish or intent | Replied in the same language |
|---|---|---|---|
| English | 10/10 | 10/10 | 10/10 after a prompt fix (7/10 before: it slipped into Pidgin) |
| Nigerian Pidgin | 10/10 | 10/10 | 9/10 after the fix (10/10 before) |
| Yoruba | 10/10 | 10/10 | 10/10 |
| Hausa | 10/10 | 10/10 | 10/10 |
| Igbo | 10/10 | 10/10 | 10/10 |

## Honest limits

- **Yoruba, Hausa and Igbo were tested by us, not verified by native speakers.** We wrote those prompts ourselves, and no native speaker has checked them or graded the replies.
- "Replied in the same language" means the reply was in that language, not that it was fluent or natural.
- 10 prompts per language is a small sample.
- The prompt fix is the instruction "reply in the language of the customer's latest message; standard English gets no Pidgin", which is in `packages/agent-core/src/prompt.ts`.
- English and Nigerian Pidgin are the supported languages for the product.

## Reply language dropdown (2026-10-29)

The customer can pick the reply language in the chat header: Auto (match my message), English, Nigerian Pidgin, Yoruba (beta), Hausa (beta) or Igbo (beta). The app sends it with every message as `language`, one of `auto`, `en`, `pcm`, `yo`, `ha`, `ig`; the server answers 400 for anything else.

- **Auto** sends the system prompt unchanged, so it behaves exactly as before.
- **Any other choice** appends one fixed instruction after the unchanged prompt (`languageInstruction` in `packages/agent-core/src/prompt.ts`): write every sentence the customer reads in that language, even if they write in English; keep restaurant names, dish names, ₦ prices and order references exactly as in the data; use simple, everyday words; every earlier rule, including all safety rules, still applies.

Live check with `muse-spark-1.3` (low effort), fake data, the customer writing in English, 3 prompts per language: a budget request, a required choice (shawarma size) and an unavailable item (coconut rice). All 18 replies were in the chosen language and kept names and prices as given. Cost: about $0.003 to $0.012 per prompt.

What we saw, and what we changed:
- The first instruction listed the special letters of each language (for example Hausa ɓ ɗ ƙ ƴ). Hausa replies then put hooked letters in words that do not have them ("Baɓu" for "Babu"). The instruction now asks for standard spelling instead, and the Yoruba, Hausa and Igbo checks were run again.
- One Pidgin reply added a total wrong (said ₦4000 for ₦4000 + ₦500 delivery). Totals the model writes are not trusted: the approval card always shows the server's quote.
- **No native speaker has checked any of these replies.** They are shared with native speakers for review; until then, Yoruba, Hausa and Igbo stay labelled beta.

### Fixed strings that stay in English

These are set by code, not written by the model, so they do not change with the dropdown:
- Chat panel: the title "Behtafood Assistant", the intro text, the three suggestion buttons, the input placeholder ("Ask for food…", "Working on it…"), the dropdown labels and its note.
- Step names in the timeline: "Searched restaurants: N open", "Read menu: …", "Checked your recent orders", "Built cart", "Got the server quote: ₦…", "Prepared the approval card", "Checked order …: …", "Sent a reminder to the …", plus the approval rows ("Waiting for your approval", "Placing your order…", "Order placed: …", "Quote expired", "Cancelled. Nothing was ordered.", and the rest in `assistant-ui/src/logic/conversation.ts`).
- Buttons and cards: Approve, Cancel, Ask again, View order, the approval card titles, the cart card ("Cart", "Prices come from the server quote."), "Pick a … for …" on choice buttons, the order-tracking stages and reminder results.
- Fixed replies and errors: the health-advice refusal, the rate-limit, spending-limit, too-many-steps and unavailable messages, the photo refusal and the language refusal.
- Messages the app sends for the customer: a tapped choice ("Size: Jumbo for the Chicken shawarma, please.") and "Ask again".

## Font

The assistant's text uses **Inter**. We checked the font files for Yoruba (ẹ ọ ṣ ń à á è é ì í ò ó ù ú), Hausa (ɓ ɗ ƙ ƴ) and Igbo (ị ọ ụ ṅ), upper and lower case. Plus Jakarta Sans and Lexend lack the Hausa hooked letters; Manrope also lacks ṣ and ṅ; Sora lacks all of the dotted and hooked letters. Inter covers all of them in every weight used.
