# AI Generate + Save to Google Doc / GitHub — Design

Date: 2026-08-18. Status: approved in chat (Hans), pending spec review.

## Goal

Let a user in editor mode (1) generate or revise a lecture with an LLM
(Claude / Gemini / OpenAI) directly in the app, and (2) save the lecture
text to a Google Doc or a GitHub repo. A saved Google Doc closes the loop
with the existing `#gdoc-{id}` autoplay path (`explain_player.js` loads
`docs.google.com/document/d/{id}/export?format=txt`), giving storage,
collaboration, and a shareable play link in one step.

## Decisions (made in chat)

- **LLM path: hybrid.** Default = Netlify AI Gateway via one Netlify
  Function. Override = user's own API key (BYOK) stored in localStorage,
  calling the provider directly from the browser.
- **Default model:** `claude-sonnet-4-6` (Claude). Also offered:
  `gemini-2.5-flash` (Gemini), `gpt-5-mini` (OpenAI). Curated shortlist,
  not free-text model entry.
- **UI: inline bar, no modal.** A slim generate row in the editor
  toolbar, same idiom as the existing load row. Output streams directly
  into the editor textarea. Settings (BYOK keys) behind a small ⚙ modal.
- **Order:** ① Generate → ② Save to Google Doc → ③ Save to GitHub.
  Each phase deploys on its own.
- **Prompt:** Hans's "GEM v2" prompt is the base, revised (see § Prompt).
  It lives in a versioned file and is improved iteratively.
- **Gdoc saves go to the signed-in user's own Drive** (their OAuth
  session, their ownership). Hans's Drive is never a target.

## Architecture

Static app stays static; one Netlify Function is added. New code goes in
new modules — `explain_player.js` (8.3k lines) is not grown further.

New files:

| File | Purpose |
|---|---|
| `netlify.toml` | functions dir + node runtime config |
| `netlify/functions/generate.mts` | streaming gateway proxy |
| `src/explain_ai.js` | generate bar UI, streaming, BYOK, lint |
| `src/explain_gdoc.js` | Google sign-in + Drive save (phase 2) |
| `src/explain_github.js` | GitHub save via PAT (phase 3) |
| `src/explain_prompt_generate.txt` | the system prompt (living artifact) |
| `tests/prompt_block_drift.py` | prompt-vs-parser drift check |

`index.html` gets the generate row, the ⚙ settings modal, and (later)
Save-to-gdoc / Save-to-GitHub buttons.

## Phase 1 — Generate

### UI

```
[Play] [Close] [Help] [Download] [Save as app]
[URL or id…        ] [Load] [examples ▾] [⟳] [Upload]
✨ [Topic or instructions…       ] [Claude ▾] [Generate] [⚙]
```

- One-line instruction input. Model dropdown shows the three curated
  models; the selection persists in localStorage.
- **Mode auto-detect:** empty editor → NEW (topic → full lecture);
  non-empty editor → REVISION (expand `[ai: ...]` markers, preserve the
  rest). The instruction field is optional in REVISION mode.
- **Streaming into the textarea.** The user watches the lecture being
  written; Play previews it. During generation the button becomes
  Cancel (aborts the fetch, keeps partial text).
- **Restore.** Before generation starts, current editor content is
  snapshotted (one level). A "Restore" affordance appears after
  generation so a bad run — especially a REVISION that replaced
  everything — is one click to undo.
- **Post-generation lint.** The parser silently converts unknown block
  names to `write_speak` prose (`explain_parser.js:892`), so a
  hallucinated block reads its own syntax aloud instead of erroring.
  After streaming completes, run `parseLectureText` plus a known-blocks
  check on the output and show warnings in the editor status line
  ("unknown block ':::foo' on line 12 — will render as text").

### Routing (hybrid)

**Default — gateway.** Browser POSTs `{provider, model, system, user}`
to `/api/generate`. The function constructs the provider's official SDK
bare (gateway env vars are auto-injected by Netlify) and streams the
completion back as an SSE/text stream. Guards:

- **Model allowlist** — only the three curated models are accepted;
  anything else is rejected (the function must not be an open proxy).
- `max_tokens` capped (~8k) — enough for a long lecture.
- Modest per-IP rate limit (in-memory, e.g. 10/hour) — best-effort;
  revisit with a passphrase gate only if abuse actually appears.
- 60s sync-function ceiling is why streaming is mandatory, not optional.

**Override — BYOK.** If the user has stored a key for the selected
provider (⚙ modal → localStorage, per provider), the browser calls the
provider directly: OpenAI and Gemini allow CORS natively; Anthropic
needs the `anthropic-dangerous-direct-browser-access: true` header.
Keys are sent only to their own provider. BYOK also makes generation
work where the function doesn't exist ("Save as app" exports, static
copies): if no key is stored and `/api/generate` is unreachable, the
status line says so and points at ⚙.

### Prompt (`src/explain_prompt_generate.txt`)

Fetched by the client at runtime (`cache: "no-store"`) and sent as the
system message — the function stays dumb, so iterating on the prompt is
editing one versioned file. Base: Hans's GEM v2, with these revisions:

