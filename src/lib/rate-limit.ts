export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export interface TokenBucketOptions {
  capacity: number;
  refillPerMs: number;
  clock?: Clock;
}

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly clock: Clock;

  constructor(opts: TokenBucketOptions) {
    this.capacity = opts.capacity;
    this.refillPerMs = opts.refillPerMs;
    this.clock = opts.clock ?? systemClock;
    this.tokens = opts.capacity;
    this.lastRefill = this.clock.now();
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;
  }

  async take(cost = 1): Promise<void> {
    this.refill();
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return;
    }
    const deficit = cost - this.tokens;
    const waitMs = Math.ceil(deficit / this.refillPerMs);
    await this.clock.sleep(waitMs);
    this.refill();
    this.tokens = Math.max(0, this.tokens - cost);
  }

  get available(): number {
    this.refill();
    return this.tokens;
  }
}

export function perHour(n: number): TokenBucketOptions {
  return { capacity: n, refillPerMs: n / (60 * 60 * 1000) };
}

export class RateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  constructor(private readonly opts: TokenBucketOptions) {}

  bucketFor(key: string): TokenBucket {
    let b = this.buckets.get(key);
    if (!b) {
      b = new TokenBucket(this.opts);
      this.buckets.set(key, b);
    }
    return b;
  }

  take(key: string, cost = 1): Promise<void> {
    return this.bucketFor(key).take(cost);
  }
}

export async function backoff(
  attempt: number,
  clock: Clock = systemClock,
  baseMs = 500,
  capMs = 30_000,
): Promise<void> {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  const jitter = Math.random() * exp * 0.25;
  await clock.sleep(exp + jitter);
}
