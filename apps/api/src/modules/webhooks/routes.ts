import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../lib/db.js';

const bodySchema = z.object({
  event_id: z.string().min(1).max(200),
  event_type: z.string().min(1).max(100),
  payload: z.unknown(),
});

/**
 * Generic webhook ingress with event-id idempotency.
 * Duplicate event_ids are ignored (no duplicate financial effects).
 */
export async function webhookRoutes(app: FastifyInstance) {
  app.post('/', async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid webhook event.' } });
    }
    const { event_id, event_type, payload } = parsed.data;
    const r = await pool.query(
      `INSERT INTO webhook_events (event_id, event_type, payload, processed)
       VALUES ($1,$2,$3,false) ON CONFLICT (event_id) DO NOTHING RETURNING *`,
      [event_id, event_type, JSON.stringify(payload)],
    );
    if (!r.rowCount) {
      const existing = await pool.query(`SELECT * FROM webhook_events WHERE event_id = $1`, [event_id]);
      return reply.send({ success: true, data: { deduped: true, event: existing.rows[0] } });
    }
    // MVP: acknowledge receipt; provider-specific handling can be added per event_type.
    await pool.query(`UPDATE webhook_events SET processed = true WHERE event_id = $1`, [event_id]);
    return reply.code(201).send({ success: true, data: { deduped: false, event: r.rows[0] } });
  });
}
