// AI generation for the xplainer editor.
// Self-contained: injects its own toolbar row + settings modal into the
// editor pane, so any page that includes this script (and has an editor)
// gets the feature. Default path is the site's /api/generate function
// (Netlify AI Gateway); a user-supplied key in settings switches to a
// direct browser call to that provider.
(function () {
  "use strict";

  var MODELS = [
    { provider: "anthropic", model: "claude-sonnet-4-6", label: "Claude" },
    { provider: "gemini", model: "gemini-2.5-flash", label: "Gemini" },
    { provider: "openai", model: "gpt-5-mini", label: "OpenAI" },
  ];
  var MAX_TOKENS = 8192;
  // Resolve the prompt next to this script (not the page URL), so it loads
  // no matter what path the app is served from.
  var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || "";
  var PROMPT_URL = SCRIPT_SRC
    ? new URL("explain_prompt_generate.txt", SCRIPT_SRC).href
    : "src/explain_prompt_generate.txt";
  var LS_MODEL = "xplainer_ai_model";
  var LS_KEYS = "xplainer_ai_keys";

  // Blocks the app accepts (parser-native + registry + aliases). Used only
  // to warn about hallucinated blocks — the parser itself silently renders
  // unknown blocks as spoken text. tests/prompt_block_drift.py guards the
  // canonical list; this set is a superset including aliases.
  var KNOWN_BLOCKS = new Set([
    "accordion", "annotate", "annotate_image", "annotate_table", "bpy",
    "brython", "celebrate", "comment", "comp", "component", "countdown",
    "defaults", "dim", "draw", "flash-card", "flash_card", "flashcard",
    "highlight", "html", "ignore", "image", "img", "intro", "js", "link",
    "mark", "mark_image", "math", "mermaid", "message", "multiple_choice",
    "names", "new_page", "no_dim", "p5", "pdf", "presets", "py", "pyodide",
    "python", "question", "r", "reveal", "sound", "speak", "svg", "table",
    "title", "tutorial_link", "video", "wait", "web", "web_defaults",
    "webcomponent", "webr", "write", "write_speak", "xplainer_link",
    "youtube",
  ]);
  var DYNAMIC_PREFIXES = ["ui.", "py.", "chart-"];

  var els = {};
  var state = {
    running: false,
    controller: null,
    snapshot: null,   // editor content before the last generation
    generated: null,  // editor content after the last generation
    promptCache: null,
  };

  function lsGet(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }
  function getKeys() {
    try { return JSON.parse(lsGet(LS_KEYS, "{}")) || {}; } catch (e) { return {}; }
  }

  // ---------- keys & password redemption ----------

  // "speech" is not a chat provider: it is a Google Cloud key (or the
  // speech-only password) that explain_player.js reads for cloud narration.
  var PROVIDERS = ["anthropic", "gemini", "openai", "speech"];
  // Just enough to tell "this is a real key" from "this is something else".
  var KEY_PREFIXES = { anthropic: "sk-ant-", gemini: "AIza", openai: "sk-", speech: "AIza" };
  var VENDING_ENDPOINT = "/api/keys";

  function looksLikeKey(provider, text) {
    var prefix = KEY_PREFIXES[provider];
    return !!prefix && text.indexOf(prefix) === 0;
  }

  /**
   * The key fields also accept the shared password (deliberately
   * unadvertised): anything that doesn't look like that provider's key is
   * TRIED against the vending endpoint — the server decides. Resolves to the
   * vended keys, or to null when nothing redeemed (wrong password, vending
   * off, offline), in which case the text is stored exactly as entered.
   * Nothing about the password — not even its shape — lives in this file.
   */
  function redeemPassword(candidates) {
    var remaining = candidates.slice();
    function attempt() {
      if (!remaining.length) return Promise.resolve(null);
      var password = remaining.shift();
      return fetch(VENDING_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: password }),
      }).then(function (res) {
        if (!res.ok) return attempt();
        return res.json().then(function (json) {
          var vended = {
            anthropic: typeof json.anthropicKey === "string" ? json.anthropicKey : "",
            gemini: typeof json.geminiKey === "string" ? json.geminiKey : "",
            openai: typeof json.openaiKey === "string" ? json.openaiKey : "",
            speech: typeof json.speechKey === "string" ? json.speechKey : "",
          };
          var usable = PROVIDERS.some(function (p) { return vended[p].length > 0; });
          return usable ? vended : attempt();
        });
      }).catch(function () { return attempt(); });
    }
    return attempt();
  }

  /**
   * What to persist after a save: the keys as entered, except that any field
   * whose text turned out to be the password is cleared (never stored) and
   * every vended key is filled in. Keys the user typed themselves survive a
   * redemption that didn't cover their provider.
   */
  function mergeVended(entered, candidates, vended) {
    var next = {};
    PROVIDERS.forEach(function (p) { next[p] = entered[p] || ""; });
    if (!vended) return next;
    PROVIDERS.forEach(function (p) { if (candidates.indexOf(next[p]) >= 0) next[p] = ""; });
    PROVIDERS.forEach(function (p) { if (vended[p]) next[p] = vended[p]; });
    return next;
  }

  function setStatus(text, isError) {
    var el = document.getElementById("editorStatus");
    if (!el) return;
    el.textContent = text || "";
    el.style.color = isError ? "#fca5a5" : "var(--muted)";
  }

  // ---------- UI ----------

  function injectStyles() {
    var css = [
      // A plain second row between the toolbar and the textarea; the pane's
      // own gap and the controls' native classes keep it visually consistent.
      // margin-top compensates for .editor-toolbar's negative bleed margin,
      // which pulls following siblings space-3−space-2 above its visual edge.
      ".editor-ai { display:flex; gap:var(--space-1); align-items:center; flex-wrap:nowrap; min-width:0;",
      "  margin-top: calc(var(--space-3) - var(--space-2)); }",
      ".editor-ai .editor-ai-spark { flex:0 0 auto; opacity:.8; font-size:var(--font-xs); }",
      ".editor-ai input.editor-input { flex:1 1 auto; min-width:0; }",
      ".editor-ai select.editor-input { flex:0 1 auto; width:auto; min-width:0; cursor:pointer; }",
      ".editor-ai .editor-btn { flex:0 0 auto; white-space:nowrap; }",
      ".editor-ai-modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,.55);",
      "  display:none; align-items:center; justify-content:center; z-index:10000; }",
      ".editor-ai-modal-overlay.visible { display:flex; }",
      ".editor-ai-modal { background:#1e293b; color:#e2e8f0; border:1px solid rgba(255,255,255,.12);",
      "  border-radius:10px; padding:18px; width:min(440px, 92vw); font-size:14px;",
      "  box-shadow:0 18px 50px rgba(0,0,0,.5); }",
      ".editor-ai-modal h3 { margin:0 0 10px; font-size:15px; }",
      ".editor-ai-modal p { margin:6px 0 12px; font-size:12px; color:#94a3b8; line-height:1.5; }",
      ".editor-ai-modal label { display:block; font-size:12px; color:#94a3b8; margin:8px 0 3px; }",
      ".editor-ai-modal input { width:100%; box-sizing:border-box; background:#0f172a; color:#e2e8f0;",
      "  border:1px solid rgba(255,255,255,.15); border-radius:6px; padding:6px 8px; font-size:13px; }",
      ".editor-ai-modal .editor-ai-modal-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:14px; }",
    ].join("\n");
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildRow(toolbar) {
    var row = document.createElement("div");
    row.className = "editor-ai";
    row.innerHTML =
      '<span class="editor-ai-spark">✨</span>' +
      '<input id="aiPromptInput" class="editor-input" ' +
      'placeholder="Topic or instructions… (with text in the editor: revises it / expands [ai: …] markers)" />' +
      '<select id="aiModelSelect" class="editor-input"></select>' +
      '<button id="aiGenerateBtn" class="editor-btn">Generate</button>' +
      '<button id="aiRestoreBtn" class="editor-btn" style="display:none" ' +
      'title="Swap back to the text as it was before generation">Restore</button>' +
      '<button id="aiSettingsBtn" class="editor-btn" title="AI settings (your own API keys)">⚙</button>';
    // Own line below the toolbar — the toolbar itself is a nowrap flex row
    // and cramming these controls into it squeezes everything.
    toolbar.insertAdjacentElement("afterend", row);

    els.prompt = row.querySelector("#aiPromptInput");
    els.model = row.querySelector("#aiModelSelect");
    els.generate = row.querySelector("#aiGenerateBtn");
    els.restore = row.querySelector("#aiRestoreBtn");
    els.settings = row.querySelector("#aiSettingsBtn");

    MODELS.forEach(function (m, i) {
      var opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = m.label + " (" + m.model + ")";
      els.model.appendChild(opt);
    });
    var saved = parseInt(lsGet(LS_MODEL, "0"), 10);
    if (saved >= 0 && saved < MODELS.length) els.model.value = String(saved);
    els.model.addEventListener("change", function () { lsSet(LS_MODEL, els.model.value); });

    els.generate.addEventListener("click", function () {
      if (state.running) { cancelRun(); } else { startRun(); }
    });
    els.restore.addEventListener("click", swapRestore);
    els.settings.addEventListener("click", openSettings);
    els.prompt.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !state.running) { e.preventDefault(); startRun(); }
    });
  }

  function buildSettingsModal() {
    var overlay = document.createElement("div");
    overlay.className = "editor-ai-modal-overlay";
    overlay.innerHTML =
      '<div class="editor-ai-modal">' +
      "<h3>AI settings — your own API keys</h3>" +
      "<p>Optional. Without a key, generation uses this site’s built-in AI. " +
      "With a key, your browser calls the provider directly — the key is stored " +
      "only in this browser (localStorage) and sent only to that provider.</p>" +
      '<label>Anthropic (Claude) API key</label><input id="aiKeyAnthropic" type="password" autocomplete="off" placeholder="sk-ant-…" />' +
      '<label>Google (Gemini) API key</label><input id="aiKeyGemini" type="password" autocomplete="off" placeholder="AIza…" />' +
      '<label>OpenAI API key</label><input id="aiKeyOpenai" type="password" autocomplete="off" placeholder="sk-…" />' +
      '<label>Google speech key — cloud voices for narration (Text-to-Speech)</label>' +
      '<input id="aiKeySpeech" type="password" autocomplete="off" placeholder="AIza…" />' +
      '<div class="editor-ai-modal-actions">' +
      '<button id="aiKeysSaveBtn" class="editor-btn">Save</button>' +
      '<button id="aiKeysCloseBtn" class="editor-btn">Close</button>' +
      "</div></div>";
    document.body.appendChild(overlay);
    els.overlay = overlay;
    els.keyAnthropic = overlay.querySelector("#aiKeyAnthropic");
    els.keyGemini = overlay.querySelector("#aiKeyGemini");
    els.keyOpenai = overlay.querySelector("#aiKeyOpenai");
    els.keySpeech = overlay.querySelector("#aiKeySpeech");

    overlay.querySelector("#aiKeysSaveBtn").addEventListener("click", saveKeys);
    overlay.querySelector("#aiKeysCloseBtn").addEventListener("click", closeSettings);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeSettings();
    });
  }

  function saveKeys() {
    var fields = { anthropic: els.keyAnthropic, gemini: els.keyGemini, openai: els.keyOpenai, speech: els.keySpeech };
    var entered = {};
    var candidates = [];
    PROVIDERS.forEach(function (p) {
      var value = fields[p].value.trim();
      entered[p] = value;
      if (value && !looksLikeKey(p, value) && candidates.indexOf(value) < 0) candidates.push(value);
    });
    if (candidates.length) setStatus("Checking…");
    redeemPassword(candidates).then(function (vended) {
      var next = mergeVended(entered, candidates, vended);
      PROVIDERS.forEach(function (p) { fields[p].value = next[p]; });
      lsSet(LS_KEYS, JSON.stringify(next));
      closeSettings();
      setStatus(vended ? "Keys unlocked." : "API keys saved in this browser.");
    });
  }

  function openSettings() {
    var keys = getKeys();
    els.keyAnthropic.value = keys.anthropic || "";
    els.keyGemini.value = keys.gemini || "";
    els.keyOpenai.value = keys.openai || "";
    els.keySpeech.value = keys.speech || "";
    els.overlay.classList.add("visible");
  }
  function closeSettings() { els.overlay.classList.remove("visible"); }

  // ---------- prompt & message assembly ----------

  function getSystemPrompt() {
    if (state.promptCache) return Promise.resolve(state.promptCache);
    return fetch(PROMPT_URL, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("Could not load generation prompt (" + res.status + " for " + PROMPT_URL + ")");
      return res.text();
    }).then(function (text) {
      state.promptCache = text;
      return text;
    });
  }

  function buildUserMessage(instructions, current) {
    if (current.trim()) {
      return "[MODE: REVISION]\n\n" +
        (instructions ? "Additional instructions:\n" + instructions + "\n\n" : "") +
        "Script to revise:\n\n" + current;
    }
    return "[MODE: NEW]\n\nTopic / instructions:\n" + instructions;
  }

  // ---------- streaming transports ----------

  function readStreamedText(res, onDelta, signal) {
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return;
        onDelta(decoder.decode(r.value, { stream: true }));
        if (signal.aborted) { reader.cancel(); return; }
        return pump();
      });
    }
    return pump();
  }

  // Server-sent events: collect the JSON payload of each `data:` line.
  function readSse(res, onData, signal) {
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return;
        buffer += decoder.decode(r.value, { stream: true });
        var lines = buffer.split("\n");
        buffer = lines.pop();
        lines.forEach(function (line) {
          line = line.trim();
          if (!line.startsWith("data:")) return;
          var payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") return;
          try { onData(JSON.parse(payload)); } catch (e) { /* partial line */ }
        });
        if (signal.aborted) { reader.cancel(); return; }
        return pump();
      });
    }
    return pump();
  }

  function gatewayStream(m, system, user, onDelta, signal) {
    return fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: m.provider, model: m.model, system: system, user: user }),
      signal: signal,
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          throw new Error(data.error || "Generation service unavailable (" + res.status + "). Add your own API key via ⚙.");
        });
      }
      return readStreamedText(res, onDelta, signal);
    });
  }

  function anthropicStream(key, m, system, user, onDelta, signal) {
    return fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: m.model,
        max_tokens: MAX_TOKENS,
        system: system,
        messages: [{ role: "user", content: user }],
        stream: true,
      }),
      signal: signal,
    }).then(function (res) {
      if (!res.ok) return failFromJson(res, "Anthropic");
      return readSse(res, function (data) {
        if (data.type === "content_block_delta" && data.delta && data.delta.type === "text_delta") {
          onDelta(data.delta.text);
        }
      }, signal);
    });
  }

  function openaiStream(key, m, system, user, onDelta, signal) {
    return fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model: m.model,
        max_completion_tokens: MAX_TOKENS,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        stream: true,
      }),
      signal: signal,
    }).then(function (res) {
      if (!res.ok) return failFromJson(res, "OpenAI");
      return readSse(res, function (data) {
        var t = data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content;
        if (t) onDelta(t);
      }, signal);
    });
  }

  function geminiStream(key, m, system, user, onDelta, signal) {
    var url = "https://generativelanguage.googleapis.com/v1beta/models/" +
      m.model + ":streamGenerateContent?alt=sse&key=" + encodeURIComponent(key);
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: MAX_TOKENS },
      }),
      signal: signal,
    }).then(function (res) {
      if (!res.ok) return failFromJson(res, "Gemini");
      return readSse(res, function (data) {
        var cand = data.candidates && data.candidates[0];
        var parts = cand && cand.content && cand.content.parts;
        if (parts) parts.forEach(function (p) { if (p.text) onDelta(p.text); });
      }, signal);
    });
  }

  function failFromJson(res, providerName) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      var msg = (data.error && (data.error.message || data.error)) || res.status;
      throw new Error(providerName + " error: " + msg);
    });
  }

  // ---------- lint ----------

  function lintBlocks(text) {
    var unknown = [];
    var actions = window.Xplainer && window.Xplainer.actions;
    text.split("\n").forEach(function (line, i) {
      var mtc = line.match(/^:::\s*([A-Za-z_][\w.-]*)/);
      if (!mtc) return;
      var name = mtc[1].toLowerCase();
      if (KNOWN_BLOCKS.has(name)) return;
      if (DYNAMIC_PREFIXES.some(function (p) { return name.startsWith(p); })) return;
      if (actions && typeof actions.has === "function" && actions.has(name)) return;
      unknown.push(name + " (line " + (i + 1) + ")");
    });
    return unknown;
  }

  // ---------- run ----------

  function currentModel() {
    return MODELS[parseInt(els.model.value, 10) || 0];
  }

  function setRunning(running) {
    state.running = running;
    els.generate.textContent = running ? "Stop" : "Generate";
    els.prompt.disabled = running;
    els.model.disabled = running;
  }

  function cancelRun() {
    if (state.controller) state.controller.abort();
  }

  function startRun() {
    var textarea = document.getElementById("editorTextarea");
    if (!textarea) return;
    var instructions = els.prompt.value.trim();
    var current = textarea.value;
    if (!current.trim() && !instructions) {
      setStatus("Write a topic or instructions first.", true);
      els.prompt.focus();
      return;
    }

    var m = currentModel();
    var key = (getKeys()[m.provider] || "").trim();
    var controller = new AbortController();
    state.controller = controller;
    state.snapshot = current;
    state.generated = null;
    els.restore.style.display = "none";
    setRunning(true);
    setStatus("Generating with " + m.label + (key ? " (your key)…" : "…"));

    var accumulated = "";
    var mode = current.trim() ? "REVISION" : "NEW";
    function onDelta(text) {
      accumulated += text;
      textarea.value = accumulated;
      textarea.scrollTop = textarea.scrollHeight;
    }

    getSystemPrompt().then(function (system) {
      var user = buildUserMessage(instructions, current);
      if (!key) return gatewayStream(m, system, user, onDelta, controller.signal);
      if (m.provider === "anthropic") return anthropicStream(key, m, system, user, onDelta, controller.signal);
      if (m.provider === "openai") return openaiStream(key, m, system, user, onDelta, controller.signal);
      return geminiStream(key, m, system, user, onDelta, controller.signal);
    }).then(function () {
      finishRun(textarea, accumulated, mode, null);
    }).catch(function (err) {
      var aborted = controller.signal.aborted || (err && err.name === "AbortError");
      finishRun(textarea, accumulated, mode, aborted ? { aborted: true } : err);
    });
  }

  function finishRun(textarea, accumulated, mode, err) {
    setRunning(false);
    state.controller = null;
    if (accumulated) {
      state.generated = accumulated;
      if (state.snapshot.trim()) els.restore.style.display = "";
      // Sync player state + trigger its debounced auto-apply once.
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (err && err.aborted) {
      setStatus(accumulated ? "Stopped — partial result kept. Restore brings back the old text." : "Stopped.");
      return;
    }
    if (err) {
      setStatus(accumulated ? "Failed mid-generation (partial kept): " + err.message : err.message, true);
      return;
    }
    var unknown = lintBlocks(accumulated);
    var blocks = (accumulated.match(/^:::/gm) || []).length;
    if (unknown.length) {
      setStatus("⚠ Done (" + mode + ", " + blocks + " blocks) — unknown blocks will play as plain text: " + unknown.join(", "), true);
    } else {
      setStatus("Done (" + mode + ", " + blocks + " blocks). Press Play to preview.");
    }
  }

  function swapRestore() {
    var textarea = document.getElementById("editorTextarea");
    if (!textarea || state.snapshot === null) return;
    var showing = textarea.value;
    var swappingToSnapshot = showing === state.generated || showing !== state.snapshot;
    textarea.value = swappingToSnapshot ? state.snapshot : (state.generated || showing);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    els.restore.textContent = swappingToSnapshot ? "Redo" : "Restore";
    setStatus(swappingToSnapshot ? "Restored the text from before generation." : "Back to the generated text.");
  }

  // ---------- init ----------

  function init() {
    var pane = document.getElementById("editorPane");
    var toolbar = pane && pane.querySelector(".editor-toolbar");
    if (!toolbar) return; // page without an editor — feature not applicable
    injectStyles();
    buildRow(toolbar);
    buildSettingsModal();
  }

  // Pure helpers, exposed for tests (and usable from the console).
  if (typeof window !== "undefined") {
    window.XplainerAI = {
      looksLikeKey: looksLikeKey,
      redeemPassword: redeemPassword,
      mergeVended: mergeVended,
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
