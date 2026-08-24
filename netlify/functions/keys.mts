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
// tells a prober how close they got, not even the password's length — and
// both are charged to a per-IP failure budget so the password cannot be
// guessed at line speed.
import type { Config } from "@netlify/functions";
import { createHash, timingSafeEqual } from "node:crypto";
import { checkFailureBudget, recordFailure } from "../lib/rate-limit.mts";

/** Injected so the vending logic and the limiter can be tested apart. */
export interface KeysDeps {
  checkBudget: (id: string) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  recordFailure: (id: string) => Promise<void>;
  clientIp: (req: Request) => string;
}

/**
 * Netlify sets x-nf-client-connection-ip itself and a client cannot forge it.
 * x-forwarded-for CAN be forged, so it is deliberately not a fallback —
 * honouring it would let one attacker rotate through fake IPs to dodge the
 * budget entirely.
 */
export function defaultClientIp(req: Request): string {
  return req.headers.get("x-nf-client-connection-ip") ?? "";
}

/** Constant-time equality via digest comparison (also hides length). */
function passwordMatches(supplied: string, expected: string): boolean {
  const a = createHash("sha256").update(supplied, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export async function handleKeysRequest(req: Request, deps: KeysDeps): Promise<Response> {
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

  // Budget check first: a throttled caller never reaches the comparison.
  const ip = deps.clientIp(req);
  const budget = await deps.checkBudget(ip);
  if (!budget.allowed) {
    return new Response(JSON.stringify({ error: "rate limited" }), {
      status: 429,
      headers: { ...headers, "Retry-After": String(budget.retryAfterSeconds) },
    });
  }

  let password = "";
  try {
    const body = (await req.json()) as { password?: unknown };
    if (typeof body?.password === "string") password = body.password;
  } catch {
    /* falls through to the uniform 401 below */
  }

  if (!password || !passwordMatches(password, expected)) {
    // Only failures are charged, so knowing the password never locks you out.
    await deps.recordFailure(ip);
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  }

  return new Response(JSON.stringify({ anthropicKey, geminiKey, openaiKey }), { status: 200, headers });
}

export default async (req: Request): Promise<Response> =>
  handleKeysRequest(req, {
    checkBudget: (id) => checkFailureBudget(id),
    recordFailure: (id) => recordFailure(id),
    clientIp: defaultClientIp,
  });

export const config: Config = {
  path: "/api/keys",
};
