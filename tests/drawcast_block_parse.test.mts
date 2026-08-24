// tests/drawcast_block_parse.test.mts
// Run: node --test tests/drawcast_block_parse.test.mts
//
// The parser keeps a ::: block's type + raw body ONLY when a handler is
// registered (registry passthrough); otherwise it degrades to write_speak.
// These tests pin both behaviours and that YAML indentation survives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadParser(registered: string[]) {
  const src = readFileSync(new URL("../src/explain_parser.js", import.meta.url), "utf8");
  const sandbox: Record<string, unknown> = {
    console,
    Xplainer: { actions: { has: (n: string) => registered.includes(n) } },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "explain_parser.js" });
  return (sandbox as { parseLectureText: (t: string) => { commands: Record<string, unknown>[] } }).parseLectureText;
}

const LECTURE = [
  '::: drawcast(request="supply and demand, with a shift", size=520)',
  "title: Demand",
  "template: supply_demand",
  "params:",
  "  demand: { label: D }",
  "commands:",
  "  - draw: [axes]",
  '    speak: "Price on the vertical axis."',
  "::: write",
  "Done.",
].join("\n");

test("registered drawcast block keeps type, args, and indented YAML body", () => {
  const parse = loadParser(["drawcast"]);
  const { commands } = parse(LECTURE);
  assert.equal(commands[0].type, "drawcast");
  assert.equal(commands[0].request, "supply and demand, with a shift");
  assert.equal(commands[0].size, 520);
  assert.ok(String(commands[0].content).includes("  demand: { label: D }"));
  assert.ok(String(commands[0].content).includes('    speak: "Price on the vertical axis."'));
  assert.equal(commands[1].type, "write");
});

test("without a registered handler the block degrades to write_speak (the trap this feature depends on)", () => {
  const parse = loadParser([]);
  const { commands } = parse(LECTURE);
  assert.equal(commands[0].type, "write_speak");
});
