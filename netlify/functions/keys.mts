// Key vending: exchanges a shared password for the real provider API keys,
// so people you trust can use the AI features without a key of their own.
//
// Secrets live ONLY in Netlify env vars (never in the repo, never bundled):
//   XPLAINER_PASSWORD       — the shared password
//   XPLAINER_ANTHROPIC_KEY  — vended on success (any subset may be set)
//   XPLAINER_GEMINI_KEY     — vended on success
//   XPLAINER_OPENAI_KEY     — vended on success
//
// The names are deliberately NOT the provider defaults. The Netlify AI
// Gateway injects ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY plus
// matching *_BASE_URL vars into functions at runtime; setting our own values
// under those names would pair a real key with the gateway's base URL and
// break /api/generate. Distinct names keep the two paths independent.
//
// Wrong password and malformed request return the SAME 401 — nothing here
// tells a prober how close they got, not even the password's length.
import type { Config } from "@netlify/functions";
import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time equality via digest comparison (also hides length). */
function passwordMatches(supplied: string, expected: string): boolean {
  const a = createHash("sha256").update(supplied, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export default async (req: Request): Promise<Response> => {
  const headers = { "content-type": "application/json", "Cache-Control": "no-store" };
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method" }), { status: 405, headers });
  }

  const expected = process.env.XPLAINER_PASSWORD;
  const anthropicKey = process.env.XPLAINER_ANTHROPIC_KEY ?? "";
  const geminiKey = process.env.XPLAINER_GEMINI_KEY ?? "";
  const openaiKey = process.env.XPLAINER_OPENAI_KEY ?? "";

  // Vending is off unless there is both a password and something to vend.
  if (!expected || !(anthropicKey || geminiKey || openaiKey)) {
    return new Response(JSON.stringify({ error: "vending disabled" }), { status: 503, headers });
  }

  let password = "";
  try {
    const body = (await req.json()) as { password?: unknown };
    if (typeof body?.password === "string") password = body.password;
  } catch {
    /* falls through to the uniform 401 below */
  }

  if (!password || !passwordMatches(password, expected)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  }

  return new Response(JSON.stringify({ anthropicKey, geminiKey, openaiKey }), { status: 200, headers });
};

export const config: Config = {
  path: "/api/keys",
  // Without this the shared password can be guessed at line speed. Netlify
  // enforces the limit at the edge, before the function runs, and across all
  // instances — unlike an in-process counter, which resets on every cold
  // start. Deliberately generous: a save tries at most one candidate per
  // filled field, so 30/hour is roughly ten honest attempts, while leaving a
  // brute-forcer ~720 guesses a day against a long password.
  rateLimit: {
    windowSize: 60 * 60,
    windowLimit: 30,
    aggregateBy: "ip",
    action: "rate_limit",
  },
};
