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
