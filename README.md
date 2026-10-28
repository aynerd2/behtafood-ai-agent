# Behtafood AI Agent

An AI ordering assistant for [Behtafood](https://behtafood.com), a food delivery platform in Ado-Ekiti, Nigeria. It is for customers who know what they feel like eating and how much they want to spend, but not which of 60+ menus to scroll through. A customer types, in English or Nigerian Pidgin, something like "jollof rice and chicken under ₦4,000". The agent searches restaurants and menus, asks for any required choice (for example the protein), and shows the server's real quote on an approval card. **Nothing is bought until the customer taps Approve.** Then exactly one wallet order is placed, and the order is tracked to delivery.

It runs on Meta's **Muse Spark** (`muse-spark-1.3`) with plain function calling. There is no orchestration framework and no MCP.

## Demo path

1. "Jollof rice and chicken under ₦4,000": the agent searches, reads menus and offers options with the delivery fee included.
2. It asks for the required choice (Protein: Chicken, Beef or Turkey +₦800). The customer taps one.
3. Cart, then the server's quote, then an approval card with Approve and Cancel.
4. Approve: one wallet order is placed, and its reference is shown.
5. Tracking: each real status change appears with **zero model calls**. If the order runs late, a fixed message offers a polite reminder to the restaurant or rider.

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
- **Prompt injection.** Restaurant and menu text reaches the model labelled as untrusted data. A menu item that tells the agent to order causes no order.
- **Wallet only.** Low balance, unavailable items and closed restaurants are refused with a reason.
- **Caps.** Per-customer message rate limit, at most 8 model calls per message, and daily spend caps per customer and overall.
- **Honest wording.** A timeline step appears only after the server reports it. Failures show as failures. A reminder is "sent" or "couldn't send", never "delivered" or "read".
- No health, allergy or nutrition advice: such messages get a fixed reply before any model call.

## Languages

Text only, measured on 10 prompts per language ([docs/languages.md](docs/languages.md)):

| Language | Understood the request | Replied in the same language | Status |
|---|---|---|---|
| English | 10/10 | 10/10 | Tested |
| Nigerian Pidgin | 10/10 | 9/10 | Tested |
| Yoruba | 10/10 | 10/10 | Tested by us, not verified by native speakers |
| Hausa | 10/10 | 10/10 | Tested by us, not verified by native speakers |
| Igbo | 10/10 | 10/10 | Tested by us, not verified by native speakers |

## Cost

Measured with `muse-spark-1.3` at low reasoning effort: **about $0.008 to $0.015 per full order flow** (7 model calls, 79 to 89% of prompt tokens served from Meta's prompt cache). Tracking and reminders use no model calls. Details and how to measure again: [docs/cost.md](docs/cost.md).

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

## License

MIT, see [LICENSE](LICENSE).
