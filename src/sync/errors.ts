/** Turns technical failures into sentences a non-technical person can act on. */

/** An error whose message is already plain language. */
export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncError';
  }
}

export const MSG = {
  offline: "Can't reach the internet right now. Check your connection and try again.",
  denied: "This phone isn't allowed to do that. If it keeps happening, pair the phones again.",
  generic: 'Something went wrong. Please try again.',
  needsOnline: 'This needs an internet connection. Check your connection and try again.',
  limit: 'The free daily limit was reached. It resets overnight, so try again tomorrow.',
  notPaired: 'This phone is not paired yet.',
  badCode: "That code isn't right, has already been used, or has run out of time. Ask for a new one.",
  sessionGone: 'That Together session is no longer open.',
} as const;

export function friendlyError(e: unknown, fallback: string = MSG.generic): string {
  if (e instanceof SyncError) return e.message;
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string') {
    if (code.includes('permission-denied')) return MSG.denied;
    if (code.includes('unavailable') || code.includes('deadline') || code.includes('network')) return MSG.offline;
    if (code.includes('resource-exhausted')) return MSG.limit;
    if (code.includes('not-found')) return MSG.sessionGone;
  }
  return fallback;
}

export function withTimeout<T>(p: Promise<T>, ms: number, message: string = MSG.offline): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new SyncError(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
