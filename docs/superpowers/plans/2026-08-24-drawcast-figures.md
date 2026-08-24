# Drawcast Figures in Xplainer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drawcast-quality animated, narrated figures inside xplainer lectures — a `:::drawcast` block rendering drawcast YAML specs, plus two-stage AI generation that compiles `request="…"` placeholders into full specs.

**Architecture:** The drawcast repo gains a second Vite build (`dist-engine/`: `engine.js` for rendering + the `<drawcast-figure>` element, `compiler.js` for the request→spec pipeline). Xplainer vendors those built files into `vendor/drawcast/` and adds one new action handler plus a stage-2 compile module; the 8,900-line monolith is not touched. Narration flows through xplainer's single TTS pipeline via a structural `SpeechLike` adapter.

**Tech Stack:** drawcast: TypeScript + Vite 6 + vitest (`npm test` = `vitest run`). xplainer: no build step, classic `<script>` IIFEs, tests via `node --test tests/<file>.test.mts` (Node 26 strips types) and `python3 tests/prompt_block_drift.py`.

**Spec:** `docs/superpowers/specs/2026-08-24-drawcast-figures-design.md` (this repo). Read it first.

## Global Constraints

- Two repos: `/Users/hom/Documents/GitHub/drawcast` (Tasks 1–5) and `/Users/hom/Documents/GitHub/xplainer` (Tasks 6–10). Both sit on `main`; verify with `git branch --show-current` before the first commit in each (a push from another branch is a silent no-op).
- drawcast engine entries must NEVER import `src/main.ts`, `src/ui/*`, `src/store.ts`, or `src/export/*`. The Anthropic SDK may appear ONLY in the compiler entry's import graph.
- The custom element tag is `drawcast-figure` (xplainer already defines an unrelated `ui-drawcast`). Its style attribute is `look="sketchy|clean"` — `style` is the HTML style attribute and cannot be used.
- The xplainer block is `:::drawcast` with header args `request`, `size`, `style` (here `style` is fine — block args are parsed by xplainer, not HTML), `speed`, `location`. Body = YAML at column 0.
- Cache-busting: `index.html` loads `explain_ai.js?v=4` today — any edit to that file bumps it to `?v=5` (once; Tasks 8 and 9 both edit it, the bump happens in Task 8). New files need no `?v`. Handler scripts carry no `?v` (existing trap: hard-reload when verifying in Chrome).
- Figure compilation model: drawcast's `DEFAULT_MODEL` (`claude-opus-5`); repairs downshift via `repairModelFor` automatically. Anthropic-only (BYOK or vended key from localStorage `xplainer_ai_keys`).
- Known limitation, accepted (spec correction): "Save as app" HTML loads only parser+defaults+player — no `core.js`, no handlers — so ALL registry blocks (mermaid, p5, celebrate, and now drawcast) degrade to spoken text there today. Not fixed in this round.
- Out of scope: gateway proxy for figure compilation, `molecule_3d`/3Dmol in xplainer, playlists, shadow DOM, save-as-app handler support.
- Commit at the end of every task. Push drawcast at Task 5; push xplainer after each xplainer task (a push IS a deploy to xplainer.melberg.app — that is expected and fine, the feature is inert until a lecture uses it).

---

### Task 1: drawcast — `excludeIds` in the template catalog

**Files:**
- Modify: `src/scenes/catalog.ts` (CatalogOpts at line 41, catalogParts at line 147)
- Modify: `src/llm/compile.ts` (GenerateConfig at line 64; catalogParts call sites at lines 183 and 233)
- Test: `tests/catalog_exclude.test.ts` (new)

**Interfaces:**
- Consumes: existing `catalogParts(opts)`, `catalogText(opts)`, `scenes` registry.
- Produces: `CatalogOpts.excludeIds?: string[]` and `GenerateConfig.excludeIds?: string[]` — Task 5's `compileFigure` passes `excludeIds: ["molecule_3d"]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/catalog_exclude.test.ts
import { describe, expect, it } from "vitest";
import { catalogText } from "../src/scenes/catalog";

