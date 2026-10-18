import { z } from 'zod';
const request = z.object({ id: z.string(), demo_buyer: z.string(), kind: z.string(), version: z.number(),
  quantity: z.number(), minimum_length_ft: z.number(), maximum_length_ft: z.number().optional(),
  maximum_total_cents: z.number(), maximum_delivery_days: z.number(), expires_at: z.string(), status: z.string(), authorized_at: z.string().nullable() });
const allocation = z.object({ buyer: z.string(), quantity: z.number(), amount_cents: z.number(), baseline_cents: z.number(), savings_cents: z.number() });
export const snapshotSchema = z.object({ title: z.string(), role: z.enum(['buyer', 'facilitator']), service_role: z.enum(['market', 'facilitator']), buyer: z.string().nullable(), agent_mode: z.string().optional(), agent_message: z.string().optional(),
  run_id: z.string(), summary: z.string(), requests: z.array(request), payment_mode: z.string(),
  batch: z.object({ id: z.string(), status: z.string(), revenue_cents: z.number(), procurement_cents: z.number(), delivery_cents: z.number(), profit_cents: z.number(),
    supplier_order_id: z.string().nullable(), allocations: z.array(allocation),
    payments: z.array(z.object({ buyer: z.string(), id: z.string(), amount_cents: z.number(), status: z.string(), mode: z.string() })),
    notification: z.object({ status: z.string() }) }).nullable(),
  events: z.array(z.object({ id: z.number(), at: z.string(), actor: z.string(), action: z.string(), detail: z.string() })),
  catalog: z.object({ name: z.string(), length_ft: z.number(), delivery_days: z.number(), threshold_quantity: z.number() }),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
