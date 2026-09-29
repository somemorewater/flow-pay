// Phantom wallet integration. The frontend only ever sees the public key
// and signed transaction info — never seed phrases or private keys.
'use client';

import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getMint,
} from '@solana/spl-token';

function rpcUrl(): string {
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
}

interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string };
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  signAndSendTransaction(tx: Transaction): Promise<{ signature: string }>;
  on(event: string, cb: (...args: any[]) => void): void;
  removeAllListeners?(event: string): void;
}

declare global {
  interface Window {
    solana?: PhantomProvider;
  }
}

export function isPhantomAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.solana?.isPhantom;
}

export async function connectPhantom(): Promise<string> {
  if (!isPhantomAvailable()) {
    throw new Error('Phantom wallet not found. Install Phantom to continue.');
  }
  const res = await window.solana!.connect();
  return res.publicKey.toString();
}

export async function disconnectPhantom(): Promise<void> {
  await window.solana?.disconnect();
}

export function shortenAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/**
 * Convert a decimal amount string to exact base units (no float math —
 * `Number("0.000000001") * 1e9` can truncate to 0). Throws on invalid input
 * or on precision beyond `decimals` places.
 */
function toBaseUnits(amount: string, decimals: number): bigint {
  const t = amount.trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) throw new Error('Invalid transfer amount.');
  const frac = (m[2] ?? '').padEnd(decimals, '0');
  if (frac.length > decimals) {
    const extra = m[2]!.slice(decimals);
    if (!/^0*$/.test(extra)) throw new Error('Amount has more precision than the asset supports.');
  }
  const units = BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt(frac.slice(0, decimals) || '0');
  if (units <= 0n) throw new Error('Invalid transfer amount.');
  return units;
}

/**
 * Build and send a SOL transfer to the backend-provided recipient for the
 * exact backend-provided amount, signed by the user's Phantom wallet.
 * Returns the on-chain signature (NOT proof of success — the backend must
 * still verify it via POST /payments/:id/verify).
 */
export async function signAndSendSolTransfer(recipient: string, amountSol: string): Promise<string> {
  if (!isPhantomAvailable()) {
    throw new Error('Phantom wallet not found. Install Phantom to continue.');
  }
  const provider = window.solana!;
  if (!provider.publicKey) {
    const res = await provider.connect();
    if (!res.publicKey) throw new Error('Phantom wallet not connected.');
  }
  const from = provider.publicKey!.toString();
  const connection = new Connection(rpcUrl(), 'confirmed');
  // Exact lamports from the decimal string — must match the backend's
  // Decimal(amount) * 1e9 computation lamport-for-lamport.
  const lamports = toBaseUnits(amountSol, 9);
  if (lamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Transfer amount is too large.');

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: new PublicKey(from),
      toPubkey: new PublicKey(recipient),
      lamports: Number(lamports),
    }),
  );
  tx.feePayer = new PublicKey(from);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;

  const { signature } = await provider.signAndSendTransaction(tx);
  return signature;
}

/**
 * Build and send a USDC (SPL token) transfer to the backend-provided
 * treasury address for the exact backend-provided amount, signed by Phantom.
 * Returns the on-chain signature — backend verification is still required.
 */
export async function signAndSendUsdcTransfer(
  treasuryOwner: string,
  amountUi: string,
  usdcMint: string,
): Promise<string> {
  if (!isPhantomAvailable()) {
    throw new Error('Phantom wallet not found. Install Phantom to continue.');
  }
  const provider = window.solana!;
  if (!provider.publicKey) {
    const res = await provider.connect();
    if (!res.publicKey) throw new Error('Phantom wallet not connected.');
  }
  const owner = new PublicKey(provider.publicKey!.toString());
  let mint: PublicKey;
  try {
    mint = new PublicKey(usdcMint);
  } catch {
    throw new Error('USDC payments are not configured. Please try SOL instead.');
  }
  const connection = new Connection(rpcUrl(), 'confirmed');

  // Read decimals from the mint itself — never assume.
  let decimals: number;
  try {
    decimals = (await getMint(connection, mint)).decimals;
  } catch {
    throw new Error('Could not read the USDC mint on Solana Devnet. Please try again later.');
  }
  const baseUnits = toBaseUnits(amountUi, decimals);

  const senderAta = await getAssociatedTokenAddress(mint, owner);
  const treasuryOwnerPk = new PublicKey(treasuryOwner);
  const treasuryAta = await getAssociatedTokenAddress(mint, treasuryOwnerPk);

  const tx = new Transaction();
  // The treasury may never have received this token before — create its
  // associated token account first (rent paid by the sender). The backend
  // verifier only looks for the transferChecked instruction, so the extra
  // instruction is harmless.
  const treasuryAtaInfo = await connection.getAccountInfo(treasuryAta);
  if (!treasuryAtaInfo) {
    tx.add(createAssociatedTokenAccountInstruction(owner, treasuryAta, treasuryOwnerPk, mint));
  }

  tx.add(createTransferCheckedInstruction(senderAta, mint, treasuryAta, owner, baseUnits, decimals));
  tx.feePayer = owner;
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;

  const { signature } = await provider.signAndSendTransaction(tx);
  return signature;
}
