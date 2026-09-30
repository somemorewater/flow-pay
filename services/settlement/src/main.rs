use chrono::Utc;
use redis::AsyncCommands;
use rust_decimal::Decimal;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use std::str::FromStr;
use anyhow::{anyhow, bail, Result};
use tracing::{error, info, warn};

const QUEUE: &str = "flowpay:settlement:jobs";

#[derive(Debug, Deserialize)]
struct SettlementJob {
    #[serde(rename = "betId")]
    bet_id: String,
    #[serde(rename = "settlementId")]
    settlement_id: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    dotenvy::dotenv().ok();

    let database_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://flowpay:flowpaysecret@localhost:5432/flowpay".into());
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".into());

    let pool = PgPool::connect(&database_url).await?;
    let client = redis::Client::open(redis_url)?;
    let mut conn = client.get_multiplexed_async_connection().await?;

    info!("flowpay-settlement worker started (queue={QUEUE})");

    loop {
        // BLPOP with 5s timeout; on timeout, sweep stale pending settlements from DB.
        // A Redis error backs off instead of busy-looping the DB sweep below.
        let job: Option<Vec<String>> = match conn.blpop(QUEUE, 5.0).await {
            Ok(j) => j,
            Err(e) => {
                error!(error = %e, "redis blpop failed; backing off");
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                continue;
            }
        };
        match job {
            Some(parts) => {
                if parts.len() < 2 {
                    warn!(?parts, "malformed job payload");
                    continue;
                }
                let payload = parts[1].clone();
                match serde_json::from_str::<SettlementJob>(&payload) {
                    Ok(j) => {
                        if let Err(e) = settle_one(&pool, &j.bet_id, &j.settlement_id).await {
                            error!(bet_id = %j.bet_id, error = %e, "settlement failed");
                        }
                    }
                    Err(e) => warn!(payload = %payload, error = %e, "bad job payload"),
                }
            }
            None => {
                // Fallback sweep: pick up jobs missed while worker was down.
                if let Err(e) = sweep_pending(&pool).await {
                    error!(error = %e, "sweep failed");
                }
            }
        }
    }
}

async fn sweep_pending(pool: &PgPool) -> Result<()> {
    let rows = sqlx::query(
        "SELECT bet_id, id FROM settlements WHERE status = 'pending' AND created_at < now() - interval '10 seconds' LIMIT 20",
    )
    .fetch_all(pool)
    .await?;
    for r in rows {
        let bet_id: uuid::Uuid = r.get("bet_id");
        let sid: uuid::Uuid = r.get("id");
        if let Err(e) = settle_one(pool, &bet_id.to_string(), &sid.to_string()).await {
            error!(bet_id = %bet_id, error = %e, "sweep settlement failed");
        }
    }
    Ok(())
}

