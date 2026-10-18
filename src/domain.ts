import { z } from 'zod';

export const buyerSchema = z.enum(['consumer_1', 'consumer_2', 'company']);
export type Buyer = z.infer<typeof buyerSchema>;
export const requestSchema = z.object({
  demo_buyer: buyerSchema.describe('Seeded hackathon profile, not a real identity.'),
  product: z.enum(['cat8_ethernet_cable']).default('cat8_ethernet_cable'),
  minimum_length_ft: z.number().min(1).max(100).default(5),
  maximum_length_ft: z.number().min(1).max(100).optional(),
  quantity: z.number().int().min(1).max(100),
  maximum_total_cents: z.number().int().min(50).max(100000).describe('Maximum TOTAL in USD cents, including delivery and demo tax.'),
  maximum_wait_minutes: z.number().int().min(1).max(10080).default(1440).describe('How long the request and auto-buy permission remain valid.'),
  maximum_delivery_days: z.number().int().min(1).max(30).default(7),
}).refine(x => !x.maximum_length_ft || x.maximum_length_ft >= x.minimum_length_ft, 'Maximum length must be at least minimum length.');
export type RequestInput = z.infer<typeof requestSchema>;
export interface Intent extends RequestInput {
  id: string; kind: 'buy_intent' | 'price_alert'; version: number;
  created_at: string; expires_at: string; authorized_at: string | null;
  status: 'awaiting_permission' | 'watching' | 'reserved' | 'placed' | 'cancelled';
  batch_id: string | null;
}
export const catalog = {
  id: 'monoprice_cat8_7ft_demo', product: 'cat8_ethernet_cable', name: 'Cat8 Ethernet cable',
  length_ft: 7, supplier: 'Monoprice (demo offer)', condition: 'new',
  threshold_quantity: 100, merchandise_total_cents: 21650, inbound_shipping_cents: 2000,
  procurement_total_cents: 23650, local_delivery_cost_cents: 1747,
  payment_cost_cents: 0, tax_cents: 0, delivery_days: 5,
  fixture_note: 'Illustrative coupon and pricing; not a live merchant quote. Demo tax and processing costs are zero.',
} as const;
export const profiles = {
  consumer_1: { label: 'Consumer 1', quantity: 1, price_cents: 399, baseline_cents: 699 },
  consumer_2: { label: 'Consumer 2', quantity: 1, price_cents: 399, baseline_cents: 699 },
  company: { label: 'Company', quantity: 98, price_cents: 24951, baseline_cents: 26451 },
} as const;
export interface Allocation { intent_id: string; buyer: Buyer; quantity: number; amount_cents: number; baseline_cents: number; savings_cents: number }
export interface Batch {
  id: string; run_id: string; proposal_id: string; status: 'proposed' | 'paying' | 'paid' | 'payment_failed' | 'placed';
  allocations: Allocation[]; revenue_cents: number; procurement_cents: number; delivery_cents: number;
  profit_cents: number; created_at: string; placed_at: string | null;
  payments: { buyer: Buyer; id: string; amount_cents: number; status: string; mode: string }[];
  supplier_order_id: string | null; notification: { status: string; message_id?: string; error?: string };
}
export interface Event { id: number; at: string; actor: string; action: string; detail: string }
export interface State { run_id: string; intents: Intent[]; batch: Batch | null; events: Event[] }

export function compose(intents: Intent[], now = Date.now()): Allocation[] {
  const selected = (Object.keys(profiles) as Buyer[]).map(buyer => {
    const intent = intents.find(i => i.demo_buyer === buyer && i.status === 'watching');
    const profile = profiles[buyer];
    if (!intent) throw new Error(`Waiting for ${profile.label}'s authorized request.`);
    if (!intent.authorized_at || Date.parse(intent.expires_at) <= now) throw new Error(`${profile.label}'s authorization has expired or is missing.`);
    if (intent.quantity !== profile.quantity) throw new Error(`${profile.label}: this demo requires ${profile.quantity} cable(s).`);
    if (intent.minimum_length_ft > catalog.length_ft || (intent.maximum_length_ft && intent.maximum_length_ft < catalog.length_ft)) throw new Error(`${profile.label}: the 7-ft cable does not meet the length requirement.`);
    if (intent.maximum_delivery_days < catalog.delivery_days) throw new Error(`${profile.label}: allow at least ${catalog.delivery_days} days for delivery.`);
    if (intent.maximum_total_cents < profile.price_cents) throw new Error(`${profile.label}: delivered offer exceeds the authorized budget.`);
    return { intent_id: intent.id, buyer, quantity: intent.quantity, amount_cents: profile.price_cents,
      baseline_cents: profile.baseline_cents, savings_cents: profile.baseline_cents - profile.price_cents };
  });
  if (selected.reduce((sum, x) => sum + x.quantity, 0) !== catalog.threshold_quantity) throw new Error('The supplier requires 100 units.');
  return selected;
}
export const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
