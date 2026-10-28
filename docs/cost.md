# Cost

Model: `muse-spark-1.3`, standard tier. Prices per 1M tokens (checked 2026-10-27): $1.25 input, $0.15 cached input, $4.25 output. Reasoning tokens are billed as output. These are in `MODEL_PRICES` in `packages/agent-core/src/usage.ts`.

## Measured per full order flow

A full flow is: ask (search, read menus, offer options), pick, then build the cart, quote and propose. That is 2 customer messages and 7 model calls.

| When | Setting | Cost per flow |
|---|---|---|
| 27 Oct, 3 runs | low reasoning effort | $0.0080 to $0.0096 |
| 27 Oct, 3 runs | minimal reasoning effort | $0.0064 to $0.0082 |
| 27 Oct, mock API (`LIVE_TESTS=1`) | low | $0.011 |
| 27 Oct, practice backend, rice dish | low | $0.0098 |
| 27 Oct, practice backend, dish with a required choice | low | $0.0142 |

## A message with a photo

28 Oct, practice backend, one synthetic food picture (about 70 KB after shrinking), no text: 3 model calls (search, read menus, reply) cost **$0.0104**, about twice the same turn without a photo. The first call had about 2,850 prompt tokens. The photo is sent with that message only, so the next message costs the same as usual (the follow-up "something cheaper" added 2 calls and $0.0072).

Between 79% and 89% of prompt tokens were served from Meta's automatic prompt cache, because the system prompt and tool list never change (`prompt_cache_key`). **Order tracking, delay messages and reminders use no model calls**, so they cost nothing.

## Caps

- At most 8 model calls per customer message.
- Daily spend caps: $0.50 per customer and $5 overall by default (`UsageMeter`).

## How to measure again

1. Set `META_API_KEY` in your shell.
2. Run `npm run chat -- --live` and do one full order (ask, pick, `/approve`). After each message the chat prints the model calls and cost so far. Type `/quit` to leave.
3. Or run `npm run mock-api -- --live`, go through the demo path, and read `GET /api/agent/usage`. It lists every model call's tokens (prompt, cached, output, reasoning) and cost, and the total. Each message's `done` timeline event also carries `modelCalls` and `costUsd`.

`LIVE_TESTS=1 npm test` runs the live demo-path and prompt-injection tests and costs about $0.02.
