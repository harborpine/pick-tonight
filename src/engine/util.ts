/** Small pure helpers shared by the engine. No randomness, no clock. */

export const clamp = (x: number, lo = 0, hi = 1): number => (x < lo ? lo : x > hi ? hi : x);

export const round4 = (x: number): number => Math.round(x * 10000) / 10000;

/**
 * Deterministic pseudo-random number in [0, 1) from a seed and a string
 * (FNV-1a with a final avalanche). This is the engine's only source of
 * "variety": same seed + same string = same number, on every device.
 */
export function hash01(seed: number, s: string): number {
  let h = (0x811c9dc5 ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A tiny most-recently-used cache so repeated requests don't redo expensive work. */
export class SmallCache<V> {
  private map = new Map<string, V>();
  constructor(private max: number) {}
  get(key: string, make: () => V): V {
    const hit = this.map.get(key);
    if (hit !== undefined) {
      this.map.delete(key);
      this.map.set(key, hit);
      return hit;
    }
    const v = make();
    this.map.set(key, v);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    return v;
  }
}
