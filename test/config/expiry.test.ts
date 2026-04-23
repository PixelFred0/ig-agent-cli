import { test, expect } from "bun:test";
import { tokenExpiryState } from "../../src/config/store.ts";

const DAY = 86400;

test("undefined expires_at → unknown", () => {
  expect(tokenExpiryState(undefined, 0)).toEqual({ status: "unknown", daysLeft: null });
});

test("more than 14 days left → fresh", () => {
  expect(tokenExpiryState(30 * DAY, 0).status).toBe("fresh");
  expect(tokenExpiryState(30 * DAY, 0).daysLeft).toBe(30);
});

test("exactly 14 days → expiring-soon", () => {
  expect(tokenExpiryState(14 * DAY, 0).status).toBe("expiring-soon");
});

test("8 days → expiring-soon", () => {
  expect(tokenExpiryState(8 * DAY, 0).status).toBe("expiring-soon");
});

test("7 days → expiring-urgent", () => {
  expect(tokenExpiryState(7 * DAY, 0).status).toBe("expiring-urgent");
});

test("1 day → expiring-urgent", () => {
  expect(tokenExpiryState(1 * DAY, 0).status).toBe("expiring-urgent");
  expect(tokenExpiryState(1 * DAY, 0).daysLeft).toBe(1);
});

test("in the past → expired", () => {
  expect(tokenExpiryState(10, 100).status).toBe("expired");
});

test("exactly now → expired", () => {
  expect(tokenExpiryState(100, 100).status).toBe("expired");
});
