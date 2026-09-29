import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { config } from '../../lib/config.js';
import Decimal from 'decimal.js';

const connection = new Connection(config.solanaRpcUrl, 'confirmed');

export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

/** True when the configured USDC mint is a syntactically valid Solana address. */
export function usdcMintConfigured(): boolean {
  try {
    new PublicKey(config.solanaUsdcMint);
    return true;
  } catch {
    return false;
  }
}

/**
 * Error codes whose messages are user-safe (they describe the verification
 * outcome, not internals). Anything else (e.g. raw RPC failures) must be
 * logged server-side and replaced with a generic message.
 */
export const USER_SAFE_VERIFICATION_CODES = new Set(['NOT_FOUND', 'FAILED', 'MISMATCH', 'SENDER', 'CONFIG']);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getAccountBalanceSol(address: string): Promise<string> {
  const lamports = await connection.getBalance(new PublicKey(address));
  return new Decimal(lamports).div(LAMPORTS_PER_SOL).toString();
}

export interface ExpectedTransfer {
  recipient: string;
  amount: string; // decimal string in SOL or token units
  asset: 'SOL' | 'USDC';
  sender?: string; // optional expected signer
}

export interface VerificationResult {
  fromAddress: string;
  toAddress: string;
  amount: string;
  asset: string;
  slot: number | null;
  blockTime: number | null;
}

/**
 * Fetch a parsed transaction, waiting briefly for Devnet propagation.
 * A signature submitted immediately after Phantom sends it may not be
 * visible yet — retry instead of failing the verification outright.
 * Strictness is unchanged: the returned tx is still fully verified.
 */
async function getConfirmedParsedTransaction(signature: string): Promise<any | null> {
  const attempts = 15;
  for (let i = 0; i < attempts; i++) {
    const tx = await connection.getParsedTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    if (tx) return tx;
    if (i < attempts - 1) await sleep(2000);
  }
  return null;
}

/**
 * Verify a REAL Solana devnet transaction against the payment intent.
 * Throws on any mismatch. Never trusts frontend claims — chain is source of truth.
 */
export async function verifyDevnetTransfer(
  signature: string,
  expected: ExpectedTransfer,
): Promise<VerificationResult> {
  if (expected.asset === 'USDC' && !usdcMintConfigured()) {
    throw Object.assign(new Error('USDC payments are not configured on this backend.'), { code: 'CONFIG' });
  }
  const tx = await getConfirmedParsedTransaction(signature);
  if (!tx) throw Object.assign(new Error('Transaction not found on Solana devnet.'), { code: 'NOT_FOUND' });
  if (tx.meta?.err) throw Object.assign(new Error('Transaction failed on-chain.'), { code: 'FAILED' });

  const slot = tx.slot ?? null;
  const blockTime = tx.blockTime ?? null;

  if (expected.asset === 'SOL') {
    const r = verifySolTransfer(tx as any, expected);
    return { ...r, asset: 'SOL', slot, blockTime };
  } else {
    const r = await verifyUsdcTransfer(tx as any, signature, expected);
    return { ...r, asset: 'USDC', slot, blockTime };
  }
}

function verifySolTransfer(tx: any, expected: ExpectedTransfer) {
  const instructions = tx?.transaction?.message?.instructions ?? [];
  const expectedLamports = new Decimal(expected.amount).mul(LAMPORTS_PER_SOL).trunc().toNumber();

  let match: { from: string; to: string; lamports: number } | null = null;
  for (const ix of instructions) {
    const parsed = ix?.parsed;
    if (!parsed || ix.program !== 'system') continue;
    if (parsed.type !== 'transfer') continue;
    const info = parsed.info ?? {};
    if (info.destination !== expected.recipient) continue;
    if (Number(info.lamports) !== expectedLamports) continue;
    match = { from: info.source, to: info.destination, lamports: Number(info.lamports) };
    break;
  }
  if (!match) {
    throw Object.assign(
      new Error(
        `No matching SOL transfer found (expected ${expected.amount} SOL to ${expected.recipient}). Wrong recipient, amount, or transaction.`,
      ),
      { code: 'MISMATCH' },
    );
  }
  if (expected.sender && match.from !== expected.sender) {
    throw Object.assign(new Error(`Unexpected sender ${match.from}, expected ${expected.sender}.`), { code: 'SENDER' });
  }
  return {
    fromAddress: match.from,
    toAddress: match.to,
    amount: new Decimal(match.lamports).div(LAMPORTS_PER_SOL).toString(),
  };
}

