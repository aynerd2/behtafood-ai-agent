# Behtafood AI Agent

An AI food-ordering assistant for [Behtafood](https://behtafood.com), a food delivery service in Ado-Ekiti, Nigeria. A customer says what they want and their budget ("something filling around ₦3,000, rice and chicken"). The agent searches real restaurants and menus, compares options within the budget (delivery fee included), builds a cart, and shows the server's quote on an approval card. **Nothing is bought until the customer taps Approve.** Then exactly one wallet order is placed.

It runs on Meta's **Muse Spark** (`muse-spark-1.3`) with plain function calling: no orchestration framework, no MCP.

## Built during the hackathon vs. existing Behtafood

Everything in this repository was written during the hackathon (27 Oct to 4 Nov 2026). The Behtafood product it plugs into existed before and is private.

| Part | Status | Where |
|---|---|---|
| Agent loop, tool schemas, system prompt (`packages/agent-core`) | **New (hackathon)** | this repo |
| Proposal and approval state machine, idempotent approval | **New (hackathon)** | this repo |
| Usage meter, spend caps, rate limits, call caps, topic guard | **New (hackathon)** | this repo |
| Templated vendor/rider nudges with limits | **New (hackathon)** | this repo |
| `BehtafoodPort` contract and the fake-data mock API | **New (hackathon)** | this repo |
| Terminal chat and offline scripted demo model | **New (hackathon)** | this repo |
| Assistant UI components (`packages/assistant-ui`) | **New (hackathon)**, in progress | this repo (coming) |
| Backend adapter implementing `BehtafoodPort`, `/api/agent/*` routes | **New (hackathon)** | private Behtafood backend |
| Floating assistant button in the customer app | **New (hackathon)** | private customer app |
| Customer, vendor and rider apps, ordering, wallet, payments, delivery tracking | Existing Behtafood product | private, not in this repo |

All data in this repo (restaurants, dishes, prices, customers, tokens) is invented. There are no real vendors, photos or customer data.

## Run it in mock mode (no API key needed)

Requires Node.js 22 or newer.

```bash
npm install
npm test          # the safety and demo-path tests
npm run demo      # the full demo path in the terminal
npm run chat      # chat yourself; type /approve to approve a proposed order
```

Without a key, the agent's "brain" is `ScriptedDemoModel`, a small rule-based stand-in that only handles English demo-style requests. It exists so that anyone can run and test the whole flow offline.

### With the real model

```bash
# set META_API_KEY in your environment first (never commit it)
npm run chat -- --live
npm run mock-api -- --live
LIVE_TESTS=1 npm test   # adds the live demo-path and prompt-injection tests (~$0.02)
```

Optional: `AGENT_MODEL` (default `muse-spark-1.3`) and `AGENT_REASONING_EFFORT` (default `low`).

### HTTP API

`npm run mock-api` starts the server on port 7100 (`PORT` changes it). The agent routes return 404 unless the agent is enabled (`--agent-enabled` or `AGENT_ENABLED=true`); the npm script enables it.

| Route | What it does |
|---|---|
| `POST /api/agent/chat` `{ message, sessionId? }` | Streams timeline events (server-sent events) |
| `POST /api/agent/approve` `{ proposalId }` | The only way an order is placed |
| `POST /api/agent/cancel` `{ proposalId }` | Cancels an approval card |
| `GET /api/agent/usage` | Model calls, tokens and cost for this customer |
| `POST /mock/orders/:id/advance` `{ status }` | Demo stand-in for the vendor and rider apps |

Authenticate as a demo customer with `Authorization: Bearer demo-token-ada` (₦15,000 wallet) or `demo-token-tunde` (₦800 wallet, for the low-balance case).

## How it stays safe

- **The model cannot spend money.** It has no tool that places, pays for or approves an order. `propose_order` only creates an approval card; the order is placed only when the app calls `/api/agent/approve` after the customer taps Approve.
- **Server prices only.** Each proposal stores the server's quote and expires after 10 minutes. Approval re-quotes. If the total changed, it refuses and shows the new total for a fresh approval.
- **No duplicate orders.** The proposal id is the order's `checkoutSessionId`. A double tap shares one attempt. After an uncertain outcome (such as a lost network response), the order is looked up by that id before anything is retried.
- **Clear refusals.** Low wallet balance, an unavailable item, or a restaurant closed by its vendor or by an admin all refuse with a reason and place nothing.
- **Prompt injection.** Restaurant and menu text is passed to the model labelled as untrusted data. The tests include a menu item whose description tells the agent to order; it causes no order, offline or with the live model.
- **Limits.** Per-customer message rate limit, at most 8 model calls per message, and daily spend caps per customer and overall.
- **Truthful timeline.** A step appears only after its tool call has returned. Failures show as failures, and waiting for approval is its own event.
- **Nudges.** Fixed templates only, sent only after the customer says yes, at most 1 per party per 10 minutes and 2 per order, for the customer's own active order. Every attempt is logged.
- **No health, allergy or nutrition advice.** These messages get a fixed reply before any model call.

## Layout

```
packages/agent-core/   agent loop, tools, prompt, proposals, nudges, usage meter, BehtafoodPort
apps/mock-api/         fake data, MockBehtafoodPort, HTTP server, terminal chat, tests
```

## Cost

Measured with `muse-spark-1.3` at low reasoning effort on the demo path (search, read menus, offer options, pick, build cart, quote, propose): **about $0.011 per full order flow**, with about 80% of prompt tokens served from Meta's automatic prompt cache. Order status updates use no model calls.
