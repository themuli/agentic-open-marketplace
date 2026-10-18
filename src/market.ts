import { randomUUID } from 'node:crypto';
import { catalog, compose, profiles, type Batch, type Buyer, type RequestInput } from './domain.js';
import { event, read, update } from './store.js';
import { chargeTestCard, sendOrderMessage } from './integrations.js';

export function submit(input: RequestInput, kind: 'buy_intent' | 'price_alert') {
  return update(s => {
    if (s.batch) throw new Error('This demo run already has a batch. Reset before recording a new run.');
    const existing = s.intents.find(i => i.demo_buyer === input.demo_buyer);
    if (existing && JSON.stringify(Object.fromEntries(Object.keys(input).map(k => [k, existing[k as keyof typeof existing]]))) === JSON.stringify(input) && existing.kind === kind && existing.status !== 'cancelled') return existing;
    const intent = { ...input, id: existing?.id || randomUUID(), kind, version: (existing?.version || 0) + 1,
      created_at: new Date().toISOString(), expires_at: new Date(Date.now() + input.maximum_wait_minutes * 60000).toISOString(),
      authorized_at: null, status: 'awaiting_permission' as const, batch_id: null };
    s.intents = s.intents.filter(i => i.demo_buyer !== input.demo_buyer).concat(intent);
    event(s, `buyer:${input.demo_buyer}`, kind, `${input.quantity} Cat8 cable(s), min ${input.minimum_length_ft} ft, budget ${input.maximum_total_cents} cents. Auto-buy permission required.`);
    return intent;
  });
}
export function authorize(id: string, version: number) {
  return update(s => {
    const i = s.intents.find(x => x.id === id);
    if (!i) throw new Error('Request not found. Use get_buyer_status.');
    if (i.version !== version) throw new Error('Request changed. Review the latest terms before authorizing.');
    if (Date.parse(i.expires_at) <= Date.now()) throw new Error('Request expired. Create a new request.');
    if (i.status === 'cancelled') throw new Error('Request was cancelled. Create a new request.');
    if (i.authorized_at) return i;
    i.authorized_at = new Date().toISOString(); i.status = 'watching';
    event(s, `buyer:${i.demo_buyer}`, 'auto_buy_authorized', `One purchase, at most ${i.maximum_total_cents} cents, before ${i.expires_at}.`);
    return i;
  });
}
export function cancel(id: string) {
  return update(s => {
    const i = s.intents.find(x => x.id === id);
    if (!i) throw new Error('Request not found.');
    if (i.batch_id) throw new Error('Purchase already reserved. Reset the demo to start over; this does not refund Stripe payments.');
    i.status = 'cancelled'; i.authorized_at = null;
    event(s, `buyer:${i.demo_buyer}`, 'cancelled', 'Request and auto-buy permission cancelled.'); return i;
  });
}
export function propose(ids: string[]) {
  return update(s => {
    if (s.batch) return s.batch;
    if (new Set(ids).size !== 3) throw new Error('Select three distinct requests.');
    const allocations = compose(s.intents.filter(i => ids.includes(i.id)));
    const revenue = allocations.reduce((sum, a) => sum + a.amount_cents, 0);
    const profit = revenue - catalog.procurement_total_cents - catalog.local_delivery_cost_cents - catalog.payment_cost_cents;
    if (profit < 200) throw new Error('The facilitator requires at least $2 demo profit.');
    const batch: Batch = { id: randomUUID(), run_id: s.run_id, proposal_id: randomUUID(), status: 'proposed', allocations,
      revenue_cents: revenue, procurement_cents: catalog.procurement_total_cents, delivery_cents: catalog.local_delivery_cost_cents,
      profit_cents: profit, created_at: new Date().toISOString(), placed_at: null, payments: [], supplier_order_id: null,
      notification: { status: 'pending' } };
    // Reserve all intents in the same SQLite transaction as batch creation.
    for (const a of allocations) { const i = s.intents.find(x => x.id === a.intent_id)!; i.status = 'reserved'; i.batch_id = batch.id; }
    s.batch = batch; event(s, 'aom-facilitator', 'batch_proposed', '98 + 1 + 1 = 100 compatible cables. Requests reserved atomically.'); return batch;
  });
}
export async function pay(batchId: string) {
  const claim = update(s => {
    const b = s.batch;
    if (!b || b.id !== batchId) throw new Error('Unknown batch.');
    if (b.status !== 'proposed' && b.status !== 'payment_failed') return { claimed: false, batch: b };
    for (const a of b.allocations) { const i = s.intents.find(i => i.id === a.intent_id)!;
      if (!i.authorized_at || Date.parse(i.expires_at) <= Date.now()) throw new Error('A buyer authorization expired before payment.');
      if (a.amount_cents > i.maximum_total_cents) throw new Error('Price exceeds authorized budget.');
    }
    b.status = 'paying'; event(s, 'aom-market', 'payments_started', 'Charging three separate sandbox PaymentIntents.'); return { claimed: true, batch: b };
  });
  if (!claim.claimed) return claim.batch;
  try {
    for (const a of claim.batch.allocations) {
      if (claim.batch.payments.some(p => p.buyer === a.buyer && p.status === 'succeeded')) continue;
      const payment = await chargeTestCard(claim.batch, a.buyer, a.amount_cents);
      update(s => { s.batch!.payments.push(payment); event(s, 'stripe', 'payment_succeeded', `${a.buyer}: ${a.amount_cents} cents (${payment.mode}).`); });
    }
    return update(s => { s.batch!.status = 'paid'; event(s, 'aom-market', 'batch_paid', 'All three payments succeeded. Supplier order may now be placed.'); return s.batch!; });
  } catch (error) {
    update(s => { s.batch!.status = 'payment_failed'; event(s, 'aom-market', 'payment_failed', 'Purchase stopped. Operator review required; successful test payments are retained and skipped on an explicit retry.'); });
    throw error;
  }
}
export async function placeOrder(batchId: string) {
  const claim = update(s => {
    const b = s.batch;
    if (!b || b.id !== batchId) throw new Error('Unknown batch.');
    if (b.status === 'placed') return { claimed: false, batch: b };
    if (b.status !== 'paid') throw new Error('All buyer payments must succeed first.');
    b.status = 'placed'; b.placed_at = new Date().toISOString(); b.supplier_order_id = `AOM-${b.id.slice(0, 8).toUpperCase()}`;
    b.notification.status = 'sending';
    for (const a of b.allocations) s.intents.find(i => i.id === a.intent_id)!.status = 'placed';
    event(s, 'aom-facilitator', 'supplier_order_placed', `SIMULATED: 100 cables procured; ${b.supplier_order_id}. Delivery estimated in 5 days.`);
    return { claimed: true, batch: b };
  });
  if (!claim.claimed) return claim.batch;
  let notification: Batch['notification'];
  try { notification = await sendOrderMessage(claim.batch); }
  catch { notification = { status: 'failed', error: 'Notification could not be confirmed. The order remains placed.' }; }
  return update(s => { s.batch!.notification = notification; event(s, 'inkbox', 'company_notification', notification.status); return s.batch!; });
}
export function buyerSnapshot(buyer: Buyer) {
  const s = read(); const intent = s.intents.find(i => i.demo_buyer === buyer) || null;
  const allocation = s.batch?.allocations.find(a => a.buyer === buyer);
  return { title: profiles[buyer].label, role: 'buyer' as const, service_role: 'market' as const, buyer, run_id: s.run_id,
    summary: !intent ? 'Tell your agent what you need.' : intent.status === 'placed' ? 'Your order is placed.' : intent.status === 'awaiting_permission' ? 'Review your request and enable auto-buy.' : 'Watching for a matching delivered offer.',
    requests: intent ? [intent] : [],
    batch: allocation && s.batch ? { ...s.batch, allocations: [allocation], payments: s.batch.payments.filter(p => p.buyer === buyer) } : null,
    events: s.events.filter(e => e.actor === `buyer:${buyer}` || (allocation && ['supplier_order_placed', 'batch_paid'].includes(e.action))),
    catalog, payment_mode: process.env.STRIPE_SECRET_KEY ? 'stripe_test' : process.env.ALLOW_MOCK_PAYMENTS === 'true' ? 'mock' : 'not_configured' };
}
export function marketSnapshot() {
  const s = read(); return { title: 'Facilitator console', role: 'facilitator' as const, service_role: 'market' as const, buyer: null,
    run_id: s.run_id, summary: s.batch?.status === 'placed' ? 'One composed order. Three buyers served.' : 'Connect independent demand to unlock the 100-unit price.',
    requests: s.intents, batch: s.batch, events: s.events, catalog,
    payment_mode: process.env.STRIPE_SECRET_KEY ? 'stripe_test' : process.env.ALLOW_MOCK_PAYMENTS === 'true' ? 'mock' : 'not_configured' };
}
