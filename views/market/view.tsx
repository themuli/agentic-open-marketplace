import { useToolContext, useCallTool, ThemeProvider, ModelContext, useViewTheme } from 'mcp-use/react';
import { useState } from 'react';
import type { Snapshot } from '../../src/view-schema.js';
import './view.css';

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100);
const labels: Record<string, string> = { awaiting_permission: 'Review auto-buy', watching: 'Watching for a deal', reserved: 'Purchasing', proposed: 'Matched', paying: 'Processing test payments', paid: 'Paid · placing order', placed: 'Order placed', cancelled: 'Cancelled', payment_failed: 'Payment needs attention' };
const names: Record<string, string> = { consumer_1: 'Consumer 1', consumer_2: 'Consumer 2', company: 'Company' };
function Cable() { return <svg viewBox="0 0 200 150" fill="none" aria-label="Seven-foot Ethernet cable" role="img"><path d="M72 32C22 28 20 108 71 107C125 106 108 41 143 46C175 51 173 105 136 110" stroke="currentColor" strokeWidth="9" strokeLinecap="round"/><path d="M58 15h27v30H58zM125 100h27v30h-27z" fill="#173f38" stroke="#173f38" strokeLinejoin="round" strokeWidth="5"/><path d="M62 10h19v16H62zM129 119h19v16h-19z" fill="#b8ddd2" stroke="#173f38" strokeWidth="3"/><path d="M66 12v10m5-10v10m5-10v10m57 104v9m5-9v9m5-9v9" stroke="#ae8c41" strokeWidth="2"/></svg>; }
export default function MarketView() {
  const context = useToolContext<'get_buyer_status'>();
  const theme = useViewTheme();
  const [updated, setUpdated] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const buyerStatus = useCallTool('get_buyer_status');
  const facilitatorStatus = useCallTool('get_facilitator_status');
  const marketStatus = useCallTool('get_market_status');
  const authorize = useCallTool('authorize_auto_buy');
  const cancel = useCallTool('cancel_request');
  const run = useCallTool('run_facilitator');
  const resetDemo = useCallTool('reset_demo');
  const data = updated || (context.status === 'ready' ? context.toolOutput : null);
  async function perform(fn: () => Promise<Snapshot | void>) { setBusy(true); setError(''); try { const next = await fn(); if (next) setUpdated(next); } catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); } finally { setBusy(false); } }
  async function refresh() {
    if (!data) return;
    const result = data.role === 'buyer' && data.buyer
      ? await buyerStatus.callTool({ demo_buyer: data.buyer as 'consumer_1' | 'consumer_2' | 'company' })
      : data.service_role === 'market' ? await marketStatus.callTool({}) : await facilitatorStatus.callTool({});
    return result.structuredContent;
  }
  if (context.status === 'error') return <main className="aom"><p role="alert">{context.error.message}</p></main>;
  if (!data) return <main className="aom loading"><span className="eyebrow">AOM · MARKETPLACE</span><h1>Finding a better way to buy.</h1><div className="skeleton"/><p>Loading your request…</p></main>;
  const buyer = data.role === 'buyer';
  const request = data.requests[0];
  const batch = data.batch;
  const allocation = buyer ? batch?.allocations[0] : null;
  const status = buyer ? request?.status : batch?.status;
  const authorizedCount = data.requests.filter(r => r.authorized_at).length;
  return <ThemeProvider><main className={`aom ${theme === 'dark' ? 'dark' : ''}`}>
    <ModelContext content={JSON.stringify({ buyer: data.buyer, status, run_id: data.run_id, auto_buy: !!request?.authorized_at, order: batch?.supplier_order_id })}/>
    <header><div className="brand"><span className="brand-mark">a</span><span>AOM<span className="brand-sub">Agentic Open Marketplace</span></span></div><span className="demo">SANDBOX</span></header>
    <div className="heading"><div><span className="eyebrow">{buyer ? `${data.title.toUpperCase()} · PERSONAL SHOPPING` : 'FACILITATOR · MARKET OPERATIONS'}</span><h1>{buyer ? status === 'placed' ? 'A better deal. Secured.' : request?.kind === 'price_alert' ? 'Your price. Our watch.' : 'Your next purchase, handled.' : batch?.status === 'placed' ? 'One order. Three buyers.' : 'Independent needs. Shared value.'}</h1><p className="muted">{data.summary}</p></div></div>
    {buyer ? <>
      <section className="product"><div className="product-art"><Cable/><span>CAT8 / 7 FT</span></div><div className="product-info"><span className="eyebrow">{request?.quantity || 1} × ETHERNET CABLE</span><h2>Stay connected.</h2><p>New Cat8 cable · {request ? `at least ${request.minimum_length_ft} ft` : '7 ft'}<br/>Doorstep delivery · within {data.catalog.delivery_days} days of purchase</p><div className="price"><strong>{allocation ? usd(allocation.amount_cents) : request ? usd(request.maximum_total_cents) : '—'}</strong><span>{allocation ? 'delivered total' : 'maximum delivered total'}</span></div>{allocation && <span className="savings">Save {usd(allocation.savings_cents)} vs. the demo outside option</span>}</div></section>
      {request && <section className="request-details"><div><span>Status</span><strong><i className={status === 'placed' ? 'dot done' : 'dot'}/>{labels[request.status] || request.status}</strong></div><div><span>Match deadline</span><strong>{new Date(request.expires_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</strong></div><div><span>Auto-buy</span><strong>{request.authorized_at ? 'Enabled · one purchase' : 'Your permission needed'}</strong></div></section>}
      {request?.status === 'awaiting_permission' && <section className="consent"><h3>Let your agent catch the deal.</h3><p>Authorize one automatic test purchase of {request.quantity} matching cable{request.quantity > 1 ? 's' : ''} for up to <b>{usd(request.maximum_total_cents)} total delivered</b>, before the match deadline above, with delivery within {request.maximum_delivery_days} days of purchase. No real money or shipment.</p><label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>Yes, enable auto-buy within these limits.</label><button disabled={!consent || busy} onClick={() => void perform(async () => (await authorize.callTool({ request_id: request.id, request_version: request.version })).structuredContent)}>{busy ? 'Enabling…' : 'Enable auto-buy'}<span>↗</span></button></section>}
      {request?.status === 'watching' && <div className="notice"><span className="pulse"/><div><strong>{request.kind === 'price_alert' ? 'Price alert active. Auto-buy ready.' : 'Your agent is watching.'}</strong><p>We’ll purchase when a matching offer fits your limits. Refresh to check progress.</p></div></div>}
      {status === 'placed' && batch && <div className="notice success"><span>✓</span><div><strong>{batch.supplier_order_id}</strong><p>{data.payment_mode === 'stripe_test' ? 'Stripe test payment succeeded.' : 'Mock rehearsal payment.'} Supplier purchase simulated. Delivery has not occurred.</p></div></div>}
    </> : <>
      <section className="stats"><div><span>Authorized demand</span><strong>{data.requests.reduce((n, r) => n + (r.authorized_at ? r.quantity : 0), 0)}<small> / 100 units</small></strong></div><div><span>Authorized buyers</span><strong>{authorizedCount}<small> / 3</small></strong></div><div><span>Batch status</span><strong className="status-value">{status ? labels[status] || status : 'Collecting demand'}</strong></div></section>
      <section className="buyers"><h3>The composition</h3>{['consumer_1', 'consumer_2', 'company'].map(id => { const r = data.requests.find(x => x.demo_buyer === id); const a = batch?.allocations.find(x => x.buyer === id); return <div className="buyer-row" key={id}><span className="avatar">{id === 'company' ? '▦' : id === 'consumer_1' ? '01' : '02'}</span><div><strong>{names[id]}</strong><span>{r ? `${r.quantity} cable${r.quantity > 1 ? 's' : ''} · min ${r.minimum_length_ft} ft · budget ${usd(r.maximum_total_cents)}` : 'Awaiting request'}</span></div><span className={`pill ${r?.authorized_at ? 'green' : ''}`}>{a ? usd(a.amount_cents) : r?.authorized_at ? 'Auto-buy enabled' : 'Pending'}</span></div>; })}<div className="equation"><span>98</span><b>+</b><span>1</span><b>+</b><span>1</span><b>=</b><strong>100</strong><small>{batch ? 'supplier tier unlocked' : 'target supplier tier'}</small></div></section>
      {batch && <section className="economics"><h3>Batch economics <span>DEMO INPUTS</span></h3><div><span>Buyer payments</span><strong>{usd(batch.revenue_cents)}</strong></div><div><span>Supplier + inbound shipping</span><strong>−{usd(batch.procurement_cents)}</strong></div><div><span>Local delivery</span><strong>−{usd(batch.delivery_cents)}</strong></div><div className="profit"><span>Facilitator contribution</span><strong>{usd(batch.profit_cents)}</strong></div><p>Demo tax and payment processing costs set to $0.</p></section>}
      {!!batch?.payments.length && <section className="receipts"><h3>Payment receipts</h3>{batch.payments.map(p => <div key={p.id}><span>{names[p.buyer]} <small>{p.mode === 'stripe_test' ? 'STRIPE TEST' : 'MOCK'}</small></span><strong>{usd(p.amount_cents)} ✓</strong></div>)}</section>}
      {!!data.events.length && <section className="timeline"><h3>Agent communication</h3>{data.events.slice(-9).map(e => <div key={e.id}><span className="timeline-dot"/><div><span className="event-actor">{e.actor}</span><strong>{e.action.replaceAll('_', ' ')}</strong><p>{e.detail}</p></div></div>)}</section>}
      {batch && <div className="notification"><span>Company iMessage</span><strong>{batch.notification.status.replaceAll('_', ' ')}</strong></div>}
      {data.agent_mode && <p className="disclosure">{data.agent_mode === 'llm' ? 'Autonomous LLM facilitator · tools discovered over MCP' : 'Scripted rehearsal · add OPENAI_API_KEY to enable the autonomous facilitator'}</p>}
    </>}
    {error && <p className="error" role="alert">{error}</p>}
    {confirmReset && <section className="consent"><h3>Start a fresh demo?</h3><p>This clears all three buyers’ requests, auto-buy permissions and the shared order. Previous Stripe test payments and sent iMessages remain.</p><button disabled={busy} onClick={() => void perform(async () => { const response = await resetDemo.callTool({ confirm_reset: true }); setConfirmReset(false); setConsent(false); return response.structuredContent; })}>Yes, reset the shared demo</button><button className="text-button" disabled={busy} onClick={() => setConfirmReset(false)}>Keep this run</button></section>}
    <button className="text-button" disabled={busy || confirmReset} onClick={() => setConfirmReset(true)}>Reset demo</button>
    <footer><button className="secondary" disabled={busy} onClick={() => void perform(refresh)}>{busy ? 'Checking…' : '↻ Refresh status'}</button>{buyer && request && ['watching', 'awaiting_permission'].includes(request.status) && <button className="text-button" disabled={busy} onClick={() => void perform(async () => (await cancel.callTool({ request_id: request.id })).structuredContent)}>Cancel request</button>}{!buyer && data.service_role === 'facilitator' && <button disabled={busy || batch?.status === 'placed'} onClick={() => void perform(async () => { await run.callTool({}); return refresh(); })}>{busy ? 'Agent working…' : 'Run facilitator'} ↗</button>}</footer>
    <p className="disclosure">Hackathon sandbox · {data.payment_mode === 'stripe_test' ? 'Stripe test payments' : data.payment_mode === 'mock' ? 'Mock payments' : 'Payments not configured'} · Procurement and delivery simulated</p>
  </main></ThemeProvider>;
}
