// Tests for the client half of password redemption (src/explain_ai.js).
// Run: node --test tests/ai_password_client.test.mts
//
// explain_ai.js is a browser IIFE, so it is evaluated in a vm sandbox with
// just enough DOM for its top level to run. init() bails out immediately
// because getElementById returns null (no editor pane), which leaves only the
// pure helpers it exposes on `window.XplainerAI`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

type Call = { url: string; body: unknown };

/** Copy a vm-realm object into this realm — deepStrictEqual compares prototypes. */
function plain<T>(value: T): T {
  return value && typeof value === "object" ? ({ ...value } as T) : value;
}

function loadAi(fetchImpl?: (url: string, init: RequestInit) => Promise<unknown>) {
  const src = readFileSync(new URL("../src/explain_ai.js", import.meta.url), "utf8");
  const store: Record<string, string> = {};
  const sandbox: Record<string, unknown> = {
    console,
    URL, // a Node global, not a vm-context built-in
    fetch: fetchImpl,
    localStorage: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    },
    document: {
      currentScript: { src: "https://xplainer.app/src/explain_ai.js" },
      readyState: "complete",
      getElementById: () => null,
      querySelector: () => null,
      addEventListener: () => {},
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "explain_ai.js" });
  const api = (sandbox.window as Record<string, unknown>).XplainerAI;
  assert.ok(api, "explain_ai.js should expose window.XplainerAI");
  return api as {
    looksLikeKey: (provider: string, text: string) => boolean;
    redeemPassword: (candidates: string[]) => Promise<Record<string, string> | null>;
    mergeVended: (
      entered: Record<string, string>,
      candidates: string[],
      vended: Record<string, string> | null,
    ) => Record<string, string>;
    speechVended: (
      prev: Record<string, string>,
      prevFlag: boolean | undefined,
      next: Record<string, string>,
      vended: Record<string, string> | null,
    ) => boolean;
  };
}

function fakeFetch(responder: (body: unknown) => { ok: boolean; json?: unknown } | Error) {
  const calls: Call[] = [];
  const impl = async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body });
    const out = responder(body);
    if (out instanceof Error) throw out;
    return { ok: out.ok, json: async () => out.json };
  };
  return { impl, calls };
}

// ---------- looksLikeKey ----------

test("real provider keys are recognised, arbitrary text is not", () => {
  const { looksLikeKey } = loadAi();
  assert.equal(looksLikeKey("anthropic", "sk-ant-api03-abc"), true);
  assert.equal(looksLikeKey("gemini", "AIzaSyAbc123"), true);
  assert.equal(looksLikeKey("openai", "sk-proj-abc"), true);
  assert.equal(looksLikeKey("speech", "AIzaSyAbc123"), true);
  for (const p of ["anthropic", "gemini", "openai", "speech"]) {
    assert.equal(looksLikeKey(p, "min-hemmelighet"), false, `${p} should not accept a password`);
  }
});

test("a key in the wrong field is still treated as a key, not a password", () => {
  const { looksLikeKey } = loadAi();
  // sk-ant-… starts with sk-, so it reads as an OpenAI-shaped key: wrong
  // field, but never sent to the vending endpoint as a password.
  assert.equal(looksLikeKey("openai", "sk-ant-api03-abc"), true);
});

// ---------- redeemPassword ----------

