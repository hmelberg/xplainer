// Tests for the failure-budget limiter (netlify/lib/rate-limit.mts).
// Run: node --test tests/rate_limit.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFailureBudget, recordFailure, type RateStore } from "../netlify/lib/rate-limit.mts";

/** In-memory stand-in for the Netlify Blobs store. */
function fakeStore(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  const store: RateStore = {
    get: async (key) => (key in data ? data[key] : null),
    setJSON: async (key, value) => {
      data[key] = value;
    },
  };
  return { store: () => store, data };
}

function throwingStore() {
  return () => {
    throw new Error("blobs unavailable");
  };
}

const WINDOW = 60_000;
const OPTS = { windowMs: WINDOW, maxFailures: 3 };

test("a fresh caller is allowed", async () => {
  const { store } = fakeStore();
  const res = await checkFailureBudget("1.2.3.4", { store, ...OPTS });
  assert.equal(res.allowed, true);
});

test("failures accumulate and the budget runs out", async () => {
  const { store } = fakeStore();
  const now = () => 1000;
  for (let i = 0; i < 3; i++) await recordFailure("1.2.3.4", { store, ...OPTS, now });
  const res = await checkFailureBudget("1.2.3.4", { store, ...OPTS, now });
  assert.equal(res.allowed, false);
  assert.ok(res.retryAfterSeconds > 0, "a blocked caller must be told when to retry");
});

test("one failure short of the limit is still allowed", async () => {
  const { store } = fakeStore();
  const now = () => 1000;
  for (let i = 0; i < 2; i++) await recordFailure("1.2.3.4", { store, ...OPTS, now });
  assert.equal((await checkFailureBudget("1.2.3.4", { store, ...OPTS, now })).allowed, true);
});

test("failures older than the window stop counting", async () => {
  const { store } = fakeStore();
  let clock = 1000;
  const now = () => clock;
  for (let i = 0; i < 3; i++) await recordFailure("1.2.3.4", { store, ...OPTS, now });
  assert.equal((await checkFailureBudget("1.2.3.4", { store, ...OPTS, now })).allowed, false);
  clock += WINDOW + 1; // the whole window slides past
  assert.equal((await checkFailureBudget("1.2.3.4", { store, ...OPTS, now })).allowed, true);
});

test("callers are counted separately", async () => {
  const { store } = fakeStore();
  const now = () => 1000;
  for (let i = 0; i < 3; i++) await recordFailure("1.2.3.4", { store, ...OPTS, now });
  assert.equal((await checkFailureBudget("5.6.7.8", { store, ...OPTS, now })).allowed, true);
});

test("a store outage fails OPEN rather than locking everyone out", async () => {
  // Failing closed would turn a Blobs hiccup into a total outage of the
  // feature — a worse failure than briefly missing the limit.
  const res = await checkFailureBudget("1.2.3.4", { store: throwingStore(), ...OPTS });
  assert.equal(res.allowed, true);
  await recordFailure("1.2.3.4", { store: throwingStore(), ...OPTS }); // must not throw
});

test("an unidentifiable caller is allowed rather than blocked as one bucket", async () => {
  // Lumping every unknown-IP request into a single bucket would let one
  // attacker deny the endpoint to everybody else.
  const { store } = fakeStore();
  assert.equal((await checkFailureBudget("", { store, ...OPTS })).allowed, true);
});

test("the stored record keeps only timestamps, never the password", async () => {
  const { store, data } = fakeStore();
  await recordFailure("1.2.3.4", { store, ...OPTS, now: () => 1000 });
  const dumped = JSON.stringify(data);
  assert.match(dumped, /1\.2\.3\.4/);
  assert.match(dumped, /1000/);
  assert.ok(!/password/i.test(dumped), `record should hold no credential material: ${dumped}`);
});