describe("catalog excludeIds", () => {
  it("omits an excluded template from the catalog text", () => {
    expect(catalogText({})).toContain("molecule_3d");
    expect(catalogText({ excludeIds: ["molecule_3d"] })).not.toContain("molecule_3d");
  });

  it("does not grant a forced full entry to an excluded template", () => {
    const text = catalogText({ forced: "molecule_3d", excludeIds: ["molecule_3d"] });
    expect(text).not.toContain('You MUST set "template" to "molecule_3d"');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/hom/Documents/GitHub/drawcast && npx vitest run tests/catalog_exclude.test.ts`
Expected: FAIL — the excluded catalog still contains `molecule_3d` (the option doesn't exist yet, and TS may error on the unknown property; both count as the failing state).

- [ ] **Step 3: Implement**

In `src/scenes/catalog.ts`, extend `CatalogOpts`:

```ts
export interface CatalogOpts {
  request?: string;
  forced?: string;
  priorityIds?: string[];
  /** Template ids to hide from the catalog entirely (host embeds exclude e.g. molecule_3d). */
  excludeIds?: string[];
}
```

In `catalogParts`, filter at the source and at the two id-lookup spots that bypass `entries`:

```ts
export function catalogParts(opts: CatalogOpts = {}): { stable: string; variable: string } {
  const excluded = new Set(opts.excludeIds ?? []);
  const entries = Object.values(scenes).filter((s) => !excluded.has(s.manifest.name));
  const ready = entries.filter((s) => s.manifest.status === "ready");

  if (opts.forced && !excluded.has(opts.forced)) {
    // ...existing forced body unchanged...
```

(The old first two lines — `const entries = Object.values(scenes);` and the plain `if (opts.forced)` — are replaced; everything inside the forced branch stays.) Then in the `stableIds` filter add the exclusion:

```ts
  const stableIds = dedupe([...(opts.forced ? [opts.forced] : []), ...(opts.priorityIds ?? []), ...CORE_IDS]).filter(
    (id) => scenes[id]?.manifest.status === "ready" && !excluded.has(id),
  );
```

and in the `shortlist` filter:

```ts
  const shortlist = selectTemplates(opts.request ?? "", 3).filter(
    (id) => scenes[id]?.manifest.status === "ready" && !stableIds.includes(id) && !excluded.has(id),
  );
```

In `src/llm/compile.ts`, add to `GenerateConfig` (after `priorityIds`):

```ts
  /** Template ids to hide from the catalog entirely (host embeds exclude e.g. molecule_3d). */
  excludeIds?: string[];
```

and thread it through BOTH `catalogParts` calls — line 183:

```ts
  let catalog = catalogParts({ request, forced: cfg.forcedTemplate, priorityIds: cfg.priorityIds, excludeIds: cfg.excludeIds });
```

and the escalation rebuild at line 233:

```ts
        catalog = catalogParts({ forced: needed, excludeIds: cfg.excludeIds });
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/catalog_exclude.test.ts` → PASS, then the full suite `npm test` → all ~536 green.

- [ ] **Step 5: Commit**

```bash
git add src/scenes/catalog.ts src/llm/compile.ts tests/catalog_exclude.test.ts
git commit -m "feat: catalog/GenerateConfig excludeIds so host embeds can hide templates"
```

---

### Task 2: drawcast — structural `SpeechLike` contract

**Files:**
- Modify: `src/render/speech.ts` (add interface above `SpeechManager`)
- Modify: `src/render/player.ts` (lines 38, 75: type `SpeechManager` → `SpeechLike`)
- Modify: `src/render/index.ts` (line 20: `RenderOptions.speech?: SpeechLike`)

**Interfaces:**
- Produces: `export interface SpeechLike` in `src/render/speech.ts` — the exact members `Player` calls (verified by grep: only `speak`, `cancel`, `pause`, `resume`). `SpeechManager` (and its subclasses `CloudSpeech`, `BufferSpeech`) satisfy it structurally; xplainer's handler passes a plain-object adapter.

- [ ] **Step 1: Add the interface** (no failing test first — this is a type-level change; the compiler is the test)

In `src/render/speech.ts`, above `export class SpeechManager`:

```ts
/**
 * The structural contract the Player needs from narration (speak/cancel/
 * pause/resume). SpeechManager and its subclasses satisfy it; host apps
 * embedding the engine (xplainer) pass their own adapter so exactly one TTS
 * pipeline is authoritative.
 */
export interface SpeechLike {
  /** Speak one utterance; resolves when it ends (or its fallback wait does). */
  speak(text: string, speedMultiplier: number, signal?: AbortSignal): Promise<void>;
  cancel(): void;
  pause(): void;
  resume(): void;
}
```

- [ ] **Step 2: Loosen the consumers**

`src/render/player.ts`: change the import to `import { SpeechManager, type SpeechLike } from "./speech"` (keep `SpeechManager` only if still referenced; if not, import just the type) and change line 38 `private speech: SpeechManager;` and the constructor param (line 75) to `SpeechLike`.

`src/render/index.ts`: in `RenderOptions`, change `speech?: SpeechManager;` to `speech?: SpeechLike;` and add `type SpeechLike` to the import from `./speech` (the `new SpeechManager()` default at line 106 stays).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: clean compile, all tests green (`playlist/session.ts` still types its option as `SpeechManager`, which assigns to `SpeechLike` fine).

- [ ] **Step 4: Commit**

```bash
git add src/render/speech.ts src/render/player.ts src/render/index.ts
git commit -m "refactor: Player narration contract is structural (SpeechLike) for host adapters"
```

---

### Task 3: drawcast — self-injecting figure styles (single source)

**Files:**
- Create: `src/render/figure-style.ts`
- Modify: `src/render/index.ts` (call `ensureFigureStyles()` at the top of `render()`)
- Modify: `src/styles.css` (DELETE the five base rules now owned by the module: `.cs-stage` block, `.cs-svg` line, `.cs-caption` block, `.cs-caption-empty` line — all at ~lines 568–590 — and the `.cs-title` block at ~lines 951–960. KEEP everything else: `.cs-bigplay`, `.cs-controlbar`, `.cs-bar-*`, `.cs-progress*`, `.cs-waitgate*`, all `:fullscreen` overrides, `.cs-figure.cs-idle` rules.)

**Interfaces:**
- Produces: `ensureFigureStyles(): void` — idempotent, no-op outside a DOM. Called by `render()`, so both the drawcast app and any embed get the rules with no stylesheet.

- [ ] **Step 1: Create `src/render/figure-style.ts`**

```ts
// The figure's own look (.cs-stage/.cs-svg/.cs-caption/.cs-title), injected
// as a <style> tag by render() — a host page needs no stylesheet for figures
// to look right. Single source: styles.css no longer carries these base
// rules (it keeps only app chrome and overrides like :fullscreen sizes).
// The var() fallbacks are the app's own :root values, so the rules are
// self-contained outside drawcast while the app's variables still win inside.
const FIGURE_CSS = `
.cs-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  background: #fffefb;
  border: 1px solid #eee8da;
  border-radius: 4px;
  overflow: hidden;
}
.cs-svg { width: 100%; height: 100%; display: block; }
.cs-caption {
  min-height: 3.1rem;
  padding: 0.35rem 0.8rem 0.15rem;
  font-family: var(--sketch-font, "Patrick Hand", "Segoe Print", "Comic Sans MS", cursive);
  font-size: 1.15rem;
  line-height: 1.3;
  text-align: center;
  color: var(--ink, #3d3833);
}
.cs-caption-empty::before { content: "\\00a0"; }
.cs-title {
  font-family: var(--sketch-font, "Patrick Hand", "Segoe Print", "Comic Sans MS", cursive);
  font-size: 1.3rem;
  color: var(--ink, #3d3833);
  text-align: center;
  width: fit-content;
  padding: 0 0.4rem;
  margin: 0.05rem auto 0.1rem;
  max-width: 90%;
}
`;

let injected = false;

export function ensureFigureStyles(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const style = document.createElement("style");
  style.dataset.drawcastFigureStyles = "";
  style.textContent = FIGURE_CSS;
  document.head.appendChild(style);
}
```

(Note the `\\00a0` — it must land as `\00a0` in the CSS text, so it is escaped once inside the TS template literal.)

- [ ] **Step 2: Wire and deduplicate**

In `src/render/index.ts`: `import { ensureFigureStyles } from "./figure-style";` and make the first line of `render()`'s body (before `await ensureFonts()`) `ensureFigureStyles();`. Then delete the five base rules from `src/styles.css` as listed above — verify with `grep -n "^\.cs-stage\|^\.cs-svg\|^\.cs-caption\|^\.cs-title" src/styles.css` that no base definitions remain (compound selectors like `.cs-stage.is-playing` and `:fullscreen` variants DO remain).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all green. Then a 30-second visual check: `npm run dev`, open the app, render any library figure — stage border, caption strip, and title must look unchanged (the injected tag `style[data-drawcast-figure-styles]` visible in devtools).

- [ ] **Step 4: Commit**

```bash
git add src/render/figure-style.ts src/render/index.ts src/styles.css
git commit -m "refactor: figure base styles self-inject from render() (embed-proof, single source)"
```

---

### Task 4: drawcast — embed render wrapper + `<drawcast-figure>` element

**Files:**
- Create: `src/engine-render.ts`
- Create: `src/engine-element.ts`
- Test: `tests/engine_element_attrs.test.ts` (new)

**Interfaces:**
- Consumes: `render` from `./render`, `parseSpecText` from `./spec/text`, `validateSpec` from `./spec/schema`, `PACK_DEFS`/`ensureEnabledPacks` from `./scenes/packs`, `ensureEnginesForTemplate` from `./scenes/engines`.
- Produces (used by Task 5's entries and by xplainer's handler):
  - `render(spec, container, options) → Promise<RenderHandle>` — same contract as core render, but packs and template engines are ensured first.
  - `loadSpecText(text) → Promise<{ spec: Spec; errors: string[] }>` — packs ensured, then parse (throws with a readable message on unparseable text) and validate (`errors` non-empty on an invalid spec).
  - `parseFigureAttrs(get) → FigureAttrs`, `DrawcastFigure`, `defineDrawcastFigure()`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine_element_attrs.test.ts
import { describe, expect, it } from "vitest";
import { parseFigureAttrs } from "../src/engine-element";

const attrs = (map: Record<string, string>) => parseFigureAttrs((n) => (n in map ? map[n] : null));

describe("drawcast-figure attribute parsing", () => {
  it("defaults to sketchy / narrated / speed 1 / no autoplay", () => {
    expect(attrs({})).toEqual({ look: "sketchy", mode: "narrated", speed: 1, autoplay: false });
  });
  it("honours explicit values and treats bare autoplay as true", () => {
    expect(attrs({ look: "clean", mode: "instant", speed: "1.5", autoplay: "" })).toEqual({
      look: "clean", mode: "instant", speed: 1.5, autoplay: true,
    });
  });
  it("falls back on junk values", () => {
    expect(attrs({ look: "neon", mode: "fast", speed: "quick" })).toEqual({
      look: "sketchy", mode: "narrated", speed: 1, autoplay: false,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/engine_element_attrs.test.ts` → FAIL (module does not exist).

- [ ] **Step 3: Create `src/engine-render.ts`**

```ts
// render()/loadSpecText() for embedders: same contracts as src/render and
// src/spec, plus the default packs' templates and any template engines are
// registered first — the drawcast app does that in main.ts; an embedded
// engine must do it itself. Validation therefore always sees pack templates.
import { render as coreRender, type RenderHandle, type RenderOptions } from "./render";
import { validateSpec } from "./spec/schema";
import { parseSpecText } from "./spec/text";
import type { Spec } from "./spec/types";
import { ensureEnginesForTemplate } from "./scenes/engines";
import { PACK_DEFS, ensureEnabledPacks } from "./scenes/packs";

let packsReady: Promise<unknown> | null = null;
function ensurePacks(): Promise<unknown> {
  packsReady ??= ensureEnabledPacks(Object.keys(PACK_DEFS));
  return packsReady;
}

export async function loadSpecText(text: string): Promise<{ spec: Spec; errors: string[] }> {
  await ensurePacks();
  const { value } = parseSpecText(text);
  const v = validateSpec(value);
  return { spec: value as Spec, errors: v.ok ? [] : v.errors };
}

export async function render(spec: Spec, container: HTMLElement, options: RenderOptions = {}): Promise<RenderHandle> {
  await ensurePacks();
  if (spec.template) await ensureEnginesForTemplate(spec.template);
  return coreRender(spec, container, options);
}
```

- [ ] **Step 4: Create `src/engine-element.ts`**

```ts
// <drawcast-figure> — declarative wrapper around the embed render(). Light
// DOM on purpose: the injected .cs-* styles are namespaced, and light DOM
// keeps document-level fonts working. The spec is the element's text content:
//
//   <drawcast-figure look="clean" mode="silent" speed="1.5" autoplay>
//     title: Demand increase
//     template: supply_demand
//     ...
//   </drawcast-figure>
//
// "look", not "style" — style is the HTML style attribute. The render handle
// is exposed as el.handle once el.ready resolves.
import { render, loadSpecText } from "./engine-render";
import type { RenderHandle } from "./render";

export interface FigureAttrs {
  look: "sketchy" | "clean";
  mode: "narrated" | "silent" | "instant";
  speed: number;
  autoplay: boolean;
}

/** Pure attribute parsing, exported for tests. */
export function parseFigureAttrs(get: (name: string) => string | null): FigureAttrs {
  const mode = get("mode");
  return {
    look: get("look") === "clean" ? "clean" : "sketchy",
    mode: mode === "silent" || mode === "instant" ? mode : "narrated",
    speed: parseFloat(get("speed") ?? "") || 1,
    autoplay: get("autoplay") !== null,
  };
}

// Node-import safety (the build smoke script imports this module without a
// DOM): fall back to a dummy base class when HTMLElement is absent.
const Base = (typeof HTMLElement !== "undefined" ? HTMLElement : (class {} as unknown)) as typeof HTMLElement;

export class DrawcastFigure extends Base {
  handle: RenderHandle | null = null;
  ready: Promise<void> = Promise.resolve();

  connectedCallback(): void {
    const text = this.textContent ?? "";
    this.textContent = "";
    this.ready = this.mount(text);
  }

  private async mount(text: string): Promise<void> {
    const attrs = parseFigureAttrs((n) => this.getAttribute(n));
    try {
      const loaded = await loadSpecText(text);
      if (loaded.errors.length > 0) throw new Error(loaded.errors.join("; "));
      this.handle = await render(loaded.spec, this, { style: attrs.look, mode: attrs.mode, speed: attrs.speed });
      if (attrs.autoplay) void this.handle.timeline.play();
    } catch (err) {
      const pre = document.createElement("pre");
      pre.style.cssText = "color:#b91c1c;font-size:0.85rem;white-space:pre-wrap;";
      pre.textContent = "drawcast-figure: " + (err as Error).message;
      this.appendChild(pre);
    }
  }

  disconnectedCallback(): void {
    this.handle?.destroy();
    this.handle = null;
  }
}

export function defineDrawcastFigure(): void {
  if (typeof customElements === "undefined") return;
  if (!customElements.get("drawcast-figure")) customElements.define("drawcast-figure", DrawcastFigure);
}
```

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/engine_element_attrs.test.ts` → PASS; `npx tsc --noEmit && npm test` → green.

- [ ] **Step 6: Commit**

```bash
git add src/engine-render.ts src/engine-element.ts tests/engine_element_attrs.test.ts
git commit -m "feat: embed render wrapper (packs/engines ensured) and <drawcast-figure> element"
```

---

### Task 5: drawcast — the two build entries, engine build, smoke check, push

**Files:**
- Create: `src/engine.ts`, `src/compiler.ts`, `vite.engine.config.ts`, `scripts/check-engine-build.mjs`
- Modify: `package.json` (add `build:engine` script), `.gitignore` (add `dist-engine`)

**Interfaces:**
- Produces `dist-engine/engine.js` exporting: `render`, `loadSpecText`, `parseSpecText`, `formatSpec`, `validateSpec`, `DrawcastFigure`, `defineDrawcastFigure`, `parseFigureAttrs` (types `SpeechLike`, `RenderHandle`, `RenderOptions` erased at runtime). Importing it in a browser defines `<drawcast-figure>` as a side effect.
- Produces `dist-engine/compiler.js` exporting: `compileFigure(request, {apiKey, model?, maxRepairs?}) → Promise<{yaml, spec, error?, outcome}>`, plus `generateSpec`, `MODELS`, `DEFAULT_MODEL`, `describeApiError`. Task 9's xplainer module calls `compileFigure` and reads `.yaml` / `.error`.

- [ ] **Step 1: Create `src/engine.ts`**

```ts
// Engine entry — the embeddable drawcast renderer, built by `npm run
// build:engine` into dist-engine/ (ESM + relative chunks; vendor the whole
// directory). Hosts import { render, loadSpecText } or use the
// <drawcast-figure> element. No editor, no app chrome, no Anthropic SDK —
// generation lives in the compiler entry.
export { render, loadSpecText } from "./engine-render";
export { parseSpecText, formatSpec } from "./spec/text";
export { validateSpec } from "./spec/schema";
export type { SpeechLike } from "./render/speech";
export type { RenderHandle, RenderOptions, RenderStyle } from "./render";
export { DrawcastFigure, defineDrawcastFigure, parseFigureAttrs, type FigureAttrs } from "./engine-element";

import { defineDrawcastFigure } from "./engine-element";
defineDrawcastFigure();
```

- [ ] **Step 2: Create `src/compiler.ts`**

```ts
// Compiler entry — drawcast's request→spec pipeline for host apps, built to
// dist-engine/compiler.js. Separate from engine.js so the rendering path
// never loads the Anthropic SDK. Anthropic-direct from the browser (BYOK or
// vended key), exactly like the drawcast app itself.
import bundledExamples from "./examples.json";
import { DEFAULT_MODEL } from "./llm/client";
import { generateSpec, promptVariants, type GenerationOutcome } from "./llm/compile";
import { usableExemplars, type ExemplarCandidate } from "./llm/exemplars";
import { isReadyTemplate } from "./scenes/catalog";
import { PACK_DEFS, ensureEnabledPacks } from "./scenes/packs";
import { formatSpec } from "./spec/text";
import type { Spec } from "./spec/types";

export { MODELS, DEFAULT_MODEL, describeApiError } from "./llm/client";
export { generateSpec };
export type { GenerationOutcome };

/** Templates host apps never see: the 3D molecule modal needs drawcast's app UI. */
const HOST_EXCLUDED_TEMPLATES = ["molecule_3d"];

export interface CompileFigureOptions {
  apiKey: string;
  model?: string;
  maxRepairs?: number;
}

export interface CompiledFigure {
  yaml: string | null;
  spec: Spec | null;
  error?: string;
  outcome: GenerationOutcome;
}

/**
 * One figure from one request, with drawcast's full quality loop
 * (schema-constrained call → validate → visual lint → capped repairs on a
 * downshifted model). The exemplar well is the bundled showcases only — a
 * host app has no drawcast library to promote from.
 */
export async function compileFigure(request: string, opts: CompileFigureOptions): Promise<CompiledFigure> {
  await ensureEnabledPacks(Object.keys(PACK_DEFS));
  const outcome = await generateSpec(request, {
    apiKey: opts.apiKey,
    model: opts.model ?? DEFAULT_MODEL,
    variant: promptVariants()[0],
    exemplars: [],
    bundledExemplars: usableExemplars(bundledExamples as unknown as ExemplarCandidate[], isReadyTemplate),
    maxRepairs: opts.maxRepairs,
    excludeIds: HOST_EXCLUDED_TEMPLATES,
  });
  if (!outcome.spec) return { yaml: null, spec: null, error: outcome.error ?? "no spec produced", outcome };
  return { yaml: formatSpec(outcome.spec, "yaml"), spec: outcome.spec, outcome };
}
```

Note: `ExemplarCandidate` and `usableExemplars` are exported from `src/llm/exemplars.ts` (verified). If `promptVariants()` ever returns more than one variant, `[0]` is `compiler-v1` (sorted by name) — fine.

- [ ] **Step 3: Create `vite.engine.config.ts`**

```ts
import { defineConfig } from "vite";

// The embeddable engine build (engine.js + compiler.js) → dist-engine/.
// base "./" keeps chunk imports relative so the directory can be vendored
// wholesale into any host (xplainer copies it to vendor/drawcast/).
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist-engine",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        engine: "src/engine.ts",
        compiler: "src/compiler.ts",
      },
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
      preserveEntrySignatures: "strict",
    },
  },
});
```

- [ ] **Step 4: Create `scripts/check-engine-build.mjs`**

```js
// Post-build smoke: both entries must import cleanly in Node (all DOM paths
// are guarded) and expose their contracts. Run by `npm run build:engine`.
const need = async (rel, keys) => {
  const mod = await import(new URL(`../dist-engine/${rel}`, import.meta.url));
  for (const k of keys) {
    if (typeof mod[k] === "undefined") {
      console.error(`FAIL: dist-engine/${rel} is missing export "${k}"`);
      process.exit(1);
    }
  }
};
await need("engine.js", ["render", "loadSpecText", "parseSpecText", "formatSpec", "validateSpec", "DrawcastFigure", "defineDrawcastFigure"]);
await need("compiler.js", ["compileFigure", "generateSpec", "MODELS", "DEFAULT_MODEL", "describeApiError"]);
console.log("OK: dist-engine entries import cleanly and expose their contracts.");
```

If this smoke fails with a `document`/`window`/`HTMLElement` ReferenceError, some module runs DOM code at import time — find it in the stack and guard it with `typeof document === "undefined"` the way `figure-style.ts` and `engine-element.ts` do. Do not skip the smoke.

- [ ] **Step 5: Wire the script and ignore the artifact**

`package.json` scripts:

```json
    "build:engine": "tsc && vite build --config vite.engine.config.ts && node scripts/check-engine-build.mjs",
```

Append `dist-engine` to `.gitignore` (the artifact is vendored into xplainer, never committed here).

- [ ] **Step 6: Build and verify**

Run: `npm run build:engine && ls dist-engine/`
Expected: `engine.js`, `compiler.js`, `chunks/` (pack YAML + shared code), the smoke's OK line. Then `npm test` and `npm run build` (the normal app build must be unaffected).

- [ ] **Step 7: Commit and push drawcast**

```bash
git add src/engine.ts src/compiler.ts vite.engine.config.ts scripts/check-engine-build.mjs package.json .gitignore
git commit -m "feat: embeddable engine build (dist-engine: engine.js + compiler.js) for host apps"
git branch --show-current   # must print main
git push && git ls-remote origin main | head -1
```

---

### Task 6: xplainer — vendor the engine + `:::drawcast` handler

**Files:**
- Create: `vendor/drawcast/` (copied build output), `src/player/handlers/drawcast.js`
- Modify: `index.html` (one script tag)
- Test: `tests/drawcast_block_parse.test.mts` (new)

**Interfaces:**
- Consumes: `engine.js` exports from Task 5; xplainer's handler API (`api.speak(text, tokenAtStart, action)`, `api.appendToLocation(el, location)`, `api.isAborted()`, `api.runOpts.instant`, `api.state.speed`, `api.internal.waitForClick(label, location, token)`).
- Produces: registered action `"drawcast"` — which is also what makes the parser's registry passthrough keep `:::drawcast` blocks (type + `content`) instead of degrading them to `write_speak`.

- [ ] **Step 1: Copy the build**

```bash
cd /Users/hom/Documents/GitHub/xplainer
mkdir -p vendor/drawcast
cp -R /Users/hom/Documents/GitHub/drawcast/dist-engine/. vendor/drawcast/
ls vendor/drawcast/   # engine.js, compiler.js, chunks/
```

- [ ] **Step 2: Write the failing parser test**

```ts
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
```

Run: `node --test tests/drawcast_block_parse.test.mts` — the FIRST test fails today only if run without the sandbox `Xplainer` stub; with the stub it passes already (the passthrough exists). That is fine: this test pins the seam the handler depends on. Both tests must pass before moving on.

- [ ] **Step 3: Create `src/player/handlers/drawcast.js`**

```js
/**
 * Xplainer :::drawcast handler — drawcast-quality animated, narrated figures
 * from a YAML spec in the block body (spec:
 * docs/superpowers/specs/2026-08-24-drawcast-figures-design.md).
 *
 * The engine is drawcast's built renderer, vendored at vendor/drawcast/ and
 * lazy-imported on first use like mermaid/p5. Narration goes through
 * xplainer's own speak pipeline via the engine's SpeechLike seam, so cloud
 * TTS, captions, mute and speed keep working and nothing speaks twice.
 *
 * Block args: request (stage-1 provenance, shown when the body is missing),
 * size (px max-width, default 480), style (sketchy|clean), speed,
 * location (left|right, drawings default right). Body: YAML (or JSON) spec.
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (!window.Xplainer || !window.Xplainer.actions) {
    console.warn("[Xplainer.drawcast] core.js must load before handlers/drawcast.js");
    return;
  }

  var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || "";
  var ENGINE_URL = SCRIPT_SRC
    ? new URL("../../../vendor/drawcast/engine.js", SCRIPT_SRC).href
    : "vendor/drawcast/engine.js";
  var enginePromise = null;
  function loadEngine() {
    if (!enginePromise) enginePromise = import(ENGINE_URL);
    return enginePromise;
  }

  function errorCard(message) {
    var el = document.createElement("div");
    el.style.cssText =
      "border:1px solid #fca5a5; border-radius:6px; padding:10px 12px;" +
      "color:#b91c1c; background:#fef2f2; font-size:0.85rem; white-space:pre-wrap;";
    el.textContent = "Drawing could not be shown: " + message;
    return el;
  }

  // xplainer's speak pipeline as the engine's SpeechLike. The engine awaits
  // speak() before advancing visuals; api.speak resolves per xplainer's own
  // narration rules (cloud TTS / browser voice / captions / mute). A stale
  // token (seek, cancel) resolves immediately so playback never hangs.
  function makeSpeechAdapter(api, action) {
    return {
      speak: function (text) {
        if (api.isAborted()) return Promise.resolve();
        return Promise.resolve(api.speak(text, api.tokenAtStart, action));
      },
      cancel: function () {},
      pause: function () {},
      resume: function () {},
    };
  }

  async function handleDrawcast(action, api) {
    var container = document.createElement("div");
    var size = parseInt(action.size, 10) || 480;
    container.style.maxWidth = size + "px";
    container.style.width = "100%";
    api.appendToLocation(container, action.location);

    var specText = String(action.content || "");
    var meaningful = specText.split("\n").some(function (l) {
      var t = l.trim();
      return t !== "" && t.charAt(0) !== "#";
    });
    if (!meaningful) {
      var comment = (specText.split("\n").find(function (l) { return l.trim().charAt(0) === "#"; }) || "").trim();
      container.appendChild(errorCard(
        comment ? comment.replace(/^#\s*/, "")
          : action.request
            ? 'this figure has not been generated yet (request="' + action.request + '"). Generate with an Anthropic key or the password (⚙), or paste a drawcast spec into the block.'
            : "the block body is empty — put a drawcast YAML spec in it."));
      return;
    }

    var engine, loaded;
    try {
      engine = await loadEngine();
      loaded = await engine.loadSpecText(specText);
    } catch (err) {
      container.appendChild(errorCard(err && err.message ? err.message : String(err)));
      return;
    }
    if (loaded.errors.length) {
      container.appendChild(errorCard(loaded.errors.join("\n")));
      return;
    }
    if (api.isAborted()) return;

    var instant = !!(api.runOpts && api.runOpts.instant);
    var handle;
    try {
      handle = await engine.render(loaded.spec, container, {
        style: action.style === "clean" ? "clean" : "sketchy",
        mode: instant ? "instant" : "narrated",
        speed: parseFloat(action.speed) || (api.state && api.state.speed) || 1,
        speech: makeSpeechAdapter(api, action),
      });
    } catch (err) {
      container.appendChild(errorCard(err && err.message ? err.message : String(err)));
      return;
    }

    // wait:click inside a figure uses xplainer's click gate when available;
    // left unset the engine degrades it to a short pause (never a deadlock).
    var waitForClick = api.internal && api.internal.waitForClick;
    if (waitForClick && !instant) {
      handle.timeline.inputGate = function () {
        return waitForClick(undefined, action.location || "right", api.tokenAtStart);
      };
    }

    try {
      await handle.timeline.play();
    } finally {
      if (api.isAborted()) handle.destroy();
    }
  }

  window.Xplainer.actions.register("drawcast", handleDrawcast);
})();
```

- [ ] **Step 4: Add the script tag**

In `index.html`, after the `handlers/diagrams.js` line (~1224):

```html
<script defer src="src/player/handlers/drawcast.js"></script>
```

- [ ] **Step 5: Verify**

Run: `node --test tests/drawcast_block_parse.test.mts` → PASS ×2. Then the whole existing suite still passes: `node --test tests/keys_vending.test.mts tests/ai_password_client.test.mts` (and any other `tests/*.test.mts`).

- [ ] **Step 6: Commit and push**

```bash
git add vendor/drawcast src/player/handlers/drawcast.js index.html tests/drawcast_block_parse.test.mts
git commit -m "feat: :::drawcast block — vendored drawcast engine renders YAML figures in lectures"
git push
```

---

### Task 7: xplainer — example lecture + browser smoke

**Files:**
- Create: `examples/drawcast_demo.txt`

- [ ] **Step 1: Create the example** (verify the element ids against `/Users/hom/Documents/GitHub/drawcast/src/scenes/supply_demand/manifest.json` — `element_ids` keys — and correct the `draw:` lists below if they differ):

```
::: title(title=Supply and demand — drawn by drawcast)
::: write_speak
Let's look at how a market finds its price.
::: drawcast(size=520)
title: Demand and supply
template: supply_demand
params:
  demand: { label: D }
  supply: { label: S }
  equilibrium: { show: true, guides: true }
commands:
  - speak: Let's build a market diagram and find where the price settles.
  - draw: [axes]
    speak: Price on the vertical axis, quantity on the horizontal.
  - pause: 0.3
  - draw: [demand_curve, label_D]
    speak: 'This falling line is demand: as price falls, quantity demanded rises.'
  - draw: [supply_curve, label_S]
    speak: 'And this rising line is supply.'
::: write_speak
Where the two lines cross, the market settles.
```

- [ ] **Step 2: Browser smoke (one pass, keep it cheap)**

Serve the repo root (`python3 -m http.server 8899` — netlify dev's port 8888 may be taken) and open `http://localhost:8899/` in Chrome with a HARD reload (cached handlers trap). Paste `examples/drawcast_demo.txt` into the editor, press Play. Expected: the figure draws step-by-step in the right column, captions + xplainer narration run once each (no double speech), seek/rewind re-renders it instantly, and the console is free of engine errors. If the engine 404s, the vendored path is wrong — check `new URL("../../../vendor/drawcast/engine.js", …)` against where the handler script actually loaded from.

- [ ] **Step 3: Commit and push**

```bash
git add examples/drawcast_demo.txt
git commit -m "docs: drawcast figure demo lecture"
git push
```

---

### Task 8: xplainer — stage-1 prompt, lint set, drift guard

**Files:**
- Modify: `src/explain_prompt_generate.txt` (table row + notes + Pass 2 + placeholder mapping)
- Modify: `src/explain_ai.js` (KNOWN_BLOCKS)
- Modify: `index.html` (`explain_ai.js?v=4` → `?v=5`)
- Test: `python3 tests/prompt_block_drift.py` (no code change needed — it auto-discovers `actions.register("drawcast"` and the new table row)

- [ ] **Step 1: Prompt — block reference table.** Add a row directly after the `draw` row (~line 110):

```
| drawcast | Animated, narrated hand-drawn figure — BEST for conceptual diagrams | request="what to draw and the story it tells"; size= |
```

- [ ] **Step 2: Prompt — notes section.** In "Notes on specific blocks" (before the `- **draw**:` bullet), insert:

```
- **drawcast**: the PREFERRED block for conceptual figures — markets
  (supply/demand), decision trees, QALY profiles, physics diagrams,
  timelines, molecules, 2×2 tables. Emit ONLY the header with a request
  and an EMPTY body:
  `::: drawcast(request="a supply and demand diagram; demand shifts right; tell the story of the new equilibrium")`
  A separate drawing engine compiles the figure after generation.
  Narration division (strict): the figure narrates itself. Put the story
  into the request; the surrounding script must NOT explain the figure's
  content — at most one bridging sentence before the block ("Let's see
  this in a diagram."). Keep the request plain text without " quotes.
  Figure kinds that work especially well: supply_demand, decision_tree,
  qaly_profiles, free_body, timeline, two_by_two_table, markov_model,
  cost_effectiveness_plane, ray_diagram, wave_diagram, energy_diagram,
  reaction_scheme, cell_diagram, membrane_bilayer, dna_helix, phylo_tree,
  ring_molecule, protein_secondary — but any drawable idea may be
  requested. Use draw/svg only for trivial sketches drawcast would waste.
```

- [ ] **Step 3: Prompt — three smaller edits.** (a) Pass 2 list: change the picture line to ``- A concrete picture → `drawcast` (preferred for diagrams), `img`, `draw`, `svg`, `mermaid` ``. (b) Pedagogy §9 "Show, don't only tell": mention `drawcast` first for relationships/assumptions. (c) Placeholders: `[DRAWING]` / `[DRAWING: X]` → `::: drawcast` (was `::: draw`).

- [ ] **Step 4: Lint set + cache bust.** In `src/explain_ai.js`, add `"drawcast"` to `KNOWN_BLOCKS` (alphabetical: after `"draw"`). In `index.html`, bump `src/explain_ai.js?v=4` to `?v=5`.

- [ ] **Step 5: Verify**

Run: `python3 tests/prompt_block_drift.py` → `OK: prompt covers all N author-facing blocks, no strays.` (drawcast is found in the handler registry AND the prompt table). Run `node --test tests/ai_password_client.test.mts` → still green.

- [ ] **Step 6: Commit and push**

```bash
git add src/explain_prompt_generate.txt src/explain_ai.js index.html
git commit -m "feat: stage-1 prompt teaches drawcast placeholders + narration-division rule"
git push
```

---

### Task 9: xplainer — stage-2 figure compilation

**Files:**
- Create: `src/explain_figures.js`
- Modify: `src/explain_ai.js` (`finishRun` + one helper), `index.html` (script tag)
- Test: `tests/figures_splice.test.mts` (new)

**Interfaces:**
- Consumes: `compileFigure` from `vendor/drawcast/compiler.js` (Task 5); `getKeys().anthropic` and `setStatus` inside `explain_ai.js`.
- Produces: `window.XplainerFigures = { findPlaceholders(text), fillBody(text, placeholder, body), compileAllWith(compiler, text, opts), compileAll(text, opts) }` where `opts = { apiKey, model?, onProgress?(done, total, request) }` and both compile functions resolve to `{ text, compiled, failed }` and never reject.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/figures_splice.test.mts` → FAIL (file missing).

- [ ] **Step 3: Create `src/explain_figures.js`**

```js
/**
 * Stage 2 of AI generation: compile ::: drawcast(request="…") placeholder
 * blocks into full YAML specs using drawcast's compiler pipeline
 * (vendor/drawcast/compiler.js: schema-constrained call → validate → visual
 * lint → capped repairs). Anthropic-only (BYOK or vended key). Pure
 * text-transform helpers live on window.XplainerFigures for tests;
 * explain_ai.js calls compileAll() after a successful generation.
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;

  var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || "";
  var COMPILER_URL = SCRIPT_SRC
    ? new URL("../vendor/drawcast/compiler.js", SCRIPT_SRC).href
    : "vendor/drawcast/compiler.js";

  /**
   * Placeholders = ::: drawcast headers with a request= arg whose body is
   * empty (nothing but blank lines before the next ::: or EOF). Filled
   * bodies — including failure comments — are never placeholders again.
   */
  function findPlaceholders(text) {
    var lines = String(text).split("\n");
    var found = [];
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^:::\s*drawcast\s*\((.*)\)\s*$/);
      if (!m) continue;
      var rq = m[1].match(/request\s*=\s*"((?:[^"\\]|\\.)*)"/) || m[1].match(/request\s*=\s*'((?:[^'\\]|\\.)*)'/);
      if (!rq) continue;
      var end = i + 1;
      var empty = true;
      while (end < lines.length && !/^\s*:::/.test(lines[end])) {
        if (lines[end].trim() !== "") empty = false;
        end++;
      }
      if (empty) found.push({ headerLine: i, bodyStart: i + 1, bodyEnd: end, request: rq[1] });
    }
    return found;
  }

  /** Replace one placeholder's (empty) body span with content; returns new text. */
  function fillBody(text, placeholder, body) {
    var lines = String(text).split("\n");
    var inserted = String(body).replace(/\s+$/, "").split("\n");
    return lines.slice(0, placeholder.bodyStart).concat(inserted, lines.slice(placeholder.bodyEnd)).join("\n");
  }

  /**
   * Compile every placeholder in document order, re-finding after each fill
   * (fills shift line numbers). Failures become a # comment in the block
   * body and compilation continues — the promise NEVER rejects.
   */
  function compileAllWith(compiler, text, opts) {
    var total = findPlaceholders(text).length;
    var done = 0;
    var failed = 0;
    function next(current) {
      var remaining = findPlaceholders(current);
      if (!remaining.length) return Promise.resolve({ text: current, compiled: done - failed, failed: failed });
      var p = remaining[0];
      if (opts.onProgress) opts.onProgress(done, total, p.request);
      return compiler
        .compileFigure(p.request, { apiKey: opts.apiKey, model: opts.model })
        .then(
          function (result) {
            done++;
            if (!result || !result.yaml) {
              failed++;
              return next(fillBody(current, p, "# drawing generation failed: " + ((result && result.error) || "unknown error")));
            }
            return next(fillBody(current, p, result.yaml));
          },
          function (err) {
            done++;
            failed++;
            return next(fillBody(current, p, "# drawing generation failed: " + (err && err.message ? err.message : String(err))));
          }
        );
    }
    return next(String(text));
  }

  function compileAll(text, opts) {
    if (!findPlaceholders(text).length) return Promise.resolve({ text: String(text), compiled: 0, failed: 0 });
    return import(COMPILER_URL).then(function (compiler) {
      return compileAllWith(compiler, text, opts);
    });
  }

  window.XplainerFigures = {
    findPlaceholders: findPlaceholders,
    fillBody: fillBody,
    compileAllWith: compileAllWith,
    compileAll: compileAll,
  };
})();
```

- [ ] **Step 4: Run the tests** — `node --test tests/figures_splice.test.mts` → PASS ×3.

- [ ] **Step 5: Wire into `explain_ai.js`**

Replace the tail of `finishRun` (from `var unknown = lintBlocks(accumulated);` through the final `else` status) with a stage-2 pass followed by the same status logic on the FINAL text:

```js
    compileFigures(textarea, accumulated).then(function (r) {
      var unknown = lintBlocks(r.text);
      var blocks = (r.text.match(/^:::/gm) || []).length;
      var base = "Done (" + mode + ", " + blocks + " blocks)";
      if (unknown.length) {
        setStatus("⚠ " + base + " — unknown blocks will play as plain text: " + unknown.join(", "), true);
      } else if (r.note) {
        setStatus(base + " — " + r.note, r.noteIsError);
      } else {
        setStatus(base + ". Press Play to preview.");
      }
    });
