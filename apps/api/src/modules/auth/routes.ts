import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { pool } from '../../lib/db.js';

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

export async function authRoutes(app: FastifyInstance) {
  app.post('/register', {
    schema: {
      tags: ['auth'],
      body: { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input.' } });
    }
    const { email, password } = parsed.data;
    const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [email.toLowerCase()]);
    if (existing.rowCount) {
      return reply.code(409).send({ success: false, error: { code: 'CONFLICT', message: 'Email already registered.' } });
    }
    const hash = await bcrypt.hash(password, 12);
    const r = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id, email, created_at`,
      [email.toLowerCase(), hash],
    );
    const user = r.rows[0];
    await pool.query(`INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [user.id]);
    const token = app.jwt.sign({ sub: user.id, email: user.email });
    return reply.send({ success: true, data: { user: { id: user.id, email: user.email }, token } });
  });

  app.post('/login', {
    schema: { tags: ['auth'] },
  }, async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid email or password.' } });
    }
    const { email, password } = parsed.data;
    const r = await pool.query(`SELECT id, email, password_hash FROM users WHERE email = $1`, [email.toLowerCase()]);
    if (!r.rowCount) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid credentials.' } });
    }
    const okPw = await bcrypt.compare(password, r.rows[0].password_hash);
    if (!okPw) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid credentials.' } });
    }
    const token = app.jwt.sign({ sub: r.rows[0].id, email: r.rows[0].email });
    return reply.send({ success: true, data: { user: { id: r.rows[0].id, email: r.rows[0].email }, token } });
  });

  app.get('/me', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: string };
    const r = await pool.query(`SELECT id, email, created_at, updated_at FROM users WHERE id = $1`, [user.sub]);
    if (!r.rowCount) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });
    return reply.send({ success: true, data: { user: r.rows[0] } });
  });
}
