// Reusable polling for async backend operations (payment verification,
// bet settlement). Stops on terminal status or when cancelled (unmount).

export type PollStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'expired' | string;

const TERMINAL = new Set(['completed', 'failed', 'expired', 'settled_won', 'settled_lost', 'void']);

export function isTerminal(status: string): boolean {
  return TERMINAL.has(status);
}

export interface PollOptions<T> {
  fetchStatus: () => Promise<T>;
  getStatus: (result: T) => string;
  isDone?: (result: T) => boolean;
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onUpdate?: (result: T) => void;
}

/** Poll fetchStatus until isDone/getStatus is terminal, timeout, or abort. */
export async function pollUntil<T>(opts: PollOptions<T>): Promise<T> {
  const { fetchStatus, getStatus, intervalMs = 3000, timeoutMs = 120000, signal, onUpdate } = opts;
  const isDone = opts.isDone ?? ((r) => isTerminal(getStatus(r)));
  const started = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal?.aborted) throw new Error('Polling cancelled.');
    const result = await fetchStatus();
    onUpdate?.(result);
    if (isDone(result)) return result;
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for confirmation. Check the status later.');
    }
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, intervalMs);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error('Polling cancelled.'));
      }, { once: true });
    });
  }
}