```

and add the helper below `finishRun` (uses the existing `getKeys` and `setStatus`):

```js
  // Stage 2: drawcast figure placeholders → full specs (src/explain_figures.js).
  // Resolves to { text, note, noteIsError } and never rejects; on any skip the
  // original text is returned so lint/status still run.
  function compileFigures(textarea, text) {
    var fig = window.XplainerFigures;
    if (!fig) return Promise.resolve({ text: text, note: null });
    var placeholders = fig.findPlaceholders(text);
    if (!placeholders.length) return Promise.resolve({ text: text, note: null });
    var key = (getKeys().anthropic || "").trim();
    if (!key) {
      return Promise.resolve({
        text: text,
        note: placeholders.length + " drawing(s) NOT generated — figures need an Anthropic key or the password (⚙).",
        noteIsError: true,
      });
    }
    return fig
      .compileAll(text, {
        apiKey: key,
        onProgress: function (done, total, request) {
          setStatus("Drawing " + (done + 1) + " of " + total + "… (" + String(request).slice(0, 60) + ")");
        },
      })
      .then(
        function (result) {
          textarea.value = result.text;
          state.generated = result.text;
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
          var note = result.failed
            ? result.compiled + " drawing(s) generated, " + result.failed + " failed (kept as # comments — regenerate or fill by hand)."
            : result.compiled + " drawing(s) generated.";
          return { text: result.text, note: note, noteIsError: !!result.failed };
        },
        function (err) {
          return { text: text, note: "drawing generation failed: " + err.message, noteIsError: true };
        }
      );
  }
