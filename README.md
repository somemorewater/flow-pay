# FlowPay — Multi-Currency Payment Gateway

FlowPay is a multi-currency payment gateway built to demonstrate end-to-end payment processing across fiat and cryptocurrency. It combines Node.js, Rust, PostgreSQL, Redis, and Solana Devnet to handle wallets, payments, currency exchange, betting transactions, blockchain verification, and reliable settlement workflows.

## Features

### Implemented / Real

- JWT authentication (register / login / me, bcrypt hashing, 24h token expiry)
- PostgreSQL wallet system (multi-currency balances per user)
- Double-entry ledger (every balance change is a balanced debit/credit set in one Postgres transaction; viewable in-app via Wallet → Ledger)
- Redis idempotency (`Idempotency-Key` on mutating endpoints, 24h replay window)
- Solana Devnet deposits (SOL + USDC intents)
- Phantom wallet integration (connect, sign; private keys never leave the wallet)
- Server-side blockchain verification (existence, success, recipient, exact amount, mint, sender, replay, expiry, ownership)
- Solana transaction tracking (signatures stored, Devnet Explorer links in UI)
- Currency exchange (quote + execute against configured rates, fee applied, ledger-backed)
- Betting workflow (create, settle → 202, async status polling)
- Rust settlement worker (Redis queue → deterministic settlement → ledger + history)
- Transaction history (server-side type/currency/status filters, per-type explanations)
- Health probes (`/health`, `/ready` reflecting Postgres + Redis), Swagger at `/docs`

### Simulated / Demo

- Fiat deposits and withdrawals (`mock-fiat` provider — no real money moves; UI labels them simulated)
- Exchange rates (configured mock table, seeded — not live market data; dashboard totals labeled "at configured rates")
- Bet outcomes (deterministic, hash-derived ~45% win; clearly a demo stand-in, settled through the real Rust pipeline)
- Crypto withdrawals are disabled end-to-end (`POST /withdrawals` rejects `SOL`/`USDC`; no on-chain payouts)

## Architecture

```text
Next.js Frontend (login, wallet, deposit modal + Phantom, exchange, bets, history)
       │  REST + JWT (NEXT_PUBLIC_API_URL, CORS allowlist via FRONTEND_URL)
       ▼
Node.js / Fastify API (port 4000, Swagger at /docs)
   │              │                    │
   ▼              ▼                    ▼
Postgres      Redis               Solana Devnet
(wallets,     (idempotency        (deposit verification,
 double-entry  cache +             Explorer links)
 ledger,       settlement
 payments,     queue)
 bets,            │
 history)        ▼
   │        Rust Settlement Worker
   │        (BLPOP jobs, idempotent settle,
   ▼         balance-checked ledger writes)
Double-Entry Ledger
```

## Solana Flow

```text
Create payment intent (amount, SOL|USDC, type: crypto)
        ↓ backend returns payment ID + exact amount + treasury recipient + network
Phantom signs Devnet transaction (exact integer base units, no floats)
        ↓
Transaction submitted to Solana Devnet
        ↓
Signature sent to backend (POST /payments/:id/verify)
        ↓
Backend independently verifies transaction at `confirmed` commitment
(existence, success, recipient, exact amount, mint, sender, replay, expiry, ownership)
        ↓
Ledger transaction (user credit / house debit, atomic with payment completion)
        ↓
Wallet balance updated → history + Explorer link appear in UI
```

The frontend signature alone never determines success: funds move only after the backend verifies the transaction on-chain. Unexpected RPC failures are logged server-side and answered with a generic message.

## Tech Stack

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, `@solana/web3.js` + `@solana/spl-token` (Phantom signing only), hand-rolled CSS
- **Backend:** Node.js 22, Fastify 5, TypeScript, `pg` (raw parameterized SQL + SQL migrations), `ioredis`, `@fastify/jwt` + `@fastify/cors` + `@fastify/rate-limit` + Swagger, `zod`, `bcryptjs`, `decimal.js`
- **Worker:** Rust (tokio, sqlx, redis, rust_decimal, sha2 for deterministic demo outcomes)
- **Infra:** PostgreSQL 16, Redis 7 (Docker Compose for local dev), Solana Devnet

## Local Development

### Prerequisites

- Node.js 22 + `corepack`/`pnpm`
- Rust toolchain (only for the settlement worker)
- Docker (for Postgres + Redis)
- A Phantom wallet set to **Devnet** (only for the crypto-deposit demo)

### 1. Environment

```bash
cp .env.example .env
# Required: set JWT_SECRET to a long random value (min 32 chars) — the API refuses to boot without it.
# Set FLOWPAY_TREASURY_ADDRESS to your devnet wallet (public address only — no private keys server-side).
```

Frontend:

```bash
cd frontend
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
```

### 2. Infrastructure, migrations, seed

```bash
docker compose up -d            # postgres on :5433, redis on :6380

cd apps/api
pnpm install
pnpm run migrate                # applies migrations/001_init.sql (tracked, idempotent)
pnpm run seed                   # loads mock exchange rates (upsert, idempotent)
pnpm run dev                    # API on http://localhost:4000 (docs at /docs)
```

### 3. Rust settlement worker

```bash
cd services/settlement
DATABASE_URL=postgres://flowpay:flowpaysecret@localhost:5433/flowpay \
REDIS_URL=redis://localhost:6380 \
cargo run
```

