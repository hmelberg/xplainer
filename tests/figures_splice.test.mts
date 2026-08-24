// tests/figures_splice.test.mts
// Run: node --test tests/figures_splice.test.mts
// explain_figures.js is a browser IIFE — vm-sandboxed like explain_ai.js.
// (vm realm trap: copy objects with spread before deepStrictEqual.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadFigures() {
  const src = readFileSync(new URL("../src/explain_figures.js", import.meta.url), "utf8");
  const sandbox: Record<string, unknown> = {
    console,
    URL, // Node global, not a vm built-in — must be injected
    document: { currentScript: { src: "https://xplainer.app/src/explain_figures.js" } },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "explain_figures.js" });
  return (sandbox as { XplainerFigures: Record<string, CallableFunction> }).XplainerFigures;
}

const DOC = [
  "::: write_speak",
  "Intro.",
  '::: drawcast(request="a market diagram", size=520)',
  "",
  '::: drawcast(request="a decision tree")',
  "::: drawcast(size=300)",
  "title: already filled",
  "commands: []",
  "::: write",
  "End.",
].join("\n");

test("findPlaceholders: only empty-bodied blocks WITH a request", () => {
  const fig = loadFigures();
  const found = fig.findPlaceholders(DOC) as { request: string }[];
  assert.equal(found.length, 2);
  assert.equal(found[0].request, "a market diagram");
  assert.equal(found[1].request, "a decision tree");
});

test("fillBody replaces exactly the empty body and preserves the rest", () => {
  const fig = loadFigures();
  const [p] = fig.findPlaceholders(DOC) as [{ request: string }];
  const out = fig.fillBody(DOC, p, "title: Market\ncommands: []") as string;
  assert.ok(out.includes('::: drawcast(request="a market diagram", size=520)\ntitle: Market\ncommands: []\n::: drawcast(request="a decision tree")'));
  assert.ok(out.includes("title: already filled"));
  assert.ok(out.endsWith("::: write\nEnd."));
});

test("compileAllWith fills all placeholders, comments failures, never rejects", async () => {
  const fig = loadFigures();
  const compiler = {
    compileFigure: (request: string) =>
      request.includes("decision")
        ? Promise.reject(new Error("api down"))
        : Promise.resolve({ yaml: "title: OK\ncommands: []", error: undefined }),
  };
  const progress: number[] = [];
  const result = (await fig.compileAllWith(compiler, DOC, {
    apiKey: "k",
    onProgress: (done: number) => progress.push(done),
  })) as { text: string; compiled: number; failed: number };
  assert.equal(result.compiled, 1);
  assert.equal(result.failed, 1);
  assert.ok(result.text.includes("title: OK"));
  assert.ok(result.text.includes("# drawing generation failed: api down"));
  assert.equal((fig.findPlaceholders(result.text) as unknown[]).length, 0); // both consumed
  assert.deepEqual([...progress], [0, 1]);
});
