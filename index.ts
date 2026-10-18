import { config } from 'dotenv';
config({ path: ['.env', '.env.local'], quiet: true });
import { MCPServer, type RequestContext } from 'mcp-use';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { buyerSchema, catalog, requestSchema } from './src/domain.js';
import { authorize, buyerSnapshot, cancel, marketSnapshot, pay, placeOrder, propose, submit } from './src/market.js';
import { read, reset } from './src/store.js';
import { snapshotSchema } from './src/view-schema.js';
import { agentStatus, runAgent } from './src/agent.js';
import { connectMarket } from './src/mcp-client.js';

const role = process.env.AOM_ROLE || 'market';
const facilitator = role === 'facilitator';
const server = new MCPServer({ name: facilitator ? 'aom-facilitator' : 'aom-market', title: facilitator ? 'AOM · Facilitator' : 'AOM · Agentic Open Marketplace',
  version: '1.0.0', host: '0.0.0.0', description: 'Compose independent purchase intentions into a better delivered deal. YC hackathon sandbox.',
  instructions: facilitator
    ? 'Use get_facilitator_status for the seller dashboard. run_facilitator starts the autonomous agent, which discovers and calls aom-market MCP tools. All procurement is simulated.'
    : 'Sandbox marketplace with seeded demo profiles consumer_1, consumer_2 and company. Ask which profile if unclear. Use set_buy_intent or set_price_alert. Always explicitly ask whether the buyer authorizes ONE automatic TEST purchase within the displayed budget and expiry. Only after their yes call authorize_auto_buy with request_id and request_version. Company must also authorize. Changes revoke permission. Prices include simulated delivery and zero demo tax. Never claim real shipment or real money. Use get_buyer_status to refresh; get_market_status shows the facilitator ledger. Do not say the card is live-updating or that ChatGPT will proactively notify users. A facilitator service runs separately and uses MCP to compose 98+1+1 demand.',
  icons: [{ src: 'icon.svg', mimeType: 'image/svg+xml', sizes: ['512x512'] }],
});
const equal = (a: string, b: string) => !!a && !!b && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function requireAgent(ctx: RequestContext) {
  if (facilitator) throw new Error('This tool belongs to aom-market.');
  if (!equal(ctx.request?.header('x-aom-agent-key') || '', process.env.AOM_AGENT_SECRET || '')) throw new Error('Only the authenticated facilitator may execute this operation.');
}
function requireRole(expected: string) { if (role !== expected) throw new Error(`Connect to aom-${expected} to use this tool.`); }
const result = <T extends Record<string, unknown>>(data: T) => {
  const structured = ('role' in data && 'requests' in data ? snapshotSchema.parse(data) : data) as T;
  return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
};
const failure = (e: unknown) => ({ isError: true as const, content: [{ type: 'text' as const, text: e instanceof Error ? e.message : 'Operation failed.' }] });
const view = { name: 'market', prefersBorder: false };
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
async function wake() {
  if (!process.env.FACILITATOR_URL) return;
  try { const response = await fetch(`${process.env.FACILITATOR_URL.replace(/\/$/, '')}/internal/wake`, { method: 'POST',
    headers: { 'x-aom-agent-key': process.env.AOM_AGENT_SECRET || '' }, signal: AbortSignal.timeout(5000) }); if (!response.ok) console.warn(`Facilitator wake returned ${response.status}.`); }
  catch { console.warn('Facilitator wake failed; use run_facilitator to retry.'); }
}

