// Starts the mock API. The agent routes are off unless --agent-enabled is passed
// or AGENT_ENABLED=true (the same default-off rule as the real backend).

import { createMockServer } from './server';
import { modelFromEnv } from './modelFromEnv';

const agentEnabled = process.argv.includes('--agent-enabled') || process.env.AGENT_ENABLED === 'true';
const model = modelFromEnv(process.argv);
const port = Number(process.env.PORT || 7100);
const { server } = createMockServer({ agentEnabled, model });

server.listen(port, () => {
  console.log(`Mock API on http://localhost:${port}  (agent ${agentEnabled ? 'enabled' : 'DISABLED'}, model: ${model.model})`);
  console.log('Demo customers: Authorization: Bearer demo-token-ada (₦15,000 wallet) or demo-token-tunde (₦800 wallet)');
});
