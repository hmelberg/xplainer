/**
 * ui-intro: cinematic chapter intro overlay.
 *
 * Ported from forklar-widgets renderTitle.
 * Renders a fullscreen "TV-broadcast" title card over the current slide, then fades away.
 *
 * Usage from an .xplainer .txt file:
 *
 *   ::: comp tag=ui-intro text="Chapter 2: Causality" subtitle="Why correlation isn't enough" enter=slide-up
 *
 * Or (preferred, via the :::intro block registered in src/player/handlers/intro.js):
 *
 *   ::: intro text="Chapter 2" subtitle="Why correlation isn't enough" enter=slide-up duration=4000
 *
 * Attributes (all optional):
 *   text              Main title
 *   subtitle          Subtitle (appears slightly after the main title)
 *   enter             Enter animation: fade | slide-up | zoom-in | blur-in  (default fade)
 *   duration          Total display ms (default 3800)
 *   fade-in-ms        Enter animation duration (default 550)
 *   fade-out-ms       Leave animation duration (default 900; smoother cinematic fade)
 *   size              full | medium | small  (default full)
 *   position          center | lower | upper  (default center) — vertical placement
 *   backdrop          solid | dim | none  (default solid) — controls the screen-behind dim
 *   background        Custom background color/gradient on the card
 *   color             Main title color (default near-white)
 *   subtitle-color    Subtitle color
 *   speak             Text to narrate via TTS (falls back to title if speak-text is true)
 *   lang              BCP47 lang code for TTS (default: app's speech_lang or en-US)
 *   show-ok           "true" to show an OK button instead of auto-advancing
 *   ok-label          Button label (default "OK")
 *   auto-dismiss      "false" to keep the card on screen until the user clicks
 */
