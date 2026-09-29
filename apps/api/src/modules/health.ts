import type { FastifyInstance } from 'fastify';
import { checkDb } from '../lib/db.js';
import { checkRedis } from '../lib/redis.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    return reply.send({ success: true, data: { status: 'ok', service: 'flowpay-api' } });
  });

  app.get('/ready', async (_req, reply) => {
    const [db, redisOk] = await Promise.all([checkDb(), checkRedis()]);
    const ready = db && redisOk;
    return reply.code(ready ? 200 : 503).send({
      success: ready,
      data: { postgres: db ? 'up' : 'down', redis: redisOk ? 'up' : 'down' },
    });
  });
}
