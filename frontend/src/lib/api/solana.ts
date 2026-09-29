// Phantom wallet integration. The frontend only ever sees the public key
// and signed transaction info — never seed phrases or private keys.
'use client';

import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { createTransferCheckedInstruction, getAssociatedTokenAddress } from '@solana/spl-token';

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
  const lamports = Math.trunc(Number(amountSol) * LAMPORTS_PER_SOL);
  if (!isFinite(lamports) || lamports <= 0) throw new Error('Invalid transfer amount.');

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: new PublicKey(from),
      toPubkey: new PublicKey(recipient),
      lamports,
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
  const mint = new PublicKey(usdcMint);
  const connection = new Connection(rpcUrl(), 'confirmed');

  const decimals = 6;
  const baseUnits = BigInt(Math.trunc(Number(amountUi) * 10 ** decimals));
  if (baseUnits <= 0) throw new Error('Invalid transfer amount.');

  const senderAta = await getAssociatedTokenAddress(mint, owner);
  const treasuryAta = await getAssociatedTokenAddress(mint, new PublicKey(treasuryOwner));

  const ix = createTransferCheckedInstruction(senderAta, mint, treasuryAta, owner, baseUnits, decimals);
  const tx = new Transaction().add(ix);
  tx.feePayer = owner;
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;

  const { signature } = await provider.signAndSendTransaction(tx);
  return signature;
}
