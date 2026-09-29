export function ok<T>(data: T) {
  return { success: true as const, data };
}

export function err(code: string, message: string, statusCode = 400) {
  return { statusCode, body: { success: false as const, error: { code, message } } };
}

export const Codes = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  IDEMPOTENT_REPLAY: 'IDEMPOTENT_REPLAY',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  PAYMENT_EXPIRED: 'PAYMENT_EXPIRED',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  SIGNATURE_REUSED: 'SIGNATURE_REUSED',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  INTERNAL: 'INTERNAL_ERROR',
} as const;
