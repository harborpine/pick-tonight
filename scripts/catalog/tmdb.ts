/** Minimal TMDB v3 client (Bearer v4 token): bounded concurrency, retry with backoff on 429 / 5xx / network errors. */
import { sleep } from './util';

export class TmdbError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Params = Record<string, string | number | boolean | undefined>;

export interface ClientOptions {
  token: string;
  /** Max requests in flight. TMDB tolerates roughly 40-50 per second; 12 in flight stays well under. */
  concurrency?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  baseUrl?: string;
}

export class TmdbClient {
  private inFlight = 0;
  private waiters: Array<() => void> = [];
  readonly stats = { requests: 0, retries: 0, failures: 0 };
  private readonly o: Required<Omit<ClientOptions, 'token'>> & { token: string };

  constructor(opts: ClientOptions) {
    this.o = {
      concurrency: 12,
      maxAttempts: 6,
      fetchImpl: fetch,
      sleepImpl: sleep,
      baseUrl: 'https://api.themoviedb.org/3',
      ...opts,
    };
  }

  private async acquire() {
    if (this.inFlight < this.o.concurrency) {
      this.inFlight++;
      return;
    }
    await new Promise<void>((r) => this.waiters.push(r));
  }

  private release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.inFlight--;
  }

  async get<T = any>(path: string, params: Params = {}): Promise<T> {
    const url = new URL(this.o.baseUrl + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
    await this.acquire();
    try {
      let lastErr: unknown;
      for (let attempt = 1; attempt <= this.o.maxAttempts; attempt++) {
        this.stats.requests++;
        try {
          const res = await this.o.fetchImpl(url, {
            headers: { Authorization: `Bearer ${this.o.token}`, Accept: 'application/json' },
          });
          if (res.ok) return (await res.json()) as T;
          if (res.status === 429 || res.status >= 500) {
            const retryAfter = Number(res.headers.get('retry-after'));
            lastErr = new TmdbError(res.status, `TMDB ${res.status} for ${path}`);
            this.stats.retries++;
            await this.o.sleepImpl(backoff(attempt, retryAfter));
            continue;
          }
          // 4xx other than 429: not retryable
          throw new TmdbError(res.status, `TMDB ${res.status} for ${path}`);
        } catch (e) {
          if (e instanceof TmdbError && e.status < 500 && e.status !== 429) throw e;
          lastErr = e;
          if (attempt < this.o.maxAttempts) {
            this.stats.retries++;
            await this.o.sleepImpl(backoff(attempt, 0));
          }
        }
      }
      this.stats.failures++;
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    } finally {
      this.release();
    }
  }
}

function backoff(attempt: number, retryAfterSeconds: number): number {
  if (retryAfterSeconds > 0) return Math.min(retryAfterSeconds, 60) * 1000 + 250;
  return Math.min(30_000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
}

/** GET a JSON file from a URL; null on 404 (first run). Other failures are retried then thrown. */
export async function fetchJsonOptional<T>(url: string, fetchImpl: typeof fetch = fetch, sleepImpl = sleep): Promise<T | null> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetchImpl(url, { headers: { 'Cache-Control': 'no-cache' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      await sleepImpl(1000 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
