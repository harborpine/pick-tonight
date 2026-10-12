/** Turns technical failures into sentences a non-technical person can act on. */
import { APP_NAME } from '../config';

/** An error whose message is already plain language. */
export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncError';
  }
}

export const MSG = {
  offline: "Can't reach the internet right now. Check your connection and try again.",
  denied: "This phone isn't allowed to do that. If it keeps happening, join the household again with a new invite.",
  generic: 'Something went wrong. Please try again.',
  needsOnline: 'This needs an internet connection. Check your connection and try again.',
  quota: `${APP_NAME} is very busy today and has hit its free limit. Your lists are safe — please try again tomorrow.`,
  notPaired: 'This phone is not in a household yet.',
  badCode: "That code isn't right. Check it and try again, or ask for a new one.",
  usedCode: 'That invite has already been used. Ask for a new one.',
  expiredCode: 'That invite has run out of time (they last 24 hours). Ask for a new one.',
  full: 'That household already has 4 people. If you are one of them, choose "I\'m already a member".',
  nameTaken: 'Someone in this household already has that name. Please pick a different one.',
  sessionGone: 'That Together session is no longer open.',
  deleted: 'This household was deleted.',
  removed: 'This phone is no longer part of the household. Join again with a new invite if you want to come back.',
  memberGone: "That person isn't in this household any more.",
  cantInvite: 'Only someone already in the household can make an invite.',
} as const;

/** True for Firestore's "free quota used up" failure. */
export function isQuotaError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.includes('resource-exhausted');
}

export function friendlyError(e: unknown, fallback: string = MSG.generic): string {
  if (e instanceof SyncError) return e.message;
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string') {
    if (code.includes('resource-exhausted')) return MSG.quota;
    if (code.includes('permission-denied')) return MSG.denied;
    if (code.includes('unavailable') || code.includes('deadline') || code.includes('network')) return MSG.offline;
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
