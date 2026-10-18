import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
const temp = mkdtempSync(join(tmpdir(), 'aom-smoke-'));
const env = { ...process.env, AOM_DB_PATH: join(temp, 'state.sqlite'), AOM_AGENT_SECRET: 'smoke-agent', AOM_ADMIN_SECRET: 'smoke-admin', ALLOW_MOCK_PAYMENTS: 'true', STRIPE_SECRET_KEY: '', INKBOX_API_KEY: '', OPENAI_API_KEY: '', FACILITATOR_URL: 'http://127.0.0.1:3101', MARKET_MCP_URL: 'http://127.0.0.1:3100/mcp' };
const children = [spawn('node', ['node_modules/mcp-use/dist/bin.js', 'start', '--port', '3100'], { env: { ...env, AOM_ROLE: 'market' }, stdio: 'pipe' }),
  spawn('node', ['node_modules/mcp-use/dist/bin.js', 'start', '--port', '3101'], { env: { ...env, AOM_ROLE: 'facilitator', AOM_DB_PATH: join(temp, 'facilitator.sqlite') }, stdio: 'pipe' })];
let logs = ''; for (const p of children) { p.stdout?.on('data', x => { logs += x; }); p.stderr?.on('data', x => { logs += x; }); }
const clients: Client[] = [];
async function connect(port: number, name: string) { const c = new Client({ name, version: '1.0.0' }); await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`))); clients.push(c); return c; }
async function call(c: Client, name: string, args: Record<string, unknown>) { const r = await c.callTool({ name, arguments: args }); assert.equal(r.isError, undefined, JSON.stringify(r.content)); return r.structuredContent as any; }
try {
  for (let n = 0; n < 60; n++) { try { const a = await fetch('http://127.0.0.1:3100/health'); const b = await fetch('http://127.0.0.1:3101/health'); if (a.ok && b.ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
  const buyers = await Promise.all([connect(3100, 'consumer-one-client'), connect(3100, 'consumer-two-client'), connect(3100, 'company-client')]);
  const seller = await connect(3101, 'facilitator-client');
  const marketTools = await buyers[0].listTools(); assert.ok(marketTools.tools.some(t => t.name === 'set_price_alert'));
  const sellerTools = await seller.listTools(); assert.deepEqual(sellerTools.tools.map(t => t.name).sort(), ['get_facilitator_status', 'reset_demo', 'run_facilitator']);
  const denied = await buyers[0].callTool({ name: 'propose_batch', arguments: { intent_ids: ['a', 'b', 'c'] } }); assert.equal(denied.isError, true);
  for (let i = 0; i < buyers.length; i++) {
    const snapshot = await call(buyers[i], i === 1 ? 'set_price_alert' : 'set_buy_intent', { demo_buyer: ['consumer_1', 'consumer_2', 'company'][i], quantity: i === 2 ? 98 : 1, maximum_total_cents: i === 2 ? 25000 : 400, minimum_length_ft: i === 2 ? 7 : 5 });
    const request = snapshot.requests[0];
    await call(buyers[i], 'authorize_auto_buy', { request_id: request.id, request_version: request.version });
    if (i < 2) { const state = await call(buyers[i], 'get_market_status', {}); assert.equal(state.batch, null); }
  }
  let final: any;
  for (let n = 0; n < 40; n++) { final = await call(seller, 'get_facilitator_status', {}); if (final.batch?.status === 'placed') break; await new Promise(r => setTimeout(r, 250)); }
  assert.equal(final.batch?.status, 'placed', logs);
  assert.equal(final.batch.payments.length, 3); assert.equal(final.batch.profit_cents, 352);
  const secondClient = await connect(3100, 'second-mcp-client');
  const same = await call(secondClient, 'get_market_status', {}); assert.equal(same.batch.id, final.batch.id);
  await call(seller, 'run_facilitator', {});
  const again = await call(secondClient, 'get_market_status', {}); assert.equal(again.batch.payments.length, 3);
  const cleared = await call(seller, 'reset_demo', { confirm_reset: true });
  assert.notEqual(cleared.run_id, final.run_id); assert.equal(cleared.requests.length, 0); assert.equal(cleared.batch, null);
  const buyerCleared = await call(secondClient, 'get_market_status', {}); assert.equal(buyerCleared.run_id, cleared.run_id);
  const marketReset = await call(secondClient, 'reset_demo', { confirm_reset: true }); assert.notEqual(marketReset.run_id, cleared.run_id);
  console.log('PASS: ChatGPT reset tool works on both services and clears the shared demo without a new order.');
  console.log('PASS: three buyer clients → auto-buy → separate facilitator MCP calls → 3 mock payments → one simulated order.');
  console.log('PASS: missing facilitator credentials rejected; second client reads same batch; repeated agent run does not double-charge.');
} catch (e) { console.error(logs); throw e; }
finally { await Promise.allSettled(clients.map(c => c.close())); for (const p of children) p.kill(); rmSync(temp, { recursive: true, force: true }); }
