import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';

// Load .env from the repo root as well as the package dir, so
// `pnpm run ...` inside apps/api picks up /FlowPay/.env.
for (const p of [
  join(process.cwd(), '.env'),
  join(process.cwd(), '..', '..', '.env'),
  join('/app', '.env'),
]) {
  if (existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: required('DATABASE_URL', 'postgres://flowpay:flowpaysecret@localhost:5432/flowpay'),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  jwtSecret: required('JWT_SECRET', 'dev-only-change-me-min-32-chars-xxxx'),
  solanaRpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
  solanaNetwork: process.env.SOLANA_NETWORK ?? 'solana-devnet',
  solanaUsdcMint: process.env.SOLANA_USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3Gn9VffaKEzWVdcLJ',
  treasuryAddress: process.env.FLOWPAY_TREASURY_ADDRESS ?? '',
  exchangeFeeBps: Number(process.env.EXCHANGE_FEE_BPS ?? 50),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
};

if (config.solanaNetwork !== 'solana-devnet' && config.solanaNetwork !== 'devnet') {
  // Hard guard: this project must never touch mainnet.
  throw new Error(`Refusing to run: SOLANA_NETWORK must be devnet, got "${config.solanaNetwork}"`);
}