export const setBuyIntent = server.tool({ name: 'set_buy_intent', title: 'Set buying intention',
  description: 'Submit a request for Cat8 Ethernet cables. Budget is the TOTAL delivered USD cents. Does NOT authorize payment. Ask the buyer to approve auto-buy next.',
  inputSchema: requestSchema, outputSchema: snapshotSchema, view: { ...view, name: 'buy-intent' }, annotations: write }, async input => {
  try { requireRole('market'); submit(input, 'buy_intent'); return result(buyerSnapshot(input.demo_buyer)); } catch (e) { return failure(e); }
});
export const setPriceAlert = server.tool({ name: 'set_price_alert', title: 'Watch for a delivered deal',
  description: 'Save a price alert for Cat8 cables. maximum_total_cents is the alert threshold and later auto-buy cap. No payment permission yet. Ask whether to auto-buy.',
  inputSchema: requestSchema, outputSchema: snapshotSchema, view: { ...view, name: 'price-alert' }, annotations: write }, async input => {
  try { requireRole('market'); submit(input, 'price_alert'); return result(buyerSnapshot(input.demo_buyer)); } catch (e) { return failure(e); }
});
export const authorizeAutoBuy = server.tool({ name: 'authorize_auto_buy', title: 'Enable one automatic test purchase',
  description: 'ONLY after the buyer explicitly says yes to the displayed product, quantity, TOTAL delivered budget, expiry and delivery deadline. Enables ONE Stripe sandbox purchase. Never use for an assumed yes.',
  inputSchema: z.object({ request_id: z.string(), request_version: z.number().int() }), outputSchema: snapshotSchema, view: { ...view, name: 'authorize' }, annotations: write }, async input => {
  try { requireRole('market'); const i = authorize(input.request_id, input.request_version); await wake(); return result(buyerSnapshot(i.demo_buyer)); } catch (e) { return failure(e); }
});
export const cancelRequest = server.tool({ name: 'cancel_request', title: 'Cancel request and permission', description: 'Cancel an unreserved request and revoke its auto-buy permission.',
  inputSchema: z.object({ request_id: z.string() }), outputSchema: snapshotSchema, view: { ...view, name: 'cancel' }, annotations: { ...write, destructiveHint: true } }, async ({ request_id }) => {
  try { requireRole('market'); const i = cancel(request_id); return result(buyerSnapshot(i.demo_buyer)); } catch (e) { return failure(e); }
});
export const getBuyerStatus = server.tool({ name: 'get_buyer_status', title: 'Your purchase', description: 'Show one seeded demo buyer request, its current permission, payment and order status. Read-only refresh.',
  inputSchema: z.object({ demo_buyer: buyerSchema }), outputSchema: snapshotSchema, view: { ...view, name: 'buyer' }, annotations: readOnly }, async ({ demo_buyer }) => {
  try { requireRole('market'); return result(buyerSnapshot(demo_buyer)); } catch (e) { return failure(e); }
});
export const getMarketStatus = server.tool({ name: 'get_market_status', title: 'Composed order ledger', description: 'Read the demo market, all three synthetic buyer requests, batch economics, payment receipts and communication timeline. Useful in any MCP client.',
  inputSchema: z.object({}), outputSchema: snapshotSchema, view: { ...view, name: 'facilitator' }, annotations: readOnly }, async () => {
  try { requireRole('market'); return result(marketSnapshot()); } catch (e) { return failure(e); }
});
const internalOutput = z.object({ data: z.unknown() });
export const listOpenDemand = server.tool({ name: 'list_open_demand', title: 'Discover compatible demand', description: 'Facilitator: discover authorized requests, supplier fixture, and any existing batch. Requests are demo data. Compose only compatible unexpired requirements.',
  inputSchema: z.object({}), outputSchema: internalOutput, annotations: readOnly }, async (_, ctx) => {
  try { requireAgent(ctx); const s = read(); return result({ data: { requests: s.intents, batch: s.batch, supplier_offer: catalog } }); } catch (e) { return failure(e); }
});
export const proposeBatch = server.tool({ name: 'propose_batch', title: 'Propose and reserve a batch', description: 'Facilitator: match 3 distinct authorized requests (98+1+1). Server verifies compatibility, budget, expiry, delivery and profit; atomically reserves demand. Returns batch id and prices.',
  inputSchema: z.object({ intent_ids: z.array(z.string()).length(3) }), outputSchema: internalOutput, annotations: write }, async ({ intent_ids }, ctx) => {
  try { requireAgent(ctx); return result({ data: propose(intent_ids) }); } catch (e) { return failure(e); }
});
export const executeBatch = server.tool({ name: 'execute_batch', title: 'Collect authorized test payments', description: 'Facilitator: charge three Stripe TEST payments within stored buyer authorizations. Call only after propose_batch. Stop on payment_failed. Never creates a real charge.',
  inputSchema: z.object({ batch_id: z.string() }), outputSchema: internalOutput, annotations: { ...write, openWorldHint: true } }, async ({ batch_id }, ctx) => {
  try { requireAgent(ctx); return result({ data: await pay(batch_id) }); } catch (e) { return failure(e); }
});
export const placeSupplierOrder = server.tool({ name: 'place_supplier_order', title: 'Place simulated supplier order', description: 'Facilitator: after batch status is paid, place SIMULATED 100-cable supplier order, allocate 98+1+1, and trigger the company Inkbox iMessage once. Does not physically deliver goods.',
  inputSchema: z.object({ batch_id: z.string() }), outputSchema: internalOutput, annotations: { ...write, openWorldHint: true } }, async ({ batch_id }, ctx) => {
  try { requireAgent(ctx); return result({ data: await placeOrder(batch_id) }); } catch (e) { return failure(e); }
});
export const getFacilitatorStatus = server.tool({ name: 'get_facilitator_status', title: 'Facilitator console', description: 'Show the seller dashboard: demand, matched batch, cost, margin, test payment receipts and agent communication events.',
  inputSchema: z.object({}), outputSchema: snapshotSchema, view, annotations: readOnly }, async () => {
  try { requireRole('facilitator'); const c = await connectMarket(); try { const response = await c.callTool({ name: 'get_market_status', arguments: {} }); if (response.isError) throw new Error('Market status lookup failed.'); const agent = agentStatus(); return result({ ...snapshotSchema.parse(response.structuredContent), service_role: 'facilitator' as const, agent_mode: agent.mode, agent_message: JSON.stringify(agent.last_result) }); } finally { await c.close(); } } catch (e) { return failure(e); }
});
export const runFacilitator = server.tool({ name: 'run_facilitator', title: 'Run the facilitator agent', description: 'Start the facilitator tool-calling loop. Uses MCP to discover market demand, propose a viable composition, collect authorized sandbox payments and place the simulated order. Existing batch prevents duplicates.',
  inputSchema: z.object({}), outputSchema: internalOutput, annotations: { ...write, openWorldHint: true } }, async () => {
  try { requireRole('facilitator'); return result({ data: await runAgent() }); } catch (e) { return failure(e); }
});

