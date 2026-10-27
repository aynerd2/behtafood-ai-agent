// Picks the model: the offline scripted model by default, or Muse Spark when
// --live is passed and META_API_KEY is set in the environment. The key is only
// handed to the client; it is never printed.

import { MetaModelClient, ScriptedDemoModel, type ModelClient, type ReasoningEffort } from '@behtafood-agent/agent-core';

export function modelFromEnv(argv: string[]): ModelClient {
  if (!argv.includes('--live')) return new ScriptedDemoModel();
  const apiKey = process.env.META_API_KEY;
  if (!apiKey) {
    console.error('--live needs META_API_KEY in the environment. Falling back to the offline scripted model.');
    return new ScriptedDemoModel();
  }
  return new MetaModelClient({
    apiKey,
    model: process.env.AGENT_MODEL || 'muse-spark-1.3',
    reasoningEffort: (process.env.AGENT_REASONING_EFFORT as ReasoningEffort) || 'low',
  });
}
