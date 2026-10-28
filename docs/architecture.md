# Architecture

```
 Customer app (private)                 Behtafood backend (private)                Meta Model API
 ┌──────────────────────┐   customer    ┌──────────────────────────────────┐       ┌───────────────┐
 │ assistant-ui (copy)  │ ── token ───▶ │ /api/agent/*  (AGENT_ENABLED)     │ ────▶ │ muse-spark-1.3│
 │ Chat or Guided mode  │ ◀── events ── │ agent-core (copy)                 │       └───────────────┘
 └──────────────────────┘   (polled)    │ adapter: BehtafoodPort ──▶ existing endpoints (as the customer)
                                        └──────────────────────────────────┘
```

This repo holds `agent-core`, `assistant-ui` and a mock API. Behtafood's private repos copy the first two in with one-way sync scripts; nothing flows back.

## agent-core (`packages/agent-core`)

- **Agent loop** (`agent.ts`): one customer message in, timeline events out. Order of checks: message rate limit, health-topic guard, then at most 8 model calls, each preceded by a spend-cap check. A `step` event is emitted only after its tool call has returned.
- **Tools** (`tools.ts`): `search_restaurants`, `get_menu`, `get_my_recent_orders`, `build_cart`, `quote_order`, `propose_order`, `get_order_status`, `nudge_vendor`, `nudge_rider`. None places or pays for an order.
- **Proposals** (`proposals.ts`): a proposal stores the server's quote. `approve()` is called only by the approval endpoint. It re-quotes, checks the wallet, and places one order with the proposal id as the order's `checkoutSessionId`. After an uncertain outcome the proposal is `unconfirmed`, and `check()` and every later `approve()` look the order up first.
- **Usage meter** (`usage.ts`): logs each model call's tokens and cost, and enforces daily spend caps.
- **Photos** (`image.ts`): one JPEG or PNG per message, at most 1.5 MB, checked before the model sees it. It is sent to the model as an `image_url` data URL at low detail, for that message only; afterwards the conversation keeps a short note instead.
- **Delays and reminders** (`delays.ts`, `nudges.ts`): fixed delay rules and messages; polite reminder templates with limits.
- **`BehtafoodPort`** (`port.ts`): the contract a backend implements. Every call carries the customer's own context.
- **Models** (`model.ts`, `scripted.ts`): `MetaModelClient` (Chat Completions, low reasoning effort, prompt cache key) and `ScriptedDemoModel`, an offline test stand-in.

## assistant-ui (`packages/assistant-ui`)

- `src/logic` (plain TypeScript, tested on Node): the HTTP client; the conversation reducer that turns server events into timeline rows and cards; the approval-card states; dish-choice buttons; the polling controller; order tracking; photo checks; and Guided mode (the map from successful steps to app screens, the Chat/Guided switch, Stop, pause on touch, and pacing).
- `src/ui` (React Native): floating button, chat panel, action timeline, approval card, restaurant, cart and choice cards, tracking card, the Guided bar, and the photo button with preview. The photo button uses `expo-image-picker`, and shrinks the photo in an invisible `react-native-webview` canvas, so no extra native module is needed. The host app passes its colours, fonts and screen navigation in. The screens are typechecked in the host app, which has the React Native types.

## Mock API (`apps/mock-api`)

`npm run mock-api` serves the same agent routes as the private backend, over fake data. Every agent route returns 404 unless the agent is enabled. Authenticate with `Authorization: Bearer demo-token-ada` (₦15,000 wallet) or `demo-token-tunde` (₦800, for the low-balance case).

| Route | Purpose |
|---|---|
| `POST /api/agent/chat` `{ message, sessionId? }` | Runs one message; streams timeline events (server-sent events) |
| `POST /api/agent/approve` `{ proposalId }` | The only way an order is placed |
| `POST /api/agent/check` `{ proposalId }` | Read-only: was an order placed for this proposal? |
| `POST /api/agent/cancel` `{ proposalId }` | Cancels an approval card |
| `GET /api/agent/orders/:id/status` | Status plus any delay; no model call |
| `POST /api/agent/nudge` `{ orderId, party }` | A fixed, polite reminder to the restaurant or rider |
| `GET /api/agent/usage` | This customer's model calls, tokens and cost |
| `POST /mock/orders/:id/advance` `{ status }` | Mock only: stands in for the restaurant and rider apps |

## The private Behtafood side (not in this repo)

- **Adapter:** implements `BehtafoodPort` by calling Behtafood's existing endpoints over loopback with the customer's own login token, so pricing, validation, double-order protection and the wallet debit run unchanged. One read (pricing a whole cart) reuses the existing pricing service read-only, because no endpoint prices a cart; a test checks the quote equals the charged total.
- **Routes:** the routes above, plus a timeline the app polls once a second (`GET /api/agent/runs/:id/events?after=N`). All return 404 unless `AGENT_ENABLED=true`, which is off by default.
- **Customer app:** mounts the assistant only when its own flag is on. In Guided mode the real app screens follow the agent's successful steps, with every highlight labelled "Behtafood AI is viewing…". Guided mode never taps Pay or Place order and never edits the customer's cart.
- **Practice server only:** a local in-memory server with fake data, and a script that plays the restaurant and rider for demos. Both refuse to run in production.
