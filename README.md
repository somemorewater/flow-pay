# FlowPay — Multi-Currency Payment Gateway (MVP)

Multi-currency payment infrastructure with a Next.js frontend, a Node.js API backed by
a PostgreSQL double-entry ledger, Redis-backed idempotency and job queue, an async Rust
settlement worker, and **REAL Solana Devnet deposits** verified on-chain.

```
Browser (Phantom wallet for signing)
   │  NEXT_PUBLIC_API_URL
   ▼
Next.js frontend (http://localhost:3000)
   │  REST + JWT
   ▼
Node.js API (Fastify + TypeScript, http://localhost:4000, Swagger at /docs)
   │
   ├── PostgreSQL (source of truth: wallets, double-entry ledger, payments, bets)
   ├── Redis (idempotency cache + settlement job queue)
   ├── Rust settlement worker (consumes queue, settles bets, posts ledger entries)
   └── Solana Devnet (SOL / USDC deposit verification)
```

## What is real vs simulated

### Real

- Authentication (JWT, bcrypt, 24h expiry)
- PostgreSQL wallet balances + double-entry ledger (viewable in-app via Wallet → Ledger)
- Solana Devnet deposits: Phantom signing, backend on-chain verification, ledger credit
- Solana transaction history with Devnet Explorer links
- Exchange execution against configured rates (ledger-backed, with fee)
- Bet settlement through Redis → Rust worker → ledger
- Idempotency on mutating endpoints

### Simulated / demo-only

- Fiat deposits and withdrawals (`mock-fiat` provider — no real money moves)
- Exchange rates (configured mock table, seeded — not live market data; the
  dashboard total is explicitly labeled "at configured rates")
- Bet outcomes (deterministic, hash-derived 45% win — the backend derives them)
- Crypto withdrawals are disabled end-to-end (no on-chain payouts)

## Features

- JWT auth (`register` / `login` / `me`, bcrypt hashing, tokens expire after 24h)
- Multi-currency internal wallet (USD, NGN, EUR, GBP, SOL, USDC) with ledger view,
  withdrawal history, and external Phantom Devnet balance display
- Double-entry ledger (every balance change is a balanced debit/credit set in one PG transaction)
- Payment intents: `POST /api/v1/payments/intents` with `Idempotency-Key` support,
  plus payment detail view with asset, network, recipient, signature, and Explorer link
- **SOL + USDC deposits verified against REAL Solana devnet transactions**
  (`POST /api/v1/payments/:id/verify` checks existence, success, recipient, amount, mint, sender, replay)
- `blockchain_transactions` table stores signatures → frontend links
  `https://explorer.solana.com/tx/<SIG>?cluster=devnet`
- Bet API + async settlement via Redis queue + Rust worker (idempotent, retry-safe),
  with live settlement-status polling in the UI
- Exchange with mock rates + fee, executed as ledger transactions
- Transactions history with server-side filters and per-type explanations
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

## Portfolio demo script (5 minutes)

1. Register at http://localhost:3000, open the dashboard — balances load from PostgreSQL.
2. **SOL deposit (real Devnet):** Wallet → Deposit → Crypto → SOL → amount → Continue →
   Connect Phantom → Pay with Phantom → approve. Payment completes only after backend
   on-chain verification; open the Devnet Explorer link and watch the SOL balance update.
3. **Wallet → Ledger:** every deposit/settlement shows its double-entry debit/credit lines.
4. **Exchange:** quote and execute (ledger-backed, fee applied). **Bets:** create, then
   Settle — the Rust worker settles via Redis and the UI polls the real status.
5. **Transactions:** filter by type/currency/status; open a deposit to see its linked
   payment status and Explorer link. **Payments:** track any intent and inspect details.

## Solana devnet deposit flow (the core path)

```
1. Connect Phantom (frontend holds the private key — backend NEVER takes custody).
2. POST /api/v1/payments/intents { amount, currency: "SOL"|"USDC", type: "crypto" }
   → backend returns { id, recipient (treasury), amount, asset, network }.
3. Frontend builds a transfer to `recipient` for exactly `amount` (exact integer
   base-unit math, no floats) and asks Phantom to sign.
4. Frontend POSTs { signature } to /api/v1/payments/:id/verify.
5. Backend waits for the transaction to appear at `confirmed` commitment, then
   fetches the REAL transaction from devnet, verifies success / recipient /
   amount / mint / sender, rejects replays + wrong-user + expired, then completes
   the payment and posts the ledger entries. Unexpected RPC failures are logged
   server-side and answered with a generic message (no raw RPC text to clients).
```

### Devnet setup required for the demo

- Fund your Phantom wallet with devnet SOL: `solana airdrop 2 <ADDRESS> --url devnet`
  or https://faucet.solana.com.
- `FLOWPAY_TREASURY_ADDRESS` must be a valid devnet address (public key only).
  It does not need pre-funding for SOL (a transfer creates the account), and the
  frontend creates the treasury's USDC associated token account automatically
  (rent paid by the sender) when needed.
- `SOLANA_USDC_MINT` must be a **valid** devnet token mint address. USDC intent
  creation is rejected with a clear error while the mint is misconfigured — the
  backend never guesses or substitutes another token.

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
