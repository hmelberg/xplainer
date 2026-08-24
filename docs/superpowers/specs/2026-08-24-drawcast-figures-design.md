# Drawcast figures in xplainer — design

Date: 2026-08-24
Status: approved (design review in chat); implementation plan to follow
Repos touched: `xplainer` (integration target) and `drawcast` (engine build + one small API change)

## Problem

xplainer's drawings are poor because its `:::draw` vocabulary is seven raw SVG
primitives (`line`, `circle`, `rect`, `ellipse`, `polygon`, `path`, `text`)
where the LLM must hand-compute absolute pixel coordinates. There are no axes,
no domain→pixel scaling, no label anchoring, no semantic elements, and the
generation prompt spends ~3 lines on drawing.

drawcast solves all of this with three layers:

1. **A semantic language** — templates + params (16 ready templates), semantic
   elements (`axes`, `curve` with `expr`, `point`, `arrow`, `label` with
   `attach_to`/`side`, `region`, `node`, `edge`, `annotation`), logical
   1000×750 y-up coordinates. Wire format is JSON; YAML is a lossless
   human-facing layer and the parser (`drawcast/src/spec/text.ts`)
   auto-detects either and repairs smart quotes (Google-Docs safe).
2. **A layout engine** (`drawcast/src/layout/`, ~1,600 lines) plus a
   sketchy (roughjs) / clean SVG renderer.
3. **A generation pipeline** (`drawcast/src/llm/`) — ~90k-char system prompt
   (JSON Schema 22k + template catalog 45k + few-shots + exemplars) with
   schema validation → visual lint → capped repair rounds, and a prompt-cache
   prefix/suffix split that keeps repair rounds cheap.

Reusing only the language would get half the win; this design reuses all
three layers.

## Decision summary

- **Approach:** isolated engine bundle built *from the drawcast repo* (single
  source of truth, no hand-port, no drift), vendored into xplainer, plus a
  thin `<drawcast-figure>` web component. Chosen over (a) hand-porting ~6k
  lines of TS into xplainer's no-build plain-JS codebase and (b) an
  Anvil/server API — rejected because drawcast has no headless renderer,
  video export is real-time in-browser only, and xplainer needs the client
  renderer for live playback anyway.
- **Scope of this round:** rendering **and** two-stage AI generation.

## 1. Engine build (drawcast repo)

New `npm run build:engine` (Vite library mode, `vite.engine.config.ts`)
producing `dist-engine/` with two entries:

- **`engine.js`** — exports `render(spec, container, options)` (the existing
  documented boundary in `drawcast/src/render/index.ts`, returning
  `{ timeline, layout, plan, lint(), update(), destroy() }`), the YAML/JSON
  parser from `spec/text.ts`, and defines the `<drawcast-figure>` custom
  element. Bundles `render/` + `layout/` + `spec/` + `lint/` + `scenes/`
  (kit, built-in templates, the three default packs as relative lazy
  chunks — code-splitting preserved). The ~24 `.cs-*` CSS rules from
  `drawcast/src/styles.css` are injected by the module as a `<style>` tag;
  consumers need no separate stylesheet. Roughly 120 KB gzipped.
- **`compiler.js`** — exports the generation pipeline: `generateSpec()`
  (`llm/compile.ts`), prompt assembly (`llm/prompt.ts`, keeping the
  prefix/suffix cache split), the Anthropic BYOK client (`llm/client.ts`),
  and JSON→YAML conversion. Separate entry so the rendering path never pays
  for the Anthropic SDK.

Constraints and small drawcast-side changes:

- `render()` options gain an **injectable speech adapter** so a host app's
  TTS serves `speak:` lines (today speech is wired internally via
  `render/speech.ts`). Default behavior unchanged for the drawcast app.
- Compiler exemplars come from the bundled `examples.json` (16 entries) and
  default packs only. drawcast's localStorage "learn from this" well and
  remote packs stay app-only features.
- The `molecule_3d` template (3Dmol modal, 588 KB lazy chunk) is **excluded**
  from the catalog the embedded compiler advertises, so the engine never
  pulls 3Dmol.
- The engine build's editor UI (`main.ts`), playlist/session, and video
  export are excluded.

## 2. Web component

`<drawcast-figure>` (NOT `<drawcast>` or `ui-drawcast` — xplainer already
defines an unrelated `ui-drawcast` screen-recorder element in
`explain_components.js`):

- Spec as text content (YAML) or a `spec` property.
- Attributes: `style="sketchy|clean"`, `mode="narrated|silent|instant"`,
  `speed`, `autoplay`.
- Exposes the render handle as a property (`el.handle`) for imperative hosts.
- **Light DOM**, not shadow: injected styles are `.cs-*`-namespaced already,
  and light DOM avoids the font-in-shadow-DOM problem. The Patrick Hand font
  degrades gracefully when absent (drawcast's `ensureFonts()` races a 900 ms
  timeout) — and xplainer's `index.html` already loads Patrick Hand, so no
  font work is needed.

## 3. xplainer rendering path

- Built files copied wholesale into `xplainer/vendor/drawcast/` (entry +
  chunks). xplainer stays no-build and self-contained; updating drawcast =
  rebuild + copy. Save-as-app correction (found during planning): saved
  single-file apps load only parser + defaults + player — no `core.js`, no
  handlers — so ALL registry blocks (mermaid, p5, celebrate, and now
  drawcast) already degrade to spoken text there. Drawcast matches that
  existing behavior; fixing save-as-app for handler blocks is a separate
  follow-up, not this round.
