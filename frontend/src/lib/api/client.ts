// Centralized API client. Every backend request goes through here.
// Base URL comes from NEXT_PUBLIC_API_URL — never hardcode hosts in app code.

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const TOKEN_KEY = 'flowpay_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

function baseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) throw new ApiError('CONFIG_ERROR', 'Backend API URL is not configured.', 0);
  return url.replace(/\/$/, '');
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  auth?: boolean;
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, idempotencyKey, auth = true } = opts;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  if (body !== undefined && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    headers['Idempotency-Key'] = idempotencyKey ?? newIdempotencyKey();
  }
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Could not reach the FlowPay backend. Check your connection.', 0);
  }
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    // Non-JSON response
  }
  if (!res.ok) {
    const code = payload?.error?.code ?? `HTTP_${res.status}`;
    const message = payload?.error?.message ?? friendlyHttpMessage(res.status);
    throw new ApiError(code, message, res.status);
  }
  // Backend envelope: { success: true, data: ... }
  if (payload && typeof payload === 'object' && 'success' in payload) {
    if (!payload.success) {
      throw new ApiError(
        payload.error?.code ?? 'UNKNOWN_ERROR',
        payload.error?.message ?? 'Something went wrong.',
        res.status,
      );
    }
    return payload.data as T;
  }
  return payload as T;
}

function friendlyHttpMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Invalid request. Please check your input.';
    case 401:
      return 'Session expired. Please log in again.';
    case 403:
      return 'You are not allowed to do that.';
    case 404:
      return 'Not found.';
    case 409:
      return 'This was already processed.';
    case 410:
      return 'This request has expired.';
    case 422:
      return 'Verification failed.';
    case 429:
      return 'Too many requests. Please wait and try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

export const api = {
  get: <T>(path: string, auth = true) => request<T>(path, { method: 'GET', auth }),
  post: <T>(path: string, body?: unknown, opts?: { idempotencyKey?: string; auth?: boolean }) =>
    request<T>(path, { method: 'POST', body, ...opts }),
};

/** Map technical errors to user-safe messages for the UI. */
export function userMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'NETWORK_ERROR' || e.code === 'CONFIG_ERROR') return e.message;
    return e.message;
  }
  if (e instanceof Error) {
    const m = e.message.toLowerCase();
    if (m.includes('user rejected') || m.includes('rejected the request')) {
      return 'Transaction rejected — you cancelled the Phantom transaction.';
    }
    if (
      m.includes('insufficient') ||
      m.includes('no record of a prior credit') ||
      m.includes('insufficient funds') ||
      m.includes('attempt to debit')
    ) {
      return 'Insufficient balance — fund your Phantom wallet with Devnet SOL (and USDC for token payments) and try again.';
    }
    if (m.includes('blockhash') || m.includes('expired') || m.includes('simulation failed')) {
      return 'The Solana transaction expired before it could be sent. Please try again.';
    }
    if (m.includes('failed to fetch') || m.includes('network')) {
      return 'Network error. Please check your connection and try again.';
    }
    return 'Something went wrong. Please try again.';
  }
  return 'Something went wrong. Please try again.';
}
