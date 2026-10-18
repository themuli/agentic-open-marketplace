import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
config({ path: ['.env', '.env.local'], quiet: true });
const deployments = JSON.parse(readFileSync('.aom/deployments.json', 'utf8'));
for (const role of ['market', 'facilitator']) {
  const client = new Client({ name: `aom-verifier-${role}`, version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(deployments[role].mcpUrl)));
  try {
    const tools = await client.listTools();
    assert.ok(tools.tools.some(t => t.name === (role === 'market' ? 'set_buy_intent' : 'run_facilitator')));
    assert.ok(tools.tools.some(t => t.name === 'reset_demo'), 'Wait for the in-app reset deployment to become active.');
    const status = await client.callTool({ name: role === 'market' ? 'get_market_status' : 'get_facilitator_status', arguments: {} });
    assert.ok(!status.isError, JSON.stringify(status.content));
    const data = status.structuredContent as { summary: string; service_role: string; agent_mode?: string; payment_mode: string };
    assert.equal(data.service_role, role, 'The updated source must be active before recording.');
    console.log(JSON.stringify({ role, tools: tools.tools.length, payment_mode: data.payment_mode, agent_mode: data.agent_mode, status: 'verified' }));
    if (role === 'market') {
      const denied = await client.callTool({ name: 'execute_batch', arguments: { batch_id: 'invalid' } });
      assert.equal(denied.isError, true);
    }
  } finally { await client.close(); }
}
console.log('Hosted MCP endpoints verified. No purchases or messages were sent.');