- New `src/player/handlers/drawcast.js` registers a `:::drawcast` block via
  `window.Xplainer.actions.register` — zero changes to `explain_player.js`.
  Header args: `size`, `style`, `location` (defaults to `right` like
  `:::draw`), `speed`. Body = YAML spec; the parser already passes unknown
  block bodies through raw, indentation intact.
- The handler lazy-imports `vendor/drawcast/engine.js` on first use (the
  mermaid/p5 pattern, cached like `state.jsModules`), calls `render()` into
  `api.appendToLocation(...)`, and awaits the timeline.
- **Mode mapping:** `api.runOpts.instant` → drawcast `instant` (seek,
  fast-forward, and rewind-and-replay just work, since xplainer re-runs from
  page start in instant mode); otherwise `narrated` with the speech adapter
  routing `speak:` lines through xplainer's own `speak` pipeline (TTS,
  captions, mute, speed) so exactly one narration system is authoritative.
- Cancellation: the handler checks `api.tokenAtStart` like other handlers and
  calls `handle.destroy()` when playback is cancelled mid-figure.

## 4. AI generation (two-stage)

**Stage 1 — placeholders.** `src/explain_prompt_generate.txt` gains a short
section: for figures, emit

```
::: drawcast(request="one-sentence description of the figure and its story")
```

with an **empty body**. `drawcast` is added to `KNOWN_BLOCKS` in
`explain_ai.js` and to the parser/prompt drift guard
(`tests/prompt_block_drift.py`).

The stage-1 prompt addition is ~20 lines, NOT drawcast's material. It
contains only: (a) the placeholder convention above; (b) a one-line index of
the 16 template *names* (~100 tokens) so the model knows what kinds of
figures are cheap and reliable to request — the 45k-char catalog and 22k
schema stay in stage 2 exclusively; (c) the **narration-division rule**: the
figure narrates itself. The lecture text must not explain the figure's
content — at most one bridging sentence before the block ("Let's see this in
a diagram") — and the `request` must say what story the figure should tell,
because drawcast's `speak:` lines will carry that explanation. This division
is structural, not just prompted: stage 2 sees only the `request`, so the
figure is self-contained, and at runtime all speech (lecture and figure)
flows sequentially through xplainer's single TTS pipeline, so overlap is
impossible — the only failure mode is redundancy, which the rule targets.

**Stage 2 — per-figure compilation.** After the main stream completes,
`explain_ai.js` scans the editor text for drawcast blocks with a `request`
and empty body. For each, it lazy-loads `vendor/drawcast/compiler.js` and
runs drawcast's full pipeline (schema-constrained call → validate → lint →
capped repairs; creative round on drawcast's default model, mechanical
repairs downshifted, per drawcast's existing policy). The resulting spec is
converted to YAML and spliced into the block body. `request=` stays in the
header for provenance and later regeneration. Progress shows in the AI bar
("Drawing 2 of 3…").

- **Saved documents are self-contained**: playback never needs a key; the
  YAML rides along through Google Docs / GitHub saves like any block body.
- **Keys:** the compiler is Anthropic-direct-from-browser (drawcast's
  design). Figure compilation works with a BYOK Anthropic key or
  password-vended keys (`xplainer_ai_keys` / `xplainer_vended_keys`).
  Gateway-only sessions get the lecture text plus a notice that figures need
  a key or password. Proxying the compiler through `/api/generate` is a
  **follow-up, not this round**.
- **Failure path:** a failed compilation leaves the block with its `request`
  and an error comment line in the body; generation continues with the next
  figure.
- **Cost:** lecture generation itself is essentially unchanged (~1% prompt
  growth). Each figure costs one drawcast compile — the same as generating
  that drawing in the drawcast app today (~23k-token system prompt +
  output + capped repairs). The byte-stable prompt prefix (schema + catalog
  + few-shots) carries `cache_control`, so in a multi-figure lecture the
  second and later figures, and all repair rounds, hit the Anthropic prompt
  cache; repairs also downshift to a cheaper model per drawcast's existing
  policy.

## 5. Error handling (playback)

- Invalid or failed YAML at play time → the handler renders a small
  placeholder/error card in the figure slot (ajv message included) and the
  lecture continues; never crash the player loop.
- Engine module load failure → same placeholder path.

## 6. Testing

- **drawcast:** existing ~536 vitest tests keep passing; new build-smoke
  tests for both entries (exports exist, custom element registers, a spec
  renders in the test DOM via the engine entry, compiler entry assembles a
  prompt without network).
- **xplainer:** `node --test` coverage for (a) YAML body pass-through in the
  parser (indentation, quotes, `---`), (b) the stage-2 splice logic as a
  pure text transform (find blocks, fill bodies, preserve everything else),
  (c) `KNOWN_BLOCKS` / prompt drift updates.
- **Manual smoke:** one example lecture with a `supply_demand` figure
  (hand-authored YAML) plus one end-to-end generation with a vended key.

## Out of scope this round

- 3Dmol molecule modal / `molecule_3d` template in xplainer.
- Video export inside xplainer (tab recording already captures figures).
- drawcast playlists (xplainer has pages).
- Gateway proxy for figure compilation (follow-up).
- Shadow-DOM variant of the web component.
- drawcast editor UI or exemplar-well sync between the apps.

## Open follow-ups (explicitly deferred)

1. `/api/generate` extension so gateway-only users get figures.
2. "Edit this figure in drawcast" round-trip link from the xplainer editor.
3. Sharing the key-vending Netlify function instead of the current
   independently-derived twins.
