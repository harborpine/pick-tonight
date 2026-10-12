/** Invite code and name helpers (pure; shared by the Firebase and memory implementations and tests). */
import { MAX_NAME_LENGTH } from '../contracts';

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

export type CodeCheck = 'ok' | 'used' | 'expired';

/** `expiresAtMs` is the server-stamped expiry; `nowMs` the phone's clock (only used for the friendly message). */
export function checkCode(rec: { used: boolean; expiresAtMs: number }, nowMs: number): CodeCheck {
  if (rec.used) return 'used';
  if (nowMs >= rec.expiresAtMs) return 'expired';
  return 'ok';
}

// ---- names ----

/** The name with surrounding spaces removed and inner runs of spaces collapsed. */
export function tidyName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** A plain-language problem with this name, or null when it is fine. Length counts visible characters. */
export function nameProblem(name: string): string | null {
  const n = tidyName(name);
  if (n.length === 0) return 'Please type a name.';
  if ([...n].length > MAX_NAME_LENGTH) return `Names can be at most ${MAX_NAME_LENGTH} characters.`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(n)) return "That name has characters that can't be used.";
  return null;
}

/** True when another member (not `exceptId`) already has this name, ignoring upper/lower case. */
export function nameTaken(name: string, members: { id: string; name: string }[], exceptId?: string): boolean {
  const k = tidyName(name).toLowerCase();
  return members.some((m) => m.id !== exceptId && tidyName(m.name).toLowerCase() === k);
}
