// Tests for the key-vending function (netlify/functions/keys.mts).
// Run: node --test tests/keys_vending.test.mts
//
// The handler reads process.env at request time, so each test sets the vars
// it needs and restores them afterwards.
import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../netlify/functions/keys.mts";

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
