/** Pairing code helpers (pure; shared by the Firebase implementation and tests). */
import { CODE_TTL_MS } from './layout';

/** 31 characters; no 0/O, 1/I/L (easy to misread when typed from another phone). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function generateCode(random: (n: number) => Uint8Array = defaultRandom): string {
  // Rejection sampling avoids modulo bias (248 = 31 * 8).
  let out = '';
  while (out.length < CODE_LENGTH) {
    for (const b of random(CODE_LENGTH * 2)) {
      if (b < 248 && out.length < CODE_LENGTH) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return out;
}

function defaultRandom(n: number): Uint8Array {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}

/** Tidy what a person typed: upper-case, drop spaces and dashes. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

export function isValidCodeShape(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}

export interface CodeRecord {
  used: boolean;
  /** ms since epoch when the code was made (server time). */
  createdAtMs: number;
}

export type CodeCheck = 'ok' | 'used' | 'expired';

export function checkCode(rec: CodeRecord, nowMs: number): CodeCheck {
  if (rec.used) return 'used';
  if (nowMs >= rec.createdAtMs + CODE_TTL_MS) return 'expired';
  return 'ok';
}
