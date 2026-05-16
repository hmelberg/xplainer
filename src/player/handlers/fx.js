/**
 * Xplainer fx handlers — celebrate, sound, countdown, reveal, intro.
 *
 * Each handler is registered with Xplainer.actions so authors can write e.g.:
 *
 *   ::: celebrate type=confetti
 *   ::: sound name=ding
 *   ::: countdown n=5 text="Think about this…"
 *   ::: reveal text="The answer was 42." click=true
 *   ::: intro text="Chapter 2" subtitle="Why correlation isn't enough" enter=slide-up
 *
 * The :::intro block is a thin wrapper around <ui-intro> (components/ui-intro.js);
 * it mounts the custom element onto the current slide and awaits its "intro-done"
 * event so narration sequencing stays sane.
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (!window.Xplainer || !window.Xplainer.actions) {
    console.warn("[Xplainer.fx] Xplainer.actions not available — core.js must load first");
    return;
  }

  const actions = window.Xplainer.actions;

  // ---------- shared helpers ----------

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
  }

  // Prefer the shared loader on window.Xplainer (see src/player/core.js).
  // Fall back to a private implementation if fx.js is loaded standalone.
  const loadScriptOnce = (window.Xplainer && window.Xplainer.loadScriptOnce) || function (src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-xplainer-src="' + src + '"]');
      if (existing) {
        if (existing.dataset.loaded === "true") return resolve();
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("failed to load " + src)), { once: true });
        return;
      }
      const el = document.createElement("script");
      el.src = src;
      el.async = true;
      el.dataset.xplainerSrc = src;
      el.addEventListener("load", () => { el.dataset.loaded = "true"; resolve(); }, { once: true });
      el.addEventListener("error", () => reject(new Error("failed to load " + src)), { once: true });
      document.head.appendChild(el);
    });
  };

  // ---------- :::celebrate ----------
  // Lazily pulls canvas-confetti from jsDelivr the first time it fires. No-op if
  // the network is unavailable — celebration should never break a lecture.
  const CONFETTI_URL = "https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js";

  async function ensureConfetti() {
    if (typeof window.confetti === "function") return window.confetti;
    try {
      await loadScriptOnce(CONFETTI_URL);
    } catch (err) {
      console.warn("[Xplainer.celebrate] canvas-confetti failed to load:", err);
      return null;
    }
    return typeof window.confetti === "function" ? window.confetti : null;
  }

  async function handleCelebrate(action, api) {
    const kind = String(action.kind || action.type_effect || "confetti").toLowerCase();
    if (kind === "confetti" || kind === "default") {
      const confetti = await ensureConfetti();
      if (!confetti) return;
      const bursts = Number(action.bursts) || 3;
      const particleCount = Number(action.particles) || 80;
      const spread = Number(action.spread) || 70;
      for (let i = 0; i < bursts; i++) {
        confetti({
          particleCount,
          spread,
          origin: { y: 0.65 },
          startVelocity: 45,
          scalar: Number(action.scalar) || 1,
          colors: action.colors || undefined,
        });
        if (i < bursts - 1) await sleep(180);
      }
    } else if (kind === "fireworks") {
      const confetti = await ensureConfetti();
      if (!confetti) return;
      const duration = Number(action.duration) || 2000;
      const end = Date.now() + duration;
      (function frame() {
        confetti({ particleCount: 6, angle: 60, spread: 55, origin: { x: 0, y: 0.7 } });
        confetti({ particleCount: 6, angle: 120, spread: 55, origin: { x: 1, y: 0.7 } });
        if (Date.now() < end) requestAnimationFrame(frame);
      })();
      await sleep(duration);
    } else if (kind === "flash") {
      // Lightweight CSS-only celebration: a quick white flash over the board.
      const board = api.els && api.els.board;
      if (!board) return;
      const flash = document.createElement("div");
      flash.style.cssText = "position:absolute;inset:0;pointer-events:none;background:rgba(255,255,255,0.9);animation:xp-celebrate-flash 520ms ease-out forwards;z-index:9000;";
      if (!document.getElementById("xp-celebrate-flash-style")) {
        const st = document.createElement("style");
        st.id = "xp-celebrate-flash-style";
        st.textContent = "@keyframes xp-celebrate-flash{0%{opacity:0}15%{opacity:1}100%{opacity:0}}";
        document.head.appendChild(st);
      }
      board.appendChild(flash);
      await sleep(560);
      flash.remove();
    }
    if (action.speak) await api.speak(action.speak);
  }

  actions.register("celebrate", handleCelebrate);

  // ---------- :::sound ----------
  // Tiny WebAudio-based sound bank. Everything is synthesised on the fly so
  // there are no asset downloads. Respects the player's global mute state via
  // state.muted (exposed on api.state).
  let audioCtx = null;
  function getAudioCtx() {
    if (audioCtx) return audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try { audioCtx = new Ctx(); } catch (_) { return null; }
    return audioCtx;
  }

  function playBeep({ freq = 880, dur = 0.18, type = "sine", gain = 0.12, slideTo = null }) {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    if (slideTo) osc.frequency.linearRampToValueAtTime(slideTo, ctx.currentTime + dur);
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.01);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.05);
  }

  const SOUND_BANK = {
    ding:      () => playBeep({ freq: 1320, dur: 0.22, type: "sine", gain: 0.16 }),
    ping:      () => playBeep({ freq: 1760, dur: 0.12, type: "triangle", gain: 0.12 }),
    woosh:     () => playBeep({ freq: 220, dur: 0.35, type: "sawtooth", gain: 0.08, slideTo: 80 }),
    tick:      () => playBeep({ freq: 1400, dur: 0.04, type: "square", gain: 0.08 }),
    error:     () => { playBeep({ freq: 220, dur: 0.18, type: "sawtooth", gain: 0.16 }); setTimeout(() => playBeep({ freq: 165, dur: 0.22, type: "sawtooth", gain: 0.16 }), 180); },
    success:   () => { playBeep({ freq: 784, dur: 0.12, type: "triangle", gain: 0.14 }); setTimeout(() => playBeep({ freq: 1175, dur: 0.22, type: "triangle", gain: 0.14 }), 120); },
    drumroll:  () => {
      const ctx = getAudioCtx();
      if (!ctx) return;
      const dur = 0.8;
      const buffer = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src = ctx.createBufferSource();
      const g = ctx.createGain();
      g.gain.value = 0.08;
      src.buffer = buffer;
      src.connect(g).connect(ctx.destination);
      src.start();
    },
  };

  async function handleSound(action, api) {
    if (api.state && api.state.muted) return; // respect global mute
    const name = String(action.name || "ding").toLowerCase();
    const fn = SOUND_BANK[name];
    if (!fn) {
      console.warn("[Xplainer.sound] unknown sound:", name, "— supported:", Object.keys(SOUND_BANK).join(", "));
      return;
    }
    // Resume the audio context on user gesture; otherwise the first call after
    // page load is silent on Chrome.
    const ctx = getAudioCtx();
    if (ctx && ctx.state === "suspended") { try { await ctx.resume(); } catch (_) {} }
    fn();
    if (action.wait_ms) await sleep(Number(action.wait_ms));
  }

  actions.register("sound", handleSound);

  // ---------- :::countdown ----------
  async function handleCountdown(action, api) {
    const n = Math.max(1, Math.min(20, Number(action.n ?? action.count ?? 3)));
    const stepMs = Number(action.step_ms || action.interval_ms || 900);
    const text = action.text || action.prompt || "";
    const tickSound = action.tick !== false;
    const finalSound = action.final !== false;

    const wrap = document.createElement("div");
    wrap.className = "xp-countdown";
    wrap.style.cssText = "display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px 12px;gap:12px;";
    const label = document.createElement("div");
    label.textContent = text;
    label.style.cssText = "font-size:clamp(1rem,2vw,1.35rem);font-weight:600;opacity:0.8;text-align:center;";
    const number = document.createElement("div");
    number.style.cssText = "font-size:clamp(4rem,14vw,10rem);font-weight:800;line-height:1;letter-spacing:0.02em;font-variant-numeric:tabular-nums;color:var(--accent,#38bdf8);text-shadow:0 2px 32px rgba(0,0,0,0.35);";
    wrap.appendChild(label);
    wrap.appendChild(number);
    api.appendToLocation(wrap, action.location);

    for (let i = n; i >= 1; i--) {
      if (api.isAborted && api.isAborted()) return;
      number.textContent = String(i);
      number.animate(
        [{ transform: "scale(1.25)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }],
        { duration: 280, easing: "ease-out" },
      );
      if (tickSound) handleSound({ name: "tick" }, api);
      await sleep(stepMs);
    }
    if (finalSound) handleSound({ name: "ding" }, api);
    if (action.final_text) {
      number.textContent = String(action.final_text);
    }
    if (action.speak) await api.speak(action.speak);
  }

  actions.register("countdown", handleCountdown);

  // ---------- :::reveal ----------
  // Blurred-out text that unblurs on click (or after delay_ms). Handy for
  // spoilers, answer reveals, and dramatic punchlines.
  async function handleReveal(action, api) {
    const text = String(action.text || action.content || action._bodyText || "").trim();
    if (!text) return;

    const wrap = document.createElement("div");
    wrap.className = "xp-reveal";
    wrap.style.cssText = "display:inline-block;padding:12px 18px;margin:8px 0;border-radius:12px;background:rgba(148,163,184,0.12);cursor:pointer;transition:filter 0.45s ease,background 0.3s ease;filter:blur(8px);user-select:none;position:relative;";
    wrap.textContent = text;
    wrap.setAttribute("role", "button");
    wrap.setAttribute("tabindex", "0");

    const hint = document.createElement("div");
    hint.textContent = "click to reveal";
    hint.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;opacity:0.85;filter:blur(0);pointer-events:none;color:#f1f5f9;";
    // The hint element is a sibling, not a child, so the blur on `wrap` doesn't
    // blur the "click to reveal" text. Position the outer container relatively.
    const outer = document.createElement("span");
    outer.style.cssText = "position:relative;display:inline-block;";
    outer.appendChild(wrap);
    outer.appendChild(hint);
    api.appendToLocation(outer, action.location);

    const unblur = () => {
      wrap.style.filter = "blur(0)";
      wrap.style.background = "rgba(34,197,94,0.15)";
      hint.style.opacity = "0";
      hint.style.transition = "opacity 0.3s ease";
      setTimeout(() => hint.remove(), 350);
    };

    if (action.delay_ms) {
      await sleep(Number(action.delay_ms));
      unblur();
    } else {
      wrap.addEventListener("click", unblur, { once: true });
      wrap.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") unblur(); }, { once: true });
    }
    if (action.speak) await api.speak(action.speak);
  }

  actions.register("reveal", handleReveal);

  // ---------- :::intro ----------
  // Thin wrapper around <ui-intro> (components/ui-intro.js). Authors can also
  // write `::: comp tag=ui-intro ...` to use the web component directly; this
  // handler just makes it one keyword shorter.
  //
  // Gotcha: components/ui-intro.js is NOT preloaded — it normally rides on the
  // :::comp auto-load path in explain_player.js (~line 6458), which our :::intro
  // handler bypasses. So we must load the script ourselves before creating the
  // element; otherwise document.createElement("ui-intro") returns a silent
  // HTMLUnknownElement that never dispatches "intro-done" and the handler just
  // times out on its safety fallback (visible symptom: no intro appears, lecture
  // quietly continues).
  async function ensureUiIntroDefined() {
    if (typeof customElements !== "undefined" && customElements.get("ui-intro")) return;
    // Resolve relative to the current page so it works at any baseURI.
    // Cache-bust with ?v= so changes to ui-intro.js are picked up on reload.
    const url = new URL("components/ui-intro.js?v=2", document.baseURI).href;
    try {
      await loadScriptOnce(url);
    } catch (err) {
      console.warn("[Xplainer.intro] failed to load components/ui-intro.js:", err);
      return;
    }
    // Wait for customElements.whenDefined so the upgrade has actually happened
    // before we create an instance. This is a belt-and-braces guard: the script
    // should have called customElements.define synchronously on load.
    if (typeof customElements !== "undefined" && typeof customElements.whenDefined === "function") {
      try { await customElements.whenDefined("ui-intro"); } catch (_) {}
    }
  }

  async function handleIntro(action, api) {
    await ensureUiIntroDefined();
    const el = document.createElement("ui-intro");
    const map = {
      text: "text",
      title: "text",
      subtitle: "subtitle",
      enter: "enter",
      duration: "duration",
      fade_in_ms: "fade-in-ms",
      fade_out_ms: "fade-out-ms",
      size: "size",
      position: "position",
      backdrop: "backdrop",
      color: "color",
      subtitle_color: "subtitle-color",
      background: "background",
      speak: "speak",
      lang: "lang",
      show_ok: "show-ok",
      ok_label: "ok-label",
      auto_dismiss: "auto-dismiss",
    };
    for (const [src, dst] of Object.entries(map)) {
      if (action[src] != null) el.setAttribute(dst, String(action[src]));
    }
    // Language fallback: if the author didn't specify `lang=` on the intro
    // block, use the app's configured default speech language so the intro's
    // TTS matches the rest of the narration.
    if (action.lang == null && !el.hasAttribute("lang")) {
      const appLang = api.state && api.state.defaults && api.state.defaults.speech_lang;
      if (appLang) el.setAttribute("lang", String(appLang));
    }
    // Sanity check: if ui-intro failed to register as a custom element,
    // document.createElement returns an HTMLUnknownElement that will never
    // dispatch intro-done. Warn loudly so this fails visibly rather than
    // sitting on the safety timeout.
    if (typeof customElements !== "undefined" && !customElements.get("ui-intro")) {
      console.warn("[Xplainer.intro] <ui-intro> is not a registered custom element. Check that components/ui-intro.js loaded successfully. Falling back to a plain text banner.");
      const fallback = document.createElement("div");
      fallback.style.cssText = "padding:24px;text-align:center;font-size:1.5rem;font-weight:700;";
      fallback.textContent = action.text || action.title || "(intro)";
      api.appendToLocation(fallback, action.location);
      return;
    }
    // Mount onto document.body so the fullscreen overlay isn't clipped by any
    // column layout constraints on the board.
    document.body.appendChild(el);
    let timedOut = false;
    try {
      await new Promise((resolve) => {
        el.addEventListener("intro-done", () => resolve(), { once: true });
        // Safety timeout: don't hang forever if the custom element misbehaves.
        const safety = Number(action.duration || 4000) + 2000;
        setTimeout(() => { timedOut = true; resolve(); }, safety);
      });
    } finally {
      if (timedOut) {
        console.warn("[Xplainer.intro] <ui-intro> timed out without firing intro-done — something went wrong inside ui-intro.js play().");
      }
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  }

  actions.register("intro", handleIntro);
})();
