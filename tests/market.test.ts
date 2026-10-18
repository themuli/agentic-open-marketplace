import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.AOM_DB_PATH = ':memory:';
process.env.ALLOW_MOCK_PAYMENTS = 'true';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.INKBOX_API_KEY;
const { requestSchema, compose } = await import('../src/domain.js');
const { submit, authorize, cancel, propose, pay, placeOrder, buyerSnapshot } = await import('../src/market.js');
const { read, reset, update } = await import('../src/store.js');
const { chargeTestCard } = await import('../src/integrations.js');
const input = (buyer: 'consumer_1' | 'consumer_2' | 'company', extra = {}) => requestSchema.parse({ demo_buyer: buyer,
  minimum_length_ft: buyer === 'company' ? 7 : 5, quantity: buyer === 'company' ? 98 : 1, maximum_total_cents: buyer === 'company' ? 25000 : 400, ...extra });
function seed() { reset(); return (['consumer_1', 'consumer_2', 'company'] as const).map(b => { const i = submit(input(b), b === 'consumer_2' ? 'price_alert' : 'buy_intent'); return authorize(i.id, i.version); }); }

test('98+1+1 composes, charges once under concurrency, and places one order', async () => {
  const intents = seed(); const b = propose(intents.map(i => i.id));
  assert.equal(b.revenue_cents, 25749); assert.equal(b.profit_cents, 352);
  assert.deepEqual(b.allocations.map(a => a.savings_cents), [300, 300, 1500]);
  assert.equal(propose(intents.map(i => i.id)).id, b.id);
  await Promise.all([pay(b.id), pay(b.id)]);
  assert.equal(read().batch?.payments.length, 3);
  assert.equal(read().batch?.status, 'paid');
  await Promise.all([placeOrder(b.id), placeOrder(b.id)]);
  assert.equal(read().batch?.status, 'placed');
  assert.equal(read().events.filter(e => e.action === 'supplier_order_placed').length, 1);
  const buyer = buyerSnapshot('consumer_1');
  assert.equal(buyer.batch?.allocations.length, 1); assert.equal(buyer.batch?.payments.length, 1);
});
test('unauthorized, over-budget, incompatible-length and delivery requests cannot clear', () => {
  reset(); const first = submit(input('consumer_1'), 'buy_intent');
  assert.throws(() => propose([first.id, 'missing', 'another']), /Waiting/);
  for (const extra of [{ maximum_total_cents: 398 }, { minimum_length_ft: 8 }, { maximum_length_ft: 6 }, { maximum_delivery_days: 2 }]) {
    seed(); const i = submit(input('consumer_1', extra), 'buy_intent'); authorize(i.id, i.version);
    assert.throws(() => compose(read().intents), /budget|length|days/);
    assert.equal(read().batch, null);
  }
});
test('edits revoke permission; old versions and expired permissions cannot execute', () => {
  seed(); const old = read().intents[0];
  const edited = submit(input('consumer_1', { maximum_total_cents: 500 }), 'buy_intent');
  assert.equal(edited.authorized_at, null); assert.throws(() => authorize(edited.id, old.version), /changed/);
  authorize(edited.id, edited.version);
  update(s => { s.intents[0].expires_at = new Date(0).toISOString(); });
  assert.throws(() => compose(read().intents), /expired/);
});
test('cancel revokes permission and schema rejects invalid quantities and lengths', () => {
  seed(); const id = read().intents[0].id; cancel(id);
  assert.equal(read().intents[0].authorized_at, null);
  assert.throws(() => authorize(id, read().intents[0].version), /cancelled/);
  assert.throws(() => requestSchema.parse({ ...input('consumer_1'), quantity: -1 }));
  assert.throws(() => requestSchema.parse({ ...input('consumer_1'), minimum_length_ft: 10, maximum_length_ft: 5 }));
});
test('expired reserved permission blocks charging and live Stripe keys are rejected', async () => {
  const intents = seed(); const b = propose(intents.map(i => i.id));
  update(s => { s.intents[0].expires_at = new Date(0).toISOString(); });
  await assert.rejects(() => pay(b.id), /expired/);
  assert.equal(read().batch?.payments.length, 0);
  process.env.STRIPE_SECRET_KEY = 'sk_live_not_a_real_key';
  try { await assert.rejects(() => chargeTestCard(b, 'consumer_1', 399), /Only Stripe TEST keys/); }
  finally { delete process.env.STRIPE_SECRET_KEY; }
});
test('operator retry retains prior successful payments and does not charge them again', async () => {
  const intents = seed(); const b = propose(intents.map(i => i.id));
  update(s => { s.batch!.status = 'payment_failed'; s.batch!.payments.push({ buyer: 'consumer_1', id: 'mock_previous_success', amount_cents: 399, status: 'succeeded', mode: 'mock' }); });
  await pay(b.id);
  assert.equal(read().batch?.status, 'paid');
  assert.equal(read().batch?.payments.length, 3);
  assert.equal(read().batch?.payments[0].id, 'mock_previous_success');
});
