import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from './lib/config.js';
import { requireAuth } from './middleware/auth.js';
import { healthRoutes } from './modules/health.js';
import { authRoutes } from './modules/auth/routes.js';
import { walletRoutes } from './modules/wallets/routes.js';
import { paymentRoutes } from './modules/payments/routes.js';
import { transactionRoutes } from './modules/transactions/routes.js';
import { exchangeRoutes } from './modules/exchange/routes.js';
import { betRoutes } from './modules/bets/routes.js';
import { withdrawalRoutes } from './modules/withdrawals/routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: any, reply: any) => Promise<void>;
  }
}

export async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(swagger, {
    openapi: {
      info: { title: 'FlowPay API', version: '0.1.0', description: 'Multi-currency payment gateway: mock fiat + REAL Solana devnet settlement, double-entry ledger, Rust settlement worker.' },
      servers: [{ url: 'http://localhost:4000' }],
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  // JWTs expire after 24h. Expired/invalid tokens fail jwtVerify → clean 401 via requireAuth.
  await app.register(fastifyJwt, { secret: config.jwtSecret, sign: { expiresIn: '24h' } });
  app.decorate('authenticate', requireAuth);

  // CORS: allow only the configured frontend origin(s). Comma-separated list supported.
  // Never use '*' with authenticated (Bearer) requests.
  const allowedOrigins = config.frontendUrl.split(',').map((s) => s.trim()).filter(Boolean);
  await app.register(fastifyCors, {
    origin: (origin, cb) => {
      // Allow same-origin / non-browser requests with no Origin header.
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`Origin ${origin} not allowed by CORS.`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  });

  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });

  // Global error shape: { success:false, error:{code,message} } — never leak stack traces.
  app.setErrorHandler((error, _req, reply) => {
    const status = (error as any).statusCode && (error as any).statusCode < 500 ? (error as any).statusCode : 500;
    const code = status === 500 ? 'INTERNAL_ERROR' : ((error as any).code ?? 'BAD_REQUEST');
    if (status >= 500) app.log.error(error);
    reply.code(status).send({ success: false, error: { code, message: status === 500 ? 'Something went wrong.' : (error as Error).message } });
  });

  await app.register(healthRoutes, { prefix: '/' });
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(walletRoutes, { prefix: '/api/v1/wallets' });
  await app.register(paymentRoutes, { prefix: '/api/v1/payments' });
  await app.register(transactionRoutes, { prefix: '/api/v1/transactions' });
  await app.register(exchangeRoutes, { prefix: '/api/v1/exchange' });
  await app.register(betRoutes, { prefix: '/api/v1/bets' });
  await app.register(withdrawalRoutes, { prefix: '/api/v1/withdrawals' });

  return app;
}
