// Tests for the key-vending function (netlify/functions/keys.mts).
// Run: node --test tests/keys_vending.test.mts
//
// The handler reads process.env at request time, so each test sets the vars
// it needs and restores them afterwards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleKeysRequest, type KeysDeps } from "../netlify/functions/keys.mts";

// The vending logic and the rate limiter are tested separately; these tests
// inject a limiter that always allows, so a budget change cannot silently
// turn every assertion below into a 429.
const ALLOW_ALL: KeysDeps = {
  checkBudget: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  recordFailure: async () => {},
  clientIp: () => "1.2.3.4",
};
const handler = (req: Request, deps: KeysDeps = ALLOW_ALL) => handleKeysRequest(req, deps);

const VARS = [
  "XPLAINER_PASSWORD",
  "XPLAINER_ANTHROPIC_KEY",
  "XPLAINER_GEMINI_KEY",
  "XPLAINER_OPENAI_KEY",
] as const;

async function withEnv(
  vars: Partial<Record<(typeof VARS)[number], string>>,
  fn: () => Promise<void>,
): Promise<void> {
  const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
  try {
    await fn();
  } finally {
    for (const k of VARS) {
      const v = saved[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function post(body: unknown, raw?: string): Request {
  return new Request("https://xplainer.app/api/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw !== undefined ? raw : JSON.stringify(body),
  });
}

const CONFIGURED = {
  XPLAINER_PASSWORD: "open-sesame",
  XPLAINER_ANTHROPIC_KEY: "sk-ant-real-anthropic",
  XPLAINER_GEMINI_KEY: "AIzaRealGemini",
  XPLAINER_OPENAI_KEY: "sk-real-openai",
};

test("503 when no password is configured", async () => {
  await withEnv({ XPLAINER_ANTHROPIC_KEY: "sk-ant-x" }, async () => {
    const res = await handler(post({ password: "anything" }));
    assert.equal(res.status, 503);
  });
});

test("503 when a password is set but no provider key is", async () => {
  await withEnv({ XPLAINER_PASSWORD: "open-sesame" }, async () => {
    const res = await handler(post({ password: "open-sesame" }));
    assert.equal(res.status, 503);
  });
});

test("405 on a non-POST method", async () => {
  await withEnv(CONFIGURED, async () => {
    const res = await handler(new Request("https://xplainer.app/api/keys", { method: "GET" }));
    assert.equal(res.status, 405);
  });
});

test("wrong password gets a uniform 401", async () => {
  await withEnv(CONFIGURED, async () => {
    const res = await handler(post({ password: "wrong" }));
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.error, "unauthorized");
  });
});

test("malformed body gets the SAME 401 as a wrong password (no oracle)", async () => {
  await withEnv(CONFIGURED, async () => {
    const bad = await handler(post(null, "not json at all"));
    const wrong = await handler(post({ password: "wrong" }));
    assert.equal(bad.status, wrong.status);
    assert.deepEqual(await bad.json(), await wrong.json());
  });
});

test("missing and non-string password fields get 401", async () => {
  await withEnv(CONFIGURED, async () => {
    for (const body of [{}, { password: 42 }, { password: null }, { password: "" }]) {
      const res = await handler(post(body));
      assert.equal(res.status, 401, `expected 401 for ${JSON.stringify(body)}`);
    }
  });
});

test("a password that is a prefix of the real one is rejected", async () => {
  await withEnv(CONFIGURED, async () => {
    const res = await handler(post({ password: "open" }));
    assert.equal(res.status, 401);
  });
});

test("correct password vends every configured key", async () => {
  await withEnv(CONFIGURED, async () => {
    const res = await handler(post({ password: "open-sesame" }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      anthropicKey: "sk-ant-real-anthropic",
      geminiKey: "AIzaRealGemini",
      openaiKey: "sk-real-openai",
    });
  });
});

test("unconfigured providers come back empty, not missing", async () => {
  await withEnv(
    { XPLAINER_PASSWORD: "open-sesame", XPLAINER_ANTHROPIC_KEY: "sk-ant-only" },
    async () => {
      const res = await handler(post({ password: "open-sesame" }));
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), {
        anthropicKey: "sk-ant-only",
        geminiKey: "",
        openaiKey: "",
      });
    },
  );
});

test("no response ever echoes the password back", async () => {
  await withEnv(CONFIGURED, async () => {
    for (const body of [{ password: "open-sesame" }, { password: "wrong" }, {}]) {
      const text = await (await handler(post(body))).text();
      assert.ok(!text.includes("open-sesame"), `password leaked in: ${text}`);
    }
  });
});

// ---------- rate limiting ----------

test("a caller out of budget gets 429 before the password is even checked", async () => {
  await withEnv(CONFIGURED, async () => {
    let compared = false;
    const deps: KeysDeps = {
      checkBudget: async () => ({ allowed: false, retryAfterSeconds: 900 }),
      recordFailure: async () => { compared = true; },
      clientIp: () => "1.2.3.4",
    };
    const res = await handler(post({ password: "open-sesame" }), deps);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("Retry-After"), "900");
    assert.equal(compared, false, "a throttled request must not consume the vending path");
  });
});

test("a wrong password is charged to the budget", async () => {
  await withEnv(CONFIGURED, async () => {
    const charged: string[] = [];
    const deps: KeysDeps = { ...ALLOW_ALL, recordFailure: async (ip) => { charged.push(ip); } };
    await handler(post({ password: "wrong" }), deps);
    assert.deepEqual(charged, ["1.2.3.4"]);
  });
});

test("a CORRECT password is not charged to the budget", async () => {
  // Otherwise somebody who knows the password locks themselves out by saving
  // the settings dialog a few times.
  await withEnv(CONFIGURED, async () => {
    const charged: string[] = [];
    const deps: KeysDeps = { ...ALLOW_ALL, recordFailure: async (ip) => { charged.push(ip); } };
    const res = await handler(post({ password: "open-sesame" }), deps);
    assert.equal(res.status, 200);
    assert.deepEqual(charged, []);
  });
});

test("a malformed body is charged too — it is a guess like any other", async () => {
  await withEnv(CONFIGURED, async () => {
    const charged: string[] = [];
    const deps: KeysDeps = { ...ALLOW_ALL, recordFailure: async (ip) => { charged.push(ip); } };
    await handler(post(null, "not json"), deps);
    assert.deepEqual(charged, ["1.2.3.4"]);
  });
});

test("the client IP comes from the platform header, never a spoofable one", async () => {
  const { defaultClientIp } = await import("../netlify/functions/keys.mts");
  const req = new Request("https://xplainer.app/api/keys", {
    method: "POST",
    headers: { "x-nf-client-connection-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" },
  });
  assert.equal(defaultClientIp(req), "9.9.9.9");
  const spoofOnly = new Request("https://xplainer.app/api/keys", {
    method: "POST",
    headers: { "x-forwarded-for": "1.1.1.1" },
  });
  assert.equal(defaultClientIp(spoofOnly), "", "x-forwarded-for is client-controlled and must be ignored");
});