(function () {
  "use strict";
  const tagName = "ui-intro";
  if (typeof customElements === "undefined") return;
  if (customElements.get(tagName)) return;

  const STYLE_ID = "ui-intro-styles";
  const CSS = `
    ui-intro {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: none;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      /* Default vertical alignment is center; position variants override this. */
      padding: 0;
    }
    ui-intro.ui-intro--open {
      display: flex;
      pointer-events: auto;
    }
    /* Position variants (vertical alignment of the panel) */
    ui-intro.ui-intro--position-lower {
      align-items: flex-end;
      padding-bottom: 12vh;
    }
    ui-intro.ui-intro--position-upper {
      align-items: flex-start;
      padding-top: 12vh;
    }
    ui-intro .ui-intro-backdrop {
      position: absolute;
      inset: 0;
      background: linear-gradient(165deg, rgba(8,12,24,0.92) 0%, rgba(15,18,32,0.95) 45%, rgba(5,8,18,0.97) 100%);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      /* Smoother cinematic leave: ease-out curve and slightly longer duration. */
      transition: opacity 0.85s cubic-bezier(0.33, 1, 0.68, 1);
      opacity: 1;
    }
    /* Backdrop variants — let the page behind show through more (or entirely). */
    ui-intro.ui-intro--backdrop-dim .ui-intro-backdrop {
      background: rgba(8,12,24,0.42);
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
    }
    ui-intro.ui-intro--backdrop-none .ui-intro-backdrop {
      display: none;
    }
    ui-intro.ui-intro--leaving .ui-intro-backdrop {
      opacity: 0;
    }
    ui-intro.ui-intro--leaving .ui-intro-panel {
      opacity: 0;
      /* Subtle "pulling away" scale + drift so the leave doesn't feel like a hard cut. */
      transform: scale(0.985) translateY(6px);
    }
    ui-intro .ui-intro-panel {
      position: relative;
      width: 100%;
      max-width: min(96vw, 1320px);
      padding: clamp(24px, 6vh, 72px) clamp(16px, 4vw, 60px);
      text-align: center;
      transition: opacity 0.85s cubic-bezier(0.33, 1, 0.68, 1), transform 0.85s cubic-bezier(0.33, 1, 0.68, 1);
      opacity: 1;
      transform: scale(1) translateY(0);
    }
    ui-intro.ui-intro--size-medium .ui-intro-panel {
      max-width: min(92vw, 780px);
      background: linear-gradient(160deg, rgba(22,26,44,0.96) 0%, rgba(10,12,26,0.98) 100%);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 18px;
      box-shadow: 0 28px 72px rgba(0,0,0,0.55);
    }
    ui-intro.ui-intro--size-small .ui-intro-panel {
      max-width: min(92vw, 520px);
      background: linear-gradient(160deg, rgba(22,26,44,0.96) 0%, rgba(10,12,26,0.98) 100%);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 18px;
      box-shadow: 0 28px 72px rgba(0,0,0,0.55);
    }
    ui-intro .ui-intro-title {
      font-family: "Fira Code", "JetBrains Mono", ui-monospace, monospace;
      font-size: clamp(1.75rem, 5.5vw, 3.75rem);
      font-weight: 750;
      letter-spacing: 0.14em;
      line-height: 1.12;
      color: #f1f5f9;
      text-transform: uppercase;
      text-shadow: 0 2px 32px rgba(0,0,0,0.45), 0 0 1px rgba(0,0,0,0.8);
      margin: 0;
    }
    ui-intro.ui-intro--size-small .ui-intro-title { font-size: clamp(1.25rem, 4vw, 2.35rem); }
    ui-intro.ui-intro--size-medium .ui-intro-title { font-size: clamp(1.45rem, 4.5vw, 3rem); }
    ui-intro .ui-intro-subtitle {
      margin-top: clamp(12px, 2.5vw, 28px);
      font-size: clamp(0.95rem, 2.4vw, 1.35rem);
      font-weight: 500;
      letter-spacing: 0.06em;
      color: rgba(226,232,240,0.88);
      opacity: 0;
      transition: opacity 0.45s ease;
      text-shadow: 0 1px 18px rgba(0,0,0,0.4);
    }
    ui-intro .ui-intro-subtitle.ui-intro-subtitle--visible { opacity: 1; }
    ui-intro .ui-intro-ok {
      margin-top: clamp(20px, 3vw, 36px);
      padding: 10px 24px;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      background: rgba(255,255,255,0.08);
      color: #f1f5f9;
      border: 1px solid rgba(255,255,255,0.25);
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.2s ease, transform 0.1s ease;
    }
    ui-intro .ui-intro-ok:hover { background: rgba(255,255,255,0.14); }
    ui-intro .ui-intro-ok:active { transform: translateY(1px); }
    ui-intro.ui-intro--enter-fade .ui-intro-title,
    ui-intro.ui-intro--enter-fade .ui-intro-subtitle { animation: uiIntroFadeIn var(--ui-intro-enter-dur, 0.55s) ease forwards; }
    ui-intro.ui-intro--enter-slide-up .ui-intro-title { animation: uiIntroSlideUp var(--ui-intro-enter-dur, 0.6s) ease forwards; }
    ui-intro.ui-intro--enter-zoom-in .ui-intro-title { animation: uiIntroZoomIn var(--ui-intro-enter-dur, 0.55s) ease forwards; }
    ui-intro.ui-intro--enter-blur-in .ui-intro-title { animation: uiIntroBlurIn var(--ui-intro-enter-dur, 0.6s) ease forwards; }
    @keyframes uiIntroFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes uiIntroSlideUp { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes uiIntroZoomIn { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }
    @keyframes uiIntroBlurIn { from { opacity: 0; filter: blur(8px); } to { opacity: 1; filter: blur(0); } }
  `;

  function injectStylesOnce() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
  }

  function asBool(v, fallback) {
    if (v === true || v === "true" || v === "1" || v === 1) return true;
    if (v === false || v === "false" || v === "0" || v === 0) return false;
    return fallback;
  }

  function asNumber(v, fallback) {
    if (v == null || v === "") return fallback;
    const n = parseFloat(v);
    return isFinite(n) ? n : fallback;
  }

  function enterClass(kind) {
    const k = (kind || "fade").toLowerCase();
    if (k === "slide-up" || k === "fade-in-up") return "ui-intro--enter-slide-up";
    if (k === "zoom-in") return "ui-intro--enter-zoom-in";
    if (k === "blur-in") return "ui-intro--enter-blur-in";
    return "ui-intro--enter-fade";
  }

  function speakIfAvailable(text, opts) {
    if (!text) return Promise.resolve();
    if (typeof speechSynthesis === "undefined") return Promise.resolve();
    return new Promise((resolve) => {
      try {
        const u = new SpeechSynthesisUtterance(String(text));
        if (opts && opts.lang) u.lang = opts.lang;
        if (opts && opts.rate != null) u.rate = Number(opts.rate) || 1;
        if (opts && opts.pitch != null) u.pitch = Number(opts.pitch) || 1;
        if (opts && opts.volume != null) u.volume = Number(opts.volume) || 1;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        speechSynthesis.speak(u);
      } catch (_) {
        resolve();
      }
    });
  }

  class UiIntro extends HTMLElement {
    static get observedAttributes() {
      return ["text", "subtitle", "enter", "duration", "size", "position", "backdrop", "color", "subtitle-color", "background", "speak", "lang"];
    }

    constructor() {
      super();
      this._playing = false;
      this._abortResolve = null;
      this._speechInProgress = false;
    }

    connectedCallback() {
      injectStylesOnce();
      if (this._built) return;
      this._build();
      // Auto-play on attach; the action handler can call play() explicitly if it needs timing control.
      queueMicrotask(() => { if (!this._playing) this.play(); });
    }

    attributeChangedCallback() {
      if (this._built) this._applyAttrs();
    }

    _build() {
      this.innerHTML = "";
      const backdrop = document.createElement("div");
      backdrop.className = "ui-intro-backdrop";
      const panel = document.createElement("div");
      panel.className = "ui-intro-panel";
      const title = document.createElement("h1");
      title.className = "ui-intro-title";
      const sub = document.createElement("div");
      sub.className = "ui-intro-subtitle";
      panel.appendChild(title);
      panel.appendChild(sub);
      this.appendChild(backdrop);
      this.appendChild(panel);
      this._els = { backdrop, panel, title, sub };
      this._built = true;
      this._applyAttrs();
    }

    _applyAttrs() {
      const { title, sub, panel } = this._els;
      const text = this.getAttribute("text") || this.getAttribute("content") || "";
      const subtitle = this.getAttribute("subtitle") || "";
      title.textContent = text;
      sub.textContent = subtitle;
      const color = this.getAttribute("color");
      if (color) title.style.color = color;
      const subColor = this.getAttribute("subtitle-color");
      if (subColor) sub.style.color = subColor;
      const bg = this.getAttribute("background");
      if (bg) panel.style.background = bg;
      const size = (this.getAttribute("size") || "full").toLowerCase();
      this.classList.remove("ui-intro--size-full", "ui-intro--size-medium", "ui-intro--size-small");
      this.classList.add("ui-intro--size-" + (size === "small" ? "small" : size === "medium" ? "medium" : "full"));

      // Position: center (default), lower, upper
      const position = (this.getAttribute("position") || "center").toLowerCase();
      this.classList.remove("ui-intro--position-center", "ui-intro--position-lower", "ui-intro--position-upper");
      const posClass = position === "lower" ? "lower" : position === "upper" ? "upper" : "center";
      this.classList.add("ui-intro--position-" + posClass);

      // Backdrop: solid (default), dim, none
      const backdrop = (this.getAttribute("backdrop") || "solid").toLowerCase();
      this.classList.remove("ui-intro--backdrop-solid", "ui-intro--backdrop-dim", "ui-intro--backdrop-none");
      const bdClass = backdrop === "dim" ? "dim" : backdrop === "none" ? "none" : "solid";
      this.classList.add("ui-intro--backdrop-" + bdClass);

      const enter = this.getAttribute("enter") || "fade";
      this.classList.remove("ui-intro--enter-fade", "ui-intro--enter-slide-up", "ui-intro--enter-zoom-in", "ui-intro--enter-blur-in");
      this.classList.add(enterClass(enter));
      const fadeInMs = asNumber(this.getAttribute("fade-in-ms"), 550);
      this.style.setProperty("--ui-intro-enter-dur", (fadeInMs / 1000) + "s");
    }

    async play() {
      if (this._playing) return;
      this._playing = true;
      this._applyAttrs();
      const fadeInMs = asNumber(this.getAttribute("fade-in-ms"), 550);
      const fadeOutMs = asNumber(this.getAttribute("fade-out-ms"), 900);
      const duration = asNumber(this.getAttribute("duration"), 3800);
      const holdMs = Math.max(200, duration - fadeInMs - fadeOutMs);
      const subtitleDelay = asNumber(this.getAttribute("subtitle-delay-ms"), 400);
      const showOk = asBool(this.getAttribute("show-ok"), false);
      const autoDismiss = asBool(this.getAttribute("auto-dismiss"), true);
      const speakText = this.getAttribute("speak");
      // Language for TTS: prefer explicit attribute, fall back to the app's
      // configured speech_lang (passed via attribute by the intro block handler),
      // then browser default.
      const speakLang = this.getAttribute("lang") || "";

      this.classList.add("ui-intro--open");

      if (this._els.sub.textContent.trim()) {
        setTimeout(() => this._els.sub.classList.add("ui-intro-subtitle--visible"), subtitleDelay);
      }

      if (showOk) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ui-intro-ok";
        btn.textContent = this.getAttribute("ok-label") || "OK";
        this._els.panel.appendChild(btn);
        const userClicked = new Promise((resolve) => btn.addEventListener("click", () => resolve(), { once: true }));
        await sleep(Math.min(fadeInMs, 500));
        if (speakText) {
          this._speechInProgress = true;
          // Race speech against the user clicking OK — whichever resolves first
          // lets us move on. If user clicks first, speech is still running and
          // _leave will cancel it. If speech finishes first, _speechInProgress
          // is cleared and _leave won't touch the speech engine.
          await Promise.race([
            speakIfAvailable(speakText, { lang: speakLang }).then(() => { this._speechInProgress = false; }),
            userClicked,
          ]);
          // Still wait for the actual click if only speech finished.
          await userClicked;
        } else {
          await userClicked;
        }
        await this._leave(fadeOutMs);
        return;
      }

      await sleep(Math.min(fadeInMs, 800));
      if (speakText) {
        this._speechInProgress = true;
        await speakIfAvailable(speakText, { lang: speakLang });
        this._speechInProgress = false;
      }

      if (!autoDismiss) return; // caller is responsible for dismissing via close()

      // Race hold-time against an explicit abort (set by close()).
      const holdPromise = new Promise((resolve) => {
        this._holdTimer = setTimeout(resolve, holdMs);
        this._abortResolve = resolve;
      });
      await holdPromise;
      await this._leave(fadeOutMs);
    }

    async _leave(fadeOutMs) {
      this.classList.add("ui-intro--leaving");
      await sleep(Math.max(0, fadeOutMs));
      this.classList.remove("ui-intro--open", "ui-intro--leaving");
      // CRITICAL: only cancel speech if our own speech is still running.
      // Calling speechSynthesis.cancel() on an idle engine is a known Chrome
      // anti-pattern: it leaves the engine in a wedged "just-cancelled" state
      // where the next block's speechSynthesis.speak() silently fails — no
      // audio, sometimes no callbacks. In the common autoDismiss path the
      // speech was already awaited before _leave ran, so cancelling is both
      // unnecessary AND harmful to the following write_speak block.
      if (this._speechInProgress) {
        try { if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); } catch (_) {}
        this._speechInProgress = false;
      }
      this._playing = false;
      this.dispatchEvent(new CustomEvent("intro-done", { bubbles: true }));
    }

    close() {
      if (this._holdTimer) {
        clearTimeout(this._holdTimer);
        this._holdTimer = null;
      }
      if (this._abortResolve) {
        const r = this._abortResolve;
        this._abortResolve = null;
        r();
      }
    }

    disconnectedCallback() {
      this.close();
    }
  }

  customElements.define(tagName, UiIntro);
})();