async function verifyUsdcTransfer(tx: any, signature: string, expected: ExpectedTransfer) {
  const instructions = tx?.transaction?.message?.instructions ?? [];
  const inner: any[] = tx?.meta?.innerInstructions?.flatMap((g: any) => g.instructions ?? []) ?? [];
  const all = [...instructions, ...inner];

  // Expected amount in base units (USDC = 6 decimals on devnet test mint by convention;
  // read actual decimals from parsed transferChecked when present).
  let match: { fromAddress: string; toAddress: string; amount: string } | null = null;

  // Strategy 1: parsed transferChecked / transfer instructions on the token program.
  for (const ix of all) {
    const parsed = ix?.parsed;
    if (!parsed) continue;
    const info = parsed.info ?? {};
    if (parsed.type === 'transferChecked') {
      if (info.mint !== config.solanaUsdcMint) continue;
      const decimals = Number(info.tokenAmount?.decimals ?? 6);
      const uiAmount = String(info.tokenAmount?.uiAmountString ?? info.tokenAmount?.uiAmount ?? '');
      if (!amountEquals(uiAmount, expected.amount)) continue;
      // Destination is a token account; resolve its owner and require it to be the treasury.
      const destOwner = await tokenAccountOwner(info.destination);
      if (destOwner !== expected.recipient) continue;
      if (expected.sender) {
        const srcOwner = await tokenAccountOwner(info.source).catch(() => null);
        if (srcOwner && srcOwner !== expected.sender) continue;
      }
      const srcOwner = (await tokenAccountOwner(info.source).catch(() => null)) ?? info.authority ?? info.source;
      void decimals;
      match = { fromAddress: srcOwner, toAddress: destOwner, amount: uiAmount };
      break;
    }
  }

  // Strategy 2: fallback to pre/post token balance diffs for the configured mint.
  if (!match) {
    const pre = tx?.meta?.preTokenBalances ?? [];
    const post = tx?.meta?.postTokenBalances ?? [];
    const byAcct = new Map<string, { pre: Decimal; post: Decimal; owner: string }>();
    for (const b of pre) {
      if (b.mint !== config.solanaUsdcMint) continue;
      const e = byAcct.get(b.accountIndex) ?? { pre: new Decimal(0), post: new Decimal(0), owner: b.owner ?? '' };
      e.pre = new Decimal(b.uiTokenAmount?.uiAmountString ?? '0');
      e.owner = b.owner ?? e.owner;
      byAcct.set(b.accountIndex, e);
    }
    for (const b of post) {
      if (b.mint !== config.solanaUsdcMint) continue;
      const e = byAcct.get(b.accountIndex) ?? { pre: new Decimal(0), post: new Decimal(0), owner: b.owner ?? '' };
      e.post = new Decimal(b.uiTokenAmount?.uiAmountString ?? '0');
      e.owner = b.owner ?? e.owner;
      byAcct.set(b.accountIndex, e);
    }
    let credited: { owner: string; amount: Decimal } | null = null;
    let debited: { owner: string; amount: Decimal } | null = null;
    for (const e of byAcct.values()) {
      const diff = e.post.minus(e.pre);
      if (diff.gt(0) && e.owner === expected.recipient) {
        if (!credited || diff.gt(credited.amount)) credited = { owner: e.owner, amount: diff };
      }
      if (diff.lt(0)) {
        if (!debited || diff.abs().gt(debited.amount)) debited = { owner: e.owner, amount: diff.abs() };
      }
    }
    if (credited && amountEquals(credited.amount.toString(), expected.amount)) {
      if (expected.sender && debited && debited.owner !== expected.sender) {
        throw Object.assign(new Error(`Unexpected sender ${debited.owner}.`), { code: 'SENDER' });
      }
      match = { fromAddress: debited?.owner ?? 'unknown', toAddress: credited.owner, amount: credited.amount.toString() };
    }
  }

  if (!match) {
    throw Object.assign(
      new Error(
        `No matching USDC transfer found (expected ${expected.amount} USDC [mint ${config.solanaUsdcMint}] to ${expected.recipient}).`,
      ),
      { code: 'MISMATCH' },
    );
  }
  return match;
}

async function tokenAccountOwner(tokenAccount: string): Promise<string> {
  const info = await connection.getParsedAccountInfo(new PublicKey(tokenAccount));
  const data: any = info.value?.data;
  const owner = data?.parsed?.info?.owner;
  if (!owner) throw new Error(`Could not resolve token account owner for ${tokenAccount}`);
  return owner;
}

function amountEquals(a: string, b: string): boolean {
  try {
    return new Decimal(a).eq(new Decimal(b));
  } catch {
    return false;
  }
}

export function validateSolanaAddress(addr: string): boolean {
  try {
    const pk = new PublicKey(addr);
    return PublicKey.isOnCurve(pk.toBytes());
  } catch {
    return false;
  }
}