test("redeeming posts the password and maps the vended keys", async () => {
  const { impl, calls } = fakeFetch(() => ({
    ok: true,
    json: { anthropicKey: "sk-ant-real", geminiKey: "AIzaReal", openaiKey: "sk-real" },
  }));
  const { redeemPassword } = loadAi(impl);
  const vended = await redeemPassword(["hemmelig"]);
  assert.deepEqual(plain(vended), { anthropic: "sk-ant-real", gemini: "AIzaReal", openai: "sk-real", speech: "" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/keys");
  assert.deepEqual(plain(calls[0].body), { password: "hemmelig" });
});

test("a rejected password yields null", async () => {
  const { impl } = fakeFetch(() => ({ ok: false }));
  const { redeemPassword } = loadAi(impl);
  assert.equal(await redeemPassword(["wrong"]), null);
});

test("a network failure yields null rather than throwing", async () => {
  const { impl } = fakeFetch(() => new Error("offline"));
  const { redeemPassword } = loadAi(impl);
  assert.equal(await redeemPassword(["hemmelig"]), null);
});

test("a 200 that vends nothing usable yields null", async () => {
  const { impl } = fakeFetch(() => ({ ok: true, json: { anthropicKey: "", geminiKey: "", openaiKey: "", speechKey: "" } }));
  const { redeemPassword } = loadAi(impl);
  assert.equal(await redeemPassword(["hemmelig"]), null);
});

test("candidates are tried in order and stop at the first success", async () => {
  const { impl, calls } = fakeFetch((body) => {
    const password = (body as { password: string }).password;
    return password === "right" ? { ok: true, json: { anthropicKey: "sk-ant-real" } } : { ok: false };
  });
  const { redeemPassword } = loadAi(impl);
  const vended = await redeemPassword(["nope", "right", "never-tried"]);
  assert.deepEqual(plain(vended), { anthropic: "sk-ant-real", gemini: "", openai: "", speech: "" });
  assert.deepEqual(calls.map((c) => (c.body as { password: string }).password), ["nope", "right"]);
});

test("no candidates means no request at all", async () => {
  const { impl, calls } = fakeFetch(() => ({ ok: true, json: { anthropicKey: "sk-ant-real" } }));
  const { redeemPassword } = loadAi(impl);
  assert.equal(await redeemPassword([]), null);
  assert.equal(calls.length, 0);
});

// ---------- mergeVended ----------

test("a redeemed password is replaced by the keys and never stored", () => {
  const { mergeVended } = loadAi();
  const entered = { anthropic: "hemmelig", gemini: "", openai: "" };
  const next = mergeVended(entered, ["hemmelig"], {
    anthropic: "sk-ant-real",
    gemini: "AIzaReal",
    openai: "sk-real",
  });
  assert.deepEqual(plain(next), { anthropic: "sk-ant-real", gemini: "AIzaReal", openai: "sk-real", speech: "" });
  assert.ok(!JSON.stringify(next).includes("hemmelig"));
});

test("a real key the user typed survives redemption of another field", () => {
  const { mergeVended } = loadAi();
  const entered = { anthropic: "sk-ant-mine", gemini: "hemmelig", openai: "" };
  const next = mergeVended(entered, ["hemmelig"], { anthropic: "", gemini: "AIzaReal", openai: "" });
  assert.equal(next.anthropic, "sk-ant-mine", "the user's own key must not be clobbered by an empty vend");
  assert.equal(next.gemini, "AIzaReal");
});

test("providers the server did not vend are left empty, not left holding the password", () => {
  const { mergeVended } = loadAi();
  const entered = { anthropic: "hemmelig", gemini: "", openai: "" };
  const next = mergeVended(entered, ["hemmelig"], { anthropic: "sk-ant-real", gemini: "", openai: "" });
  assert.deepEqual(plain(next), { anthropic: "sk-ant-real", gemini: "", openai: "", speech: "" });
});

test("a speech-only vend (the speech password) counts as usable", async () => {
  const { impl } = fakeFetch(() => ({
    ok: true,
    json: { anthropicKey: "", geminiKey: "", openaiKey: "", speechKey: "AIzaRealSpeech" },
  }));
  const { redeemPassword } = loadAi(impl);
  const vended = await redeemPassword(["tale-passord"]);
  assert.deepEqual(plain(vended), { anthropic: "", gemini: "", openai: "", speech: "AIzaRealSpeech" });
});

test("a speech password entered in the speech field is replaced by the key", () => {
  const { mergeVended } = loadAi();
  const entered = { anthropic: "", gemini: "", openai: "", speech: "tale-passord" };
  const next = mergeVended(entered, ["tale-passord"], {
    anthropic: "",
    gemini: "",
    openai: "",
    speech: "AIzaRealSpeech",
  });
  assert.deepEqual(plain(next), { anthropic: "", gemini: "", openai: "", speech: "AIzaRealSpeech" });
  assert.ok(!JSON.stringify(next).includes("tale-passord"));
});

test("the vended-speech flag: set by a vend, kept while untouched, dropped for the user's own key", () => {
  const { speechVended } = loadAi();
  const K = "AIzaVendedSpeech";
  // a vend that fills the speech field marks the key as shared
  assert.equal(speechVended({ speech: "" }, false, { speech: K }, { speech: K }), true);
  // re-saving other fields with the stored key untouched keeps the flag
  assert.equal(speechVended({ speech: K }, true, { speech: K }, null), true);
  // the user's own pasted key is never budgeted
  assert.equal(speechVended({ speech: K }, true, { speech: "AIzaMyOwnKey" }, null), false);
  // clearing the field clears the flag
  assert.equal(speechVended({ speech: K }, true, { speech: "" }, null), false);
});

test("when redemption fails the text is kept exactly as entered", () => {
  const { mergeVended } = loadAi();
  const entered = { anthropic: "whatever-this-is", gemini: "", openai: "sk-mine" };
  assert.deepEqual(plain(mergeVended(entered, ["whatever-this-is"], null)), { ...entered, speech: "" });
});
