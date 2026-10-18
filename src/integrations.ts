import type { Batch, Buyer } from './domain.js';
import { Inkbox } from '@inkbox/sdk';

export async function chargeTestCard(batch: Batch, buyer: Buyer, amount: number) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    if (process.env.ALLOW_MOCK_PAYMENTS !== 'true') throw new Error('Set STRIPE_SECRET_KEY to a test key, or explicitly enable ALLOW_MOCK_PAYMENTS=true for rehearsal.');
    return { buyer, id: `mock_${batch.id}_${buyer}`, amount_cents: amount, status: 'succeeded', mode: 'mock' };
  }
  if (!key.startsWith('sk_test_') && !key.startsWith('rk_test_')) throw new Error('Only Stripe TEST keys are accepted. Live payments are disabled.');
  const body = new URLSearchParams({ amount: String(amount), currency: 'usd', payment_method: 'pm_card_visa',
    'automatic_payment_methods[enabled]': 'true', 'automatic_payment_methods[allow_redirects]': 'never',
    confirm: 'true', description: `AOM demo / ${buyer}`,
    'metadata[aom_batch_id]': batch.id, 'metadata[aom_buyer]': buyer });
  const response = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `aom-${batch.id}-${buyer}` }, body, signal: AbortSignal.timeout(20000),
  });
  const result = await response.json() as { id: string; livemode: boolean; status: string; error?: { code?: string } };
  // Provider messages can echo a malformed API key; return a code, never raw auth errors.
  if (!response.ok) throw new Error(`Stripe test payment failed (HTTP ${response.status}, code ${result.error?.code?.replace(/[^a-z0-9_]/gi, '') || 'unknown'}).`);
  if (result.livemode || result.status !== 'succeeded') throw new Error(`Stripe test payment did not succeed (${result.status}).`);
  return { buyer, id: result.id, amount_cents: amount, status: result.status, mode: 'stripe_test' };
}

export async function sendOrderMessage(batch: Batch): Promise<Batch['notification']> {
  const key = process.env.INKBOX_API_KEY;
  const recipient = process.env.COMPANY_IMESSAGE_TO;
  const identityHandle = process.env.INKBOX_IDENTITY;
  if (!identityHandle || !key || !recipient) return { status: 'not_configured' };
  const text = `AOM demo: Order ${batch.supplier_order_id} placed for 98 × 7-ft Cat8 cables. Test payment: $249.51. Estimated delivery: 5 days. No real charge or shipment.`;
  const inkbox = new Inkbox({ apiKey: key, timeoutMs: 15000 });
  const identity = await inkbox.getIdentity(identityHandle);
  const result = await identity.sendIMessage({ to: recipient, text, idempotencyKey: `aom-notification-${batch.id}` });
  return { status: result.status || 'accepted', message_id: result.id };
}