```

Known v1 limitation (accepted): the figure stage is not cancellable from the Stop button — the main stream already finished when it starts, and the status line shows its progress.

- [ ] **Step 6: Script tag.** In `index.html`, after the `explain_ai.js?v=5` line:

```html
<script defer src="src/explain_figures.js"></script>
```

- [ ] **Step 7: Verify**

Run: `node --test tests/figures_splice.test.mts tests/ai_password_client.test.mts tests/drawcast_block_parse.test.mts tests/keys_vending.test.mts` → all green. `python3 tests/prompt_block_drift.py` → OK.

- [ ] **Step 8: Commit and push**

```bash
git add src/explain_figures.js src/explain_ai.js index.html tests/figures_splice.test.mts
git commit -m "feat: stage-2 figure compilation — drawcast placeholders become YAML specs after generation"
git push
```

---

### Task 10: Final verification and handoff

- [ ] **Step 1: Full suites, both repos**

```bash
cd /Users/hom/Documents/GitHub/drawcast && npm test && npm run build:engine && npm run build
cd /Users/hom/Documents/GitHub/xplainer && node --test tests/*.test.mts && python3 tests/prompt_block_drift.py
```

All green; `git status` clean in both repos; `git ls-remote origin main | head -1` matches `git rev-parse HEAD` in both.

- [ ] **Step 2: One end-to-end generation smoke (browser, single pass)**

On the local server from Task 7 (hard reload): enter the password in ⚙ (vends the Anthropic key), prompt "Explain supply and demand for a first-year economics student", Generate. Expected: the streamed script contains `::: drawcast(request="…")` blocks with empty bodies; the status then walks "Drawing 1 of N…"; the bodies fill with YAML; Play renders the figures with single-voice narration and no repeated explanation of the figure content in the surrounding text.

- [ ] **Step 3: Report to Hans**

State what is live at xplainer.melberg.app, the demo lecture path (`examples/drawcast_demo.txt`), and the two things only he can judge: figure quality on his real lecture topics, and the narration-division feel (does the script over-explain figures?). Note the save-as-app limitation (registry blocks, drawcast included, don't run in saved single-file apps — pre-existing) and the deferred gateway path for keyless visitors.
