import { test, expect } from "bun:test";
import { IgApiError, IgClient } from "../../src/ig/client.ts";
import { ExitCode } from "../../src/lib/exit-codes.ts";
import { RateLimiter, perHour, type Clock } from "../../src/lib/rate-limit.ts";
import { z } from "zod";

const fastClock: Clock = { now: () => 0, sleep: async () => {} };
const limiter = new RateLimiter(perHour(1000));

type MockRes = { status?: number; body?: string; json?: unknown };

function mockFetch(responses: Array<MockRes | Error>): typeof fetch {
  let i = 0;
  return (async () => {
    const r = responses[i++];
    if (r instanceof Error) throw r;
    const mock = r ?? {};
    return new Response(
      typeof mock.body === "string" ? mock.body : JSON.stringify(mock.json ?? {}),
      { status: mock.status ?? 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

test("returns parsed JSON on 200", async () => {
  const fetchFn = mockFetch([{ status: 200, json: { id: "1", name: "x" } }]);
  const c = new IgClient({ token: "t", fetchFn, limiter, clock: fastClock });
  const res = await c.get("/me", {}, z.object({ id: z.string(), name: z.string() }));
  expect(res.id).toBe("1");
});

test("retries on 429 and eventually succeeds", async () => {
  const fetchFn = mockFetch([
    { status: 429, json: { error: { message: "rate limit", code: 17 } } },
    { status: 200, json: { id: "1" } },
  ]);
  const c = new IgClient({ token: "t", fetchFn, limiter, clock: fastClock, maxRetries: 3 });
  const res = await c.get("/me", {}, z.object({ id: z.string() }));
  expect(res.id).toBe("1");
});

test("maps 401 to AuthExpired", async () => {
  const fetchFn = mockFetch([
    { status: 401, json: { error: { message: "expired", code: 190 } } },
  ]);
  const c = new IgClient({ token: "t", fetchFn, limiter, clock: fastClock });
  await expect(c.get("/me", {})).rejects.toMatchObject({ exitCode: ExitCode.AuthExpired });
});

test("maps non-retriable 400 to ApiError", async () => {
  const fetchFn = mockFetch([
    { status: 400, json: { error: { message: "bad", code: 100 } } },
  ]);
  const c = new IgClient({ token: "t", fetchFn, limiter, clock: fastClock });
  await expect(c.get("/me", {})).rejects.toBeInstanceOf(IgApiError);
});

test("maps network errors after retries", async () => {
  const fetchFn = mockFetch([new Error("ECONNRESET"), new Error("ECONNRESET")]);
  const c = new IgClient({ token: "t", fetchFn, limiter, clock: fastClock, maxRetries: 1 });
  await expect(c.get("/me", {})).rejects.toMatchObject({ exitCode: ExitCode.NetworkError });
});

test("builds URL with query params", async () => {
  let capturedUrl = "";
  const fetchFn = (async (url: string) => {
    capturedUrl = url;
    return new Response(JSON.stringify({ id: "1" }), { status: 200 });
  }) as unknown as typeof fetch;
  const c = new IgClient({ token: "t", fetchFn, limiter, clock: fastClock });
  await c.get("/123/media", { fields: "id,caption", limit: 10 }, z.object({ id: z.string() }));
  expect(capturedUrl).toContain("fields=id%2Ccaption");
  expect(capturedUrl).toContain("limit=10");
});
