# Behtafood AI Agent

An AI-powered food ordering assistant for [Behtafood](https://behtafood.com), a food and restaurant marketplace connecting customers with restaurants in Ado-Ekiti, Nigeria. It helps customers who know what they feel like eating and how much they want to spend but don't want to scroll through 60+ menus to find the right meal. A customer types in English or Nigerian Pidgin, for example, “jollof rice and chicken under ₦4,000.” The agent searches available restaurants and menus, asks for any required choices (such as protein), and presents the server-verified price on an approval card. **Nothing is ordered until the customer taps Approve.** Once approved, exactly one order is placed using the customer's wallet, and the customer can track the order through fulfilment.

It runs on Meta's **Muse Spark** (`muse-spark-1.3`) with plain function calling. There is no orchestration framework and no MCP.

## Demo path

1. "Jollof rice and chicken under ₦4,000": the agent searches, reads menus and offers options with the delivery fee included.
2. It asks for the required choice (Protein: Chicken, Beef or Turkey +₦800). The customer taps one.
3. Cart, then the server's quote, then an approval card with Approve and Cancel.
4. Approve: one wallet order is placed, and its reference is shown.
5. Tracking: each real status change appears with **zero model calls**. If the order runs late, a fixed message offers a polite reminder to the restaurant or rider.

**Photo input:** the customer can attach one food photo ("find me something like this"). The app shrinks it (longest edge 1024 px, JPEG) and the server accepts JPEG or PNG up to 1.5 MB. The assistant says in plain words what the dish looks like, without claiming certainty, then searches the real menus. The photo is used for that one message and is not stored. We tested this with pictures we drew ourselves; dish recognition can be wrong, and the customer always picks and approves.

In the recorded demo, the restaurant and rider are **simulated**: a practice-only script moves the order through their real app endpoints on a local test server with fake data.

## Run it in mock mode (no key needed)

Requires Node.js 22 or newer. All data here (restaurants, dishes, customers, tokens) is invented.

```bash
npm install
npm test            # all tests, offline
npm run typecheck
npm run demo        # the demo path in the terminal
npm run chat        # chat yourself; /approve approves the proposed order
npm run mock-api    # HTTP API on port 7100 (see docs/architecture.md)
```

Without a key, the agent's model is `ScriptedDemoModel`, a small rule-based **test stand-in**. It is not intelligent and only handles English demo-style requests. It exists so anyone can run the whole flow offline.

## Run it with the real Muse Spark model

The key is read from the `META_API_KEY` environment variable only. Never commit it (`.env*` is ignored by git).

```bash
# set META_API_KEY in your shell first
npm run chat -- --live
npm run mock-api -- --live
LIVE_TESTS=1 npm test     # opt-in live tests (demo path and prompt injection), about $0.02
```

Optional: `AGENT_MODEL` (default `muse-spark-1.3`) and `AGENT_REASONING_EFFORT` (default `low`).

## Architecture

| Part | What it is |
|---|---|
| `packages/agent-core` | The agent loop, 9 tool schemas, system prompt, proposal and approval state machine, usage meter and caps, delay rules, reminder templates, and the `BehtafoodPort` interface. No dependencies. |
| `packages/assistant-ui` | React Native UI: floating button, chat panel, live action timeline, approval card, choice buttons, order tracking card, and Guided mode. Its logic (in `src/logic`) is plain TypeScript, tested on Node. |
| `apps/mock-api` | Fake data, an in-memory `BehtafoodPort`, an HTTP server with the same routes as the real backend, and the terminal demo and chat. |
| Private Behtafood adapter (**not in this repo**) | In Behtafood's private backend: an implementation of `BehtafoodPort` that calls Behtafood's existing endpoints as the signed-in customer, plus the `/api/agent/*` routes, all switched off unless `AGENT_ENABLED=true`. The customer app copies `assistant-ui` in. Code flows one way, from this repo into the private ones. |

More detail: [docs/architecture.md](docs/architecture.md).

## Safety rules

Each rule has a test; see [docs/safety.md](docs/safety.md).

- **The model can never place an order.** It has no tool that places, pays for or approves anything. Only the customer's Approve tap calls the approval endpoint.
- **Re-quote on approval.** If the total changed since the card was shown, nothing is placed and the new total is shown for a fresh approval. Cards expire after 10 minutes.
- **One order per proposal.** The proposal id is the order's idempotency key, so a double tap or retry never creates a second order.
- **Unconfirmed-order check.** If an approval's outcome is unknown (for example a lost response), the proposal stays "unconfirmed" and never expires on its own. Every later Approve or "Ask again" first looks the order up by its id.
- **Prompt injection.** Restaurant and menu text reaches the model labelled as untrusted data. A menu item that tells the agent to order causes no order. Text inside a photo is untrusted too, and a photo can never trigger a purchase.
- **Wallet only.** Low balance, unavailable items and closed restaurants are refused with a reason.
- **Caps.** Per-customer message rate limit, at most 8 model calls per message, and daily spend caps per customer and overall.
- **Honest wording.** A timeline step appears only after the server reports it. Failures show as failures. A reminder is "sent" or "couldn't send", never "delivered" or "read".
- No health, allergy or nutrition advice: such messages get a fixed reply before any model call.

## Languages

The chat header has a **reply language** dropdown: Auto (match my message), English, Nigerian Pidgin, Yoruba, Hausa and Igbo. Yoruba, Hausa and Igbo are labelled **beta**. The choice is remembered on the phone and sent with every message as `language` (`auto`, `en`, `pcm`, `yo`, `ha` or `ig`); the server refuses any other code. Auto keeps the original prompt unchanged. Any other choice adds one instruction after it: write everything the customer reads in that language, keep restaurant and dish names, ₦ prices and order references exactly as in the data, use simple words, and keep every safety rule. Buttons and step names stay in English for now.

Text only. First table: 10 prompts per language, reply language matched to the customer's message. Second: 3 prompts per language (a budget, a required choice, an unavailable item) with the language picked in the dropdown and the customer writing in English. Details: [docs/languages.md](docs/languages.md).

| Language | Understood the request (10) | Replied in the same language (10) | Followed the dropdown (3) | Status |
|---|---|---|---|---|
| English | 10/10 | 10/10 | 3/3 | Tested |
| Nigerian Pidgin | 10/10 | 9/10 | 3/3 | Tested |
| Yoruba | 10/10 | 10/10 | 3/3 | Beta: tested by us, not verified by native speakers |
| Hausa | 10/10 | 10/10 | 3/3 | Beta: tested by us, not verified by native speakers |
| Igbo | 10/10 | 10/10 | 3/3 | Beta: tested by us, not verified by native speakers |

"Followed the dropdown" means the reply was in that language and kept names and prices as given. It says nothing about fluency. In the dropdown run, one Pidgin reply added a total wrong (the approval card always shows the server's real total), and an earlier version of the instruction made Hausa replies misspell words, which was then fixed.

## Cost

Measured with `muse-spark-1.3` at low reasoning effort: **about $0.008 to $0.015 per full order flow** (7 model calls, 79 to 89% of prompt tokens served from Meta's prompt cache). Tracking and reminders use no model calls. A message with a photo costs more (in our test, $0.0104 for its 3 model calls, about twice a text message). Details and how to measure again: [docs/cost.md](docs/cost.md).

## Built during the hackathon vs existing Behtafood

The hackathon ran 27 Oct to 4 Nov 2026.

| Existing before 27 Oct 2026 (private) | Built during the hackathon |
|---|---|
| The Behtafood platform and its live service | **This repo:** `agent-core`, `assistant-ui`, the mock API, and all tests |
| Behtafood backend (Node, Express, MongoDB) | **Private backend:** the `BehtafoodPort` adapter and the `/api/agent/*` routes |
| Customer app (Expo, React Native) | **Private customer app:** the assistant integration and Guided mode |
| Wallet, ordering, pricing, payments and order lifecycle | **Private backend:** order tracking with delay detection, and polite reminders |
| Security fixes completed before 26 Oct 2026 | **Private backend:** a practice-only order simulator that plays the restaurant and rider |
| The `dev:memory` local practice server with fake data | |

The agent uses Behtafood's existing ordering, pricing and wallet code unchanged: the adapter calls the existing endpoints as the customer.

## Images

The mock data uses the same three fake Ado-Ekiti restaurants as our private demo, with a picture for every restaurant and dish (`assets/food/`, served by the mock API at `/assets/food/<file>`). The assistant's cards show them as thumbnails; image links are display data only and are never sent to the model.

- **Openly licensed photos (19):** dish and cover photos from Wikimedia Commons under CC BY-SA 4.0 (15), CC BY-SA 2.0 (2), CC BY-SA 3.0 (1) and CC0 (1). Each was cropped and resized; title, author, licence and link are in [assets/food/CREDITS.md](assets/food/CREDITS.md). The cropped photos keep their original licences, not the MIT licence of the code.
- **Drawn for this demo (12):** restaurant wordmark logos and illustrated avatars, drawn by a script. No photos of real people.
- **AI-generated: none.**

No image comes from a real vendor, a delivery app, a restaurant website or the live Behtafood app.

## License

MIT, see [LICENSE](LICENSE). Images in `assets/food/` have their own licences, listed in [CREDITS.md](CREDITS.md).
