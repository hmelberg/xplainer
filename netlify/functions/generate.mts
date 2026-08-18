// Streaming AI generation via the Netlify AI Gateway.
// The browser POSTs {provider, model, system, user}; we stream back plain
// text tokens. Gateway credentials are auto-injected by Netlify — the SDKs
// are constructed bare and must NOT be given keys or base URLs here.
import type { Config, Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";

// Only the curated models — this endpoint must not be an open proxy.
const ALLOWED: Record<string, string[]> = {
  anthropic: ["claude-sonnet-4-6"],
  openai: ["gpt-5-mini"],
  gemini: ["gemini-2.5-flash"],
};

const MAX_TOKENS = 8192;
const RATE_LIMIT = 10; // requests per IP per hour, best-effort (per instance)
const RATE_WINDOW_MS = 60 * 60 * 1000;
const hits = new Map<string, number[]>();

function allow(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  return true;
}

async function* anthropicDeltas(model: string, system: string, user: string) {
  const client = new Anthropic();
  const stream = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: user }],
    stream: true,
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}

async function* openaiDeltas(model: string, system: string, user: string) {
  const client = new OpenAI();
  const stream = await client.chat.completions.create({
    model,
    max_completion_tokens: MAX_TOKENS,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    stream: true,
  });
  for await (const chunk of stream) {
    const text = chunk.choices?.[0]?.delta?.content;
    if (text) yield text;
  }
}

async function* geminiDeltas(model: string, system: string, user: string) {
  const ai = new GoogleGenAI({});
  const stream = await ai.models.generateContentStream({
    model,
    contents: user,
    config: { systemInstruction: system, maxOutputTokens: MAX_TOKENS },
  });
  for await (const chunk of stream) {
    if (chunk.text) yield chunk.text;
  }
}

export default async (req: Request, context: Context) => {
  if (!allow(context.ip || "unknown")) {
    return Response.json(
      { error: "Rate limit reached — try again later, or use your own API key (⚙ in the editor)." },
      { status: 429 },
    );
  }

  let body: { provider?: string; model?: string; system?: string; user?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { provider, model, system, user } = body;
  if (!provider || !model || !system || !user) {
    return Response.json({ error: "Required: provider, model, system, user." }, { status: 400 });
  }
  if (!ALLOWED[provider]?.includes(model)) {
    return Response.json({ error: `Model not allowed: ${provider}/${model}` }, { status: 400 });
  }

  const deltas =
    provider === "anthropic"
      ? anthropicDeltas(model, system, user)
      : provider === "openai"
        ? openaiDeltas(model, system, user)
        : geminiDeltas(model, system, user);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const text of deltas) {
          controller.enqueue(encoder.encode(text));
        }
        controller.close();
      } catch (err) {
        // Mid-stream failure: append a visible marker so the client can
        // tell a truncated result from a completed one.
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`\n\n[generation error: ${msg}]`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
};

export const config: Config = {
  path: "/api/generate",
  method: "POST",
};