export const resetDemo = server.tool({ name: 'reset_demo', title: 'Reset the shared demo',
  description: 'Only when the user requests a fresh demo: clear ALL three synthetic buyer requests, authorizations, order and timeline. Does not refund or delete Stripe test history or sent iMessages. No new payments or messages are sent. Rejects reset during payment or notification processing.',
  inputSchema: z.object({ confirm_reset: z.literal(true) }), outputSchema: snapshotSchema, view: { ...view, name: 'reset' }, annotations: { ...write, destructiveHint: true } }, async () => {
  try {
    if (!facilitator) { reset(); return result(marketSnapshot()); }
    const c = await connectMarket();
    try {
      const response = await c.callTool({ name: 'reset_demo', arguments: { confirm_reset: true } });
      if (response.isError) throw new Error(response.content.filter(c => c.type === 'text').map(c => c.text).join('\n') || 'Market reset failed.');
      return result({ ...snapshotSchema.parse(response.structuredContent), service_role: 'facilitator' as const, agent_mode: agentStatus().mode });
    } finally { await c.close(); }
  } catch (e) { return failure(e); }
});
const facilitatorTools = new Set(['get_facilitator_status', 'run_facilitator']);
server.use('mcp:tools/list', async (_, next) => (await next()).filter(t => t.name === 'reset_demo' || facilitator === facilitatorTools.has(t.name)));
server.get('/health', c => c.json({ ok: true, service: `aom-${role}`, agent_mode: facilitator ? agentStatus().mode : undefined }));
server.post('/internal/wake', async c => {
  if (!equal(c.req.header('x-aom-agent-key') || '', process.env.AOM_AGENT_SECRET || '')) return c.json({ error: 'Unauthorized' }, 401);
  if (!facilitator) return c.json({ error: 'Use facilitator service' }, 400);
  void runAgent(); return c.json({ accepted: true });
});
server.get('/internal/agent-status', c => {
  if (!equal(c.req.header('x-aom-agent-key') || '', process.env.AOM_AGENT_SECRET || '')) return c.json({ error: 'Unauthorized' }, 401);
  return c.json(agentStatus());
});
server.post('/admin/reset', c => {
  if (!equal(c.req.header('x-aom-admin-key') || '', process.env.AOM_ADMIN_SECRET || '')) return c.json({ error: 'Unauthorized' }, 401);
  if (facilitator) return c.json({ error: 'Reset the market, not facilitator' }, 400);
  try { return c.json({ run_id: reset().run_id }); } catch (e) { return c.json({ error: e instanceof Error ? e.message : 'Reset failed' }, 409); }
});
export default server;
