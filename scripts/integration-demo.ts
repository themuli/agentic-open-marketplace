import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Inkbox } from '@inkbox/sdk';
config({ path: ['.env', '.env.local'], quiet: true });
const deployments = JSON.parse(readFileSync('.aom/deployments.json', 'utf8'));
const backendOnly = process.argv.includes('--backend-only');
if (!process.env.OPENAI_API_KEY || !process.env.STRIPE_SECRET_KEY || !process.env.INKBOX_API_KEY) throw new Error('Integration credentials are required.');
assert.match(process.env.STRIPE_SECRET_KEY, /^(sk|rk)_test_/);
const market = new Client({ name: 'aom-integration-buyers', version: '1.0.0' });
const seller = new Client({ name: 'aom-integration-facilitator', version: '1.0.0' });
const internal = new Client({ name: 'aom-integration-receipt-verifier', version: '1.0.0' });
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) throw new Error(`MCP operation failed: ${name}. Inspect the service's sanitized logs.`);
  return response.structuredContent as any;
}
try {
  await market.connect(new StreamableHTTPClientTransport(new URL(deployments.market.mcpUrl)));
  await seller.connect(new StreamableHTTPClientTransport(new URL(deployments.facilitator.mcpUrl)));
  await internal.connect(new StreamableHTTPClientTransport(new URL(deployments.market.mcpUrl), { requestInit: { headers: { 'x-aom-agent-key': process.env.AOM_AGENT_SECRET || '' } } }));
  const before = await call(seller, 'get_facilitator_status', {});
  if (!backendOnly) assert.equal(before.agent_mode, 'llm', 'Wait for the deployment with OPENAI_API_KEY to become active.');
  assert.equal(before.payment_mode, 'stripe_test', 'Wait for the Stripe-configured market deployment.');
  assert.equal(before.batch, null, 'Reset the demo before running another integration take.');
  assert.equal(before.requests.length, 0, 'Use a clean demo run.');
  for (const buyer of ['consumer_1', 'consumer_2', 'company']) {
    const snapshot = await call(market, buyer === 'consumer_2' ? 'set_price_alert' : 'set_buy_intent', {
      demo_buyer: buyer, quantity: buyer === 'company' ? 98 : 1,
      minimum_length_ft: buyer === 'company' ? 7 : 5,
      ...(buyer === 'company' ? { maximum_length_ft: 7 } : {}),
      maximum_total_cents: buyer === 'company' ? 25000 : buyer === 'consumer_2' ? 400 : 500,
      maximum_wait_minutes: 1440, maximum_delivery_days: 7,
    });
    const request = snapshot.requests[0];
    await call(market, 'authorize_auto_buy', { request_id: request.id, request_version: request.version });
    console.log(`${buyer}: request submitted and demo auto-buy authorized.`);
  }
  if (backendOnly) {
    console.log('Backend-only integration verification: autonomous LLM execution is NOT being claimed.');
    const demand = (await call(internal, 'list_open_demand', {})).data;
    let batch = demand.batch || (await call(internal, 'propose_batch', { intent_ids: demand.requests.map((r: { id: string }) => r.id) })).data;
    batch = (await call(internal, 'execute_batch', { batch_id: batch.id })).data;
    assert.equal(batch.status, 'paid');
    await call(internal, 'place_supplier_order', { batch_id: batch.id });
  }
  let full: any;
  for (let attempt = 0; attempt < 60; attempt++) {
    full = (await call(internal, 'list_open_demand', {})).data;
    if (full.batch?.status === 'payment_failed') throw new Error('A test payment failed. No supplier order should be placed.');
    if (full.batch?.status === 'placed' && full.batch.notification.status !== 'sending') break;
    if (!full.batch && !backendOnly) {
      const statusResponse = await fetch(`${deployments.facilitator.mcpUrl.replace(/\/mcp\/?$/, '')}/internal/agent-status`, { headers: { 'x-aom-agent-key': process.env.AOM_AGENT_SECRET || '' } });
      if (statusResponse.ok) {
        const agent = await statusResponse.json() as { running?: boolean; last_result?: { status?: string } };
        if (!agent.running && agent.last_result?.status === 'error') throw new Error('Facilitator inference failed. Check the sanitized agent status and OpenAI billing before retrying.');
      }
    }
    if (attempt % 5 === 0) console.log(`Facilitator progress: ${full.batch?.status || 'matching'}`);
    await new Promise(r => setTimeout(r, 2000));
  }
  const batch = full.batch;
  assert.equal(batch?.status, 'placed', 'Facilitator did not complete the order.');
  assert.equal(batch.payments.length, 3);
  assert.equal(batch.profit_cents, 352);
  for (const payment of batch.payments) {
    assert.equal(payment.mode, 'stripe_test');
    const response = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(payment.id)}`, { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } });
    assert.ok(response.ok, 'Stripe receipt lookup failed.');
    const receipt = await response.json() as any;
    assert.equal(receipt.livemode, false); assert.equal(receipt.status, 'succeeded'); assert.equal(receipt.amount_received, payment.amount_cents);
    console.log(`Stripe verified: ${payment.buyer}, ${payment.amount_cents} cents, succeeded, test mode.`);
  }
  assert.ok(batch.notification.message_id, 'Inkbox did not accept the company notification.');
  const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY, timeoutMs: 15000 });
  const identity = await inkbox.getIdentity(process.env.INKBOX_IDENTITY!.replace(/^@/, ''));
  let message;
  for (let attempt = 0; attempt < 10; attempt++) {
    const messages = await identity.listIMessages({ limit: 15 });
    message = messages.find(m => m.id === batch.notification.message_id);
    if (message?.status === 'delivered' || message?.status === 'error' || message?.status === 'declined') break;
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log(JSON.stringify({ order: batch.supplier_order_id, stripe_test_payments: 3, imessage_status: message?.status || batch.notification.status, imessage_error_code: message?.errorCode || null, agent_mode: backendOnly ? 'not_exercised_backend_only' : 'llm' }));
  if (message?.status === 'error' || message?.status === 'declined') throw new Error('Inkbox accepted the message but reported a delivery failure.');
} finally { await Promise.allSettled([market.close(), seller.close(), internal.close()]); }