/// Settle a bet idempotently inside a single Postgres transaction.
/// Outcome is SIMULATED (deterministic 45% win derived from bet id hash) — NOT a real sportsbook.
/// Payout = stake * odds on win, 0 on loss.
/// Ledger (win):  escrow -stake, house -(payout-stake), user +payout
/// Ledger (loss): escrow -stake, house +stake
async fn settle_one(pool: &PgPool, bet_id: &str, settlement_id: &str) -> Result<()> {
    let bet_uuid = uuid::Uuid::parse_str(bet_id)?;
    let settle_uuid = uuid::Uuid::parse_str(settlement_id)?;
    let mut tx = pool.begin().await?;

    // Lock bet row.
    let bet = sqlx::query("SELECT * FROM bets WHERE id = $1 FOR UPDATE")
        .bind(bet_uuid)
        .fetch_optional(&mut *tx)
        .await?;
    let bet = match bet {
        Some(b) => b,
        None => {
            // Bet gone: mark settlement failed, commit, done.
            sqlx::query("UPDATE settlements SET status='failed', completed_at=now() WHERE id=$1")
                .bind(settle_uuid)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            warn!(%bet_id, "bet not found; settlement marked failed");
            return Ok(());
        }
    };

    let status: String = bet.get("status");
    if status != "pending" {
        // Duplicate delivery: ensure settlement reflects finality, then ignore.
        sqlx::query("UPDATE settlements SET status='completed', completed_at=COALESCE(completed_at, now()) WHERE id=$1 AND status='pending'")
            .bind(settle_uuid)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        info!(%bet_id, %status, "duplicate settlement job ignored");
        return Ok(());
    }

    let stake: Decimal = bet.get("stake");
    let odds: Decimal = bet.get("odds");
    let currency: String = bet.get("currency");
    let user_id: uuid::Uuid = bet.get("user_id");

    // Deterministic simulated outcome: sha256(bet_id) mod 100 < 45 => win.
    let mut h = Sha256::new();
    h.update(bet_id.as_bytes());
    let digest = h.finalize();
    let roll = digest[0] % 100;
    let won = roll < 45;
    let payout = if won { stake * odds } else { Decimal::ZERO };

    // Resolve user's wallet balance row (must exist: bet creation debited it).
    let bal: Option<sqlx::postgres::PgRow> = sqlx::query(
        "SELECT wb.id, wb.balance FROM wallet_balances wb JOIN wallets w ON w.id = wb.wallet_id WHERE w.user_id = $1 AND wb.currency = $2",
    )
    .bind(user_id)
    .bind(&currency)
    .fetch_optional(&mut *tx)
    .await?;
    let bal = bal.ok_or_else(|| anyhow!("wallet balance row missing"))?;
    let balance_id: uuid::Uuid = bal.get("id");

    // Ledger header.
    let lt: uuid::Uuid = sqlx::query(
        "INSERT INTO ledger_transactions (description, reference_type, reference_id) VALUES ($1,'settlement',$2) RETURNING id",
    )
    .bind(format!("Settlement {bet_id} ({})", if won { "won" } else { "lost" }))
    .bind(bet_id)
    .fetch_one(&mut *tx)
    .await?
    .get("id");

    if won {
        let house_cover = payout - stake; // >= 0 since odds > 1
        insert_line(&mut tx, lt, "escrow", &format!("escrow:{currency}"), &currency, stake, Decimal::ZERO).await?;
        if house_cover > Decimal::ZERO {
            insert_line(&mut tx, lt, "house", &format!("house:{currency}"), &currency, house_cover, Decimal::ZERO).await?;
        }
        insert_line(&mut tx, lt, "user", &balance_id.to_string(), &currency, Decimal::ZERO, payout).await?;
        sqlx::query("UPDATE wallet_balances SET balance = balance + $2, updated_at = now() WHERE id = $1")
            .bind(balance_id)
            .bind(payout)
            .execute(&mut *tx)
            .await?;
    } else {
        insert_line(&mut tx, lt, "escrow", &format!("escrow:{currency}"), &currency, stake, Decimal::ZERO).await?;
        insert_line(&mut tx, lt, "house", &format!("house:{currency}"), &currency, Decimal::ZERO, stake).await?;
    }

    // Balance debits must equal credits per currency — verify before commit.
    let check: Option<Decimal> = sqlx::query_scalar(
        "SELECT SUM(debit - credit) FROM ledger_entries WHERE ledger_transaction_id = $1 AND currency = $2",
    )
    .bind(lt)
    .bind(&currency)
    .fetch_optional(&mut *tx)
    .await?;
    let imbalance = check.unwrap_or(Decimal::ZERO);
    if imbalance != Decimal::ZERO {
        bail!("unbalanced settlement ledger: {imbalance}");
    }

    let new_status = if won { "settled_won" } else { "settled_lost" };
    sqlx::query("UPDATE bets SET status=$2, payout=$3, settlement_id=$4, settled_at=now() WHERE id=$1")
        .bind(bet_uuid)
        .bind(new_status)
        .bind(payout)
        .bind(settle_uuid)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE settlements SET payout=$2, status='completed', completed_at=now() WHERE id=$1")
        .bind(settle_uuid)
        .bind(payout)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO transactions (user_id, type, currency, amount, status, reference_type, reference_id) VALUES ($1,'settlement',$2,$3,'completed','bet',$4)",
    )
    .bind(user_id)
    .bind(&currency)
    .bind(if won { payout } else { stake })
    .bind(bet_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    info!(%bet_id, won, payout = %payout, "settled");
    let _ = Utc::now();
    Ok(())
}

async fn insert_line(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lt: uuid::Uuid,
    account_type: &str,
    account_ref: &str,
    currency: &str,
    debit: Decimal,
    credit: Decimal,
) -> Result<()> {
    let d = Decimal::from_str(&format!("{debit}"))?;
    let c = Decimal::from_str(&format!("{credit}"))?;
    sqlx::query(
        "INSERT INTO ledger_entries (ledger_transaction_id, account_type, account_ref, currency, debit, credit) VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(lt)
    .bind(account_type)
    .bind(account_ref)
    .bind(currency)
    .bind(d)
    .bind(c)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
