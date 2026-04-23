import { test, expect } from "bun:test";
import { TokenBucket, perHour } from "../../src/lib/rate-limit.ts";

class FakeClock {
  t = 0;
  slept = 0;
  now() {
    return this.t;
  }
  async sleep(ms: number) {
    this.slept += ms;
    this.t += ms;
  }
}

test("token bucket starts at capacity", () => {
  const clock = new FakeClock();
  const b = new TokenBucket({ ...perHour(10), clock });
  expect(b.available).toBe(10);
});

test("token bucket drains on take", async () => {
  const clock = new FakeClock();
  const b = new TokenBucket({ ...perHour(10), clock });
  await b.take(3);
  expect(b.available).toBeCloseTo(7, 3);
});

test("token bucket sleeps when empty", async () => {
  const clock = new FakeClock();
  const b = new TokenBucket({ capacity: 2, refillPerMs: 0.001, clock });
  await b.take(2);
  await b.take(1);
  expect(clock.slept).toBeGreaterThan(0);
});

test("refill does not exceed capacity", async () => {
  const clock = new FakeClock();
  const b = new TokenBucket({ ...perHour(5), clock });
  clock.t += 10 * 60 * 60 * 1000;
  expect(b.available).toBeLessThanOrEqual(5);
});
