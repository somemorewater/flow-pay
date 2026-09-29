# FlowPay — Multi-Currency Payment Gateway (backend MVP)

Multi-currency payment infrastructure demonstrating fiat payment processing, **REAL Solana Devnet settlement**, double-entry accounting, idempotency, and asynchronous Rust settlement.

```
Next.js frontend
      ↓ REST
Node.js API (Fastify + TypeScript)
      ↓
PostgreSQL (source of truth) + Redis (idempotency / job queue)
      ↓
Rust settlement worker ──→ Solana Devnet (SOL / USDC)
```

> **REAL:** Solana Devnet transactions (verified on-chain, never fabricated).
> **SIMULATED:** fiat payments, exchange rates, bet outcomes. Mock fiat uses an explicit
> `mock-fiat` provider so it can never be mistaken for real money movement.

## Features

- JWT auth (`register` / `login` / `me`, bcrypt hashing, tokens expire after 24h)
- Multi-currency internal wallet (USD, NGN, EUR, GBP, SOL, USDC)
- Double-entry ledger (every balance change is a balanced debit/credit set in one PG transaction)
- Payment intents: `POST /api/v1/payments/intents` with `Idempotency-Key` support
- **SOL + USDC deposits verified against REAL Solana devnet transactions**
  (`POST /api/v1/payments/:id/verify` checks existence, success, recipient, amount, mint, sender, replay)
- `blockchain_transactions` table stores signatures → frontend links
  `https://explorer.solana.com/tx/<SIG>?cluster=devnet`
- Bet API + async settlement via Redis queue + Rust worker (idempotent, retry-safe)
- Exchange with mock rates + fee, executed as ledger transactions
- Transactions history with filters, fiat withdrawals (simulated)
- No public webhook endpoint (removed — no provider uses it; internal payment events are recorded directly in SQL)
- Health probes (`/health`, `/ready`), Swagger at `/docs`
- Money as `NUMERIC(36,9)` + decimal strings end-to-end (no float math)

## Running locally

```bash
cp .env.example .env
# set FLOWPAY_TREASURY_ADDRESS to your devnet wallet (public address only — no private keys server-side)
# optional: generate a devnet wallet and fund via faucet (see below)

docker compose up -d            # postgres + redis

cd apps/api
pnpm install
pnpm run migrate                # applies migrations/001_init.sql
pnpm run seed                    # loads mock exchange rates
pnpm run dev                     # API on http://localhost:4000 (docs at /docs)

cd ../../services/settlement
cargo run                       # Rust settlement worker

cd ../../frontend
pnpm install
cp .env.example .env.local      # NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
pnpm run dev                    # frontend on http://localhost:3000
```

Get devnet SOL: `solana airdrop 2 <ADDRESS> --url devnet` or https://faucet.solana.com.

## Solana devnet deposit flow (the core path)

```
1. Connect Phantom (frontend holds the private key — backend NEVER takes custody).
2. POST /api/v1/payments/intents { amount, currency: "SOL"|"USDC", type: "crypto" }
   → backend returns { id, recipient (treasury), amount, asset, network }.
3. Frontend builds a transfer to `recipient` for exactly `amount` and asks Phantom to sign.
4. Frontend POSTs { signature } to /api/v1/payments/:id/verify.
5. Backend fetches the REAL transaction from devnet, verifies success / recipient /
   amount / mint / sender, rejects replays + wrong-user + expired, then completes
   the payment and posts the ledger entries.
```

## Example requests

```bash
# register + deposit intent (SOL)
curl -X POST localhost:4000/api/v1/auth/register \
  -H 'Content-Type: application/json' -d '{"email":"a@x.com","password":"password123"}'
# → { data: { token } }

curl -X POST localhost:4000/api/v1/payments/intents \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: abc-123' \
  -d '{"amount":"0.05","currency":"SOL","type":"crypto"}'

# verify after Phantom signs
curl -X POST localhost:4000/api/v1/payments/pi_xxx/verify \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"signature":"<DEVNET_SIGNATURE>"}'

# bet + async settlement
curl -X POST localhost:4000/api/v1/bets -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"stake":"10.00","currency":"USD","odds":"2.50"}'
curl -X POST localhost:4000/api/v1/bets/<BET_ID>/settle -H "Authorization: Bearer $TOKEN"

# exchange quote + execute
curl -X POST localhost:4000/api/v1/exchange/quote -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"from":"NGN","to":"USD","amount":"100000"}'
```

## Environment variables

See `.env.example`: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` (**required**, min 32 chars —
the API refuses to boot without it; tokens expire after 24h),
`SOLANA_RPC_URL`,
`SOLANA_NETWORK=devnet` (hard-guarded — anything else refuses to boot),
`SOLANA_USDC_MINT`, `FLOWPAY_TREASURY_ADDRESS`, `EXCHANGE_FEE_BPS`, `FRONTEND_URL` (CORS allowlist).

## Known limitations (MVP)

- Uses raw `pg` with parameterized queries + SQL migrations instead of Prisma/Drizzle
  (deliberate: fewer moving parts; injection-safe via placeholders).
- Crypto withdrawals are NOT supported: `POST /withdrawals` rejects `SOL`/`USDC` with
  a clear error (on-chain treasury payout is not implemented; deposits are the live
  devnet path). Only fiat withdrawals (simulated) are available.
- Exchange rates are static mocks, bet outcomes are simulated (45% win, hash-derived).
- Fiat is an explicit mock provider (Paystack/Stripe-shaped seam left for later).
