import { config } from 'dotenv';
config({ path: ['.env', '.env.local'], quiet: true });
const base = (process.env.MARKET_MCP_URL || 'http://127.0.0.1:3000/mcp').replace(/\/mcp\/?$/, '');
const r = await fetch(`${base}/admin/reset`, { method: 'POST', headers: { 'x-aom-admin-key': process.env.AOM_ADMIN_SECRET || '' } });
if (!r.ok) throw new Error(`Reset failed: ${r.status}`);
console.log('Demo reset. Stripe test payments from previous takes are retained.');