(The worker reads `DATABASE_URL`/`REDIS_URL` from the environment or a `services/settlement/.env` file — it does not read the repo-root `.env`, since `dotenvy` loads from the working directory.)

### 4. Frontend

```bash
cd frontend
pnpm install
pnpm run dev                    # http://localhost:3000
```

### 5. Portfolio demo script (5 minutes)

1. Register at http://localhost:3000 — dashboard balances load from PostgreSQL.
2. **SOL deposit (real Devnet):** Wallet → Deposit → Crypto → SOL → amount → Continue →
   Connect Phantom → Pay with Phantom → approve. Payment completes only after backend
   on-chain verification; open the Devnet Explorer link and watch the SOL balance update.
3. **Wallet → Ledger:** every deposit/settlement shows its double-entry debit/credit lines.
4. **Exchange:** quote and execute (ledger-backed, fee applied). **Bets:** create, then
   Settle — the Rust worker settles via Redis and the UI polls the real status.
5. **Transactions:** filter by type/currency/status; open a deposit to see its linked
   payment status and Explorer link. **Payments:** track any intent and inspect details.

## Solana Devnet Setup

- Use a dedicated Devnet wallet for the demo (Phantom → Settings → Developer Settings → Testnet Mode, select **Devnet**).
- Set `FLOWPAY_TREASURY_ADDRESS` to a devnet address you control (public key only).
  It needs no pre-funding for SOL (a transfer creates the account); the frontend creates
  the treasury's USDC associated token account automatically (rent paid by the sender).
- Keep `SOLANA_NETWORK=devnet` — the backend refuses to boot with any other value.
- `SOLANA_USDC_MINT` must be a **valid** devnet token mint address. USDC intent creation
  is rejected with a clear error while the mint is misconfigured — the backend never
  guesses or substitutes another token.
- Obtain devnet SOL: `solana airdrop 2 <ADDRESS> --url devnet` or https://faucet.solana.com
  (you need the deposit amount plus a small fee).
- Test a deposit via the UI flow above; verify it on Solana Explorer
  (`https://explorer.solana.com/tx/<SIGNATURE>?cluster=devnet`).

Never share private keys or seed phrases. Neither the frontend nor the backend ever handles them.

## API

Full interactive reference at `http://localhost:4000/docs` (Swagger). Major groups (all under `/api/v1` unless noted):

- **auth** — `POST /auth/register`, `POST /auth/login` (20 req/min each), `GET /auth/me`
- **wallets** — `GET /wallets` (balances), `GET /wallets/ledger` (double-entry lines)
- **payments** — `POST /payments/intents`, `GET /payments`, `GET /payments/:id`, `POST /payments/:id/verify` (30 req/min), `GET /payments/solana/balance`
- **transactions** — `GET /transactions` (type/currency/status/date filters), `GET /transactions/:id`
- **exchange** — `GET /exchange/rates` (public, labeled mock), `POST /exchange/quote`, `POST /exchange`
- **bets** — `POST /bets`, `GET /bets`, `GET /bets/:id`, `POST /bets/:id/settle` (202, async via Redis + Rust)
- **withdrawals** — `POST /withdrawals` (fiat/simulated only; crypto rejected), `GET /withdrawals`
- **health** — `GET /health`, `GET /ready` (200 only when Postgres + Redis are up)

Envelope: `{ success: true, data }` / `{ success: false, error: { code, message } }`. Server errors are masked (`Something went wrong.`); rate limiting is 200 req/min globally with tighter per-route limits on auth/verify.

## Environment variables

Backend (repo-root `.env`, see `.env.example` — ports match `docker-compose.yml` host mappings):

| Variable | Purpose / notes |
|---|---|
| `DATABASE_URL` | Postgres connection |
| `REDIS_URL` | Redis connection (idempotency + settlement queue `flowpay:settlement:jobs`) |
| `JWT_SECRET` | **Required**, min 32 chars; boot fails without it; tokens expire after 24h |
| `PORT` | API port (default 4000; container binds `0.0.0.0`) |
| `NODE_ENV` | `development` / `production` |
| `SOLANA_RPC_URL` | Devnet RPC (default `https://api.devnet.solana.com`) |
| `SOLANA_NETWORK` | Must be `devnet`/`solana-devnet`, hard-guarded at boot |
| `SOLANA_USDC_MINT` | Devnet USDC mint; must be a valid mint address |
| `FLOWPAY_TREASURY_ADDRESS` | Devnet deposit recipient (public key only) |
| `EXCHANGE_FEE_BPS` | Mock FX fee in basis points (default 50) |
| `FRONTEND_URL` | CORS allowlist (comma-separated, never `*`) |

Frontend (`frontend/.env.local`, public-only — never secrets): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SOLANA_RPC_URL`.

Rust worker: `DATABASE_URL`, `REDIS_URL` (same values as backend; provide via environment or `services/settlement/.env`).

## Limitations

- **Devnet only** — mainnet is refused at boot; no real-money processing anywhere.
- Fiat deposits/withdrawals are simulated (`mock-fiat`); crypto withdrawals are disabled.
- Exchange rates are static mocks; bet outcomes are deterministic demo values (~45% win).
- USDC deposits require a correctly configured `SOLANA_USDC_MINT` holding; misconfiguration fails fast with a clear error.
- Raw `pg` with parameterized queries + SQL migrations instead of an ORM (deliberate: fewer moving parts).
- No automated test suite; JWT has no refresh flow (re-login after 24h).
