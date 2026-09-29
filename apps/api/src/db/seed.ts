import { pool } from '../lib/db.js';

/** Mock FX table (NOT live market data). USD base. */
const RATES: Array<[string, string, string]> = [
  ['USD', 'NGN', '1533'],
  ['NGN', 'USD', '0.0006522'],
  ['USD', 'EUR', '0.92'],
  ['EUR', 'USD', '1.0869'],
  ['USD', 'GBP', '0.79'],
  ['GBP', 'USD', '1.2658'],
  ['USD', 'USDC', '1'],
  ['USDC', 'USD', '1'],
  ['USD', 'SOL', '0.00625'], // 1 USD ≈ 0.00625 SOL (mock: SOL ≈ $160)
  ['SOL', 'USD', '160'],
  ['USDC', 'SOL', '0.00625'],
  ['SOL', 'USDC', '160'],
  ['NGN', 'USDC', '0.0006522'],
  ['USDC', 'NGN', '1533'],
];

async function main() {
  for (const [base, quote, rate] of RATES) {
    await pool.query(
      `INSERT INTO exchange_rates (base, quote, rate) VALUES ($1,$2,$3)
       ON CONFLICT (base, quote) DO UPDATE SET rate = EXCLUDED.rate, updated_at = now()`,
      [base, quote, rate],
    );
  }
  console.log(`seeded ${RATES.length} mock rates`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