1. **Drop the "one single preformatted code block" wrapper** — a
   chat-UI artifact. Via API we want raw blocks only; strengthen the
   "no code fences, no preamble" rule instead (API models love ```).
2. **Fix stale block facts** (audited against the parser 2026-08-18):
   `::: link` IS supported (`explain_parser.js:547`); `tutorial_link`
   is a deprecated alias of `xplainer_link` (line 537) — prefer `link`.
3. **Add the missing blocks:** registry family `celebrate`, `sound`,
   `countdown`, `reveal`, `intro` (`src/player/handlers/fx.js`), plus
   `flashcard`, `video`, `chart-*`, `mark_image`/`annotate_image`,
   `brython`, and the `py`/`r`/`bpy` aliases. The block-reference table
   is regenerated from the parser + handlers, not hand-maintained.
4. **Merge prompt3's three-pass workflow** (DRAFT prose → MARK block
   candidates → RENDER) in place of GEM's two-pass — prose quality
   first is the better route to interesting lectures.
5. **Add an "interesting lectures" section:** hook variety, narrative
   arc across sections, suspense via `countdown`/`reveal`, sparing
   `celebrate` reward moments, concrete numbers over adjectives, dry
   humour where it fits. (Hans's explicit ask: technical correctness
   AND pedagogical quality.)
6. **Length default:** ~5–10 minutes of playtime unless the user's
   instruction says otherwise (GEM's "default long" is dropped; the
   instruction field passes straight through as the user message).

Kept from GEM v2 largely as-is: priority order, NEW/REVISION modes and
`[ai: ...]` expansion rules, block syntax rules (no closing `:::`, no
nesting), short-chunk writing rules, pedagogical principles (hook,
Say → Show → Use, connected transitions, questions, further sources),
placeholders, silent self-check.

**Drift test:** `tests/prompt_block_drift.py` (same spirit as the
existing `_syntax_check.py` and askstat's drift-lint) greps block names
from the prompt's reference table and compares them against
`explain_parser.js` type checks + `actions.register(...)` calls in
`src/player/handlers/`. Fails when the app grows a block the prompt
doesn't know, or the prompt names a block the app lacks.

`explain_prompt2.txt`/`explain_prompt3.txt` stay for copy-paste chat
use; the app uses only the new file.

## Phase 2 — Save to Google Doc

Fully client-side. Google Identity Services token client, scope
`drive.file` (non-sensitive → no Google verification review; tokens are
~1h, kept in memory only, silent re-consent per session).

Flow: **Save to Google Doc** button → sign-in popup (first use per
session) → `drive.files.create` multipart upload of the raw block text
with `mimeType: application/vnd.google-apps.document` (Google converts
plain text → Doc) → `permissions.create` sets "anyone with link:
viewer" → dialog shows two links: the Doc (edit/collaborate) and the
ready-to-share `…/#gdoc-{id}` play URL. The docId is remembered in
localStorage, keyed by the lecture's title (first `title`/`new_page`
title in the text, else a content-derived slug), and the save dialog
shows whether it will update that doc or create a new one, with a
"save as new" escape hatch. Updates go via `files.update`.

Accepted limitation: `drive.file` can only update docs this app created
(or ones the user picks via Google Picker — later). Loading/playing any
shared doc is unaffected (that path is anonymous).

**Curly-quote normalization at load:** collaborators hand-editing in
Docs UI get smart quotes/auto-capitalization that can corrupt
directives. Normalize curly quotes to straight in the gdoc load path.

Hans's one-time setup (exact click-path provided at phase start):
Google Cloud project → enable Drive API → OAuth client ID (web) with
origins `https://xplainer.melberg.app` + localhost dev. The client ID
is public and ships in the code.

## Phase 3 — Save to GitHub

Fine-grained PAT (single repo, contents: read/write), pasted once in ⚙,
stored in localStorage. Save = `PUT /repos/{owner}/{repo}/contents/{path}`
with the update-vs-create SHA dance (GET current SHA first; handle 409
by refetch-and-retry once). Settings: owner/repo/path/branch. On
success show the raw URL, which the editor's existing GitHub load path
accepts. OAuth web flow (via a second function holding the client
secret) is deferred until third-party users exist.

## Error handling

- Stream failure mid-generation: keep partial text, status line shows
  the error, Restore available.
- Gateway quota exhausted / function 4xx-5xx: clear message suggesting
  BYOK in ⚙.
- Gdoc 401 (token expired): re-run token client once, then surface.
- GitHub 401/404: point at ⚙ settings; 409: one refetch-retry.

## Testing / verification

- `tests/prompt_block_drift.py` in whatever runner `_syntax_check.py`
  uses (plain `python tests/...`).
- Manual smoke per phase (Hans tests small things himself). Local dev:
  `netlify dev` on a **linked** directory is required for the gateway
  function locally, and only after AI is enabled + one prod deploy;
  netlify dev takes port 8888. BYOK path and gdoc path work on any
  static server.
- Per push-policy, each phase is pushed to main (= deployed) when done.

## Out of scope (deliberate, for later)

- Google Picker (updating gdocs the app didn't create)
- GitHub OAuth web flow
- Passphrase gate on `/api/generate` (only if abuse appears)
- Prompt-editing UI in the app (the prompt is a file, edited in git)
- The frozen old deploy (xplainer.app) gets none of this
