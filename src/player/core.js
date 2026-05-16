/**
 * Xplainer — action handler registry and player API surface.
 *
 * This file is loaded as a classic <script> BEFORE src/explain_player.js. It installs
 * a global `window.Xplainer` namespace that:
 *
 *   1. Provides an action-handler registry: third-party and built-in code can call
 *      Xplainer.actions.register("myblock", async (action, api) => { ... }) to add
 *      a new `:::myblock` block type without touching the 8k-line dispatch in
 *      explain_player.js.
 *
 *   2. Exposes a player API that registered handlers can use: api.speak(text),
 *      api.sleep(ms), api.clearBoard(), api.els, api.appendToLocation(el, loc),
 *      api.renderMarkdown(text, opts), api.engines.executeCode({engine, code}).
 *
 *      The explain_player.js side wires the real implementations into
 *      Xplainer.playerApi once it has finished initialising — see the
 *      `Xplainer.playerApi.bind(...)` call near the bottom of runAction.
 *
 *   3. Offers a thin dispatch hook: runAction in explain_player.js calls
 *      `await Xplainer.actions.maybeRun(action, tokenAtStart)` at the very top.
 *      If a handler is registered for `action.type`, it runs and returns `true`;
 *      the dispatcher then returns immediately. Otherwise the existing if-chain
 *      continues untouched. This means the refactor is purely additive and cannot
 *      break existing behaviour.
 *
 * The registry is the seam that lets us split code into modules without rewriting
 * the monolith. New blocks (Step 3: celebrate/sound/countdown/reveal), new
 * transitions (Step 4) and the code-execution wrapper (Step 5) all plug in here.
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (window.Xplainer && window.Xplainer.actions) return; // idempotent

  const handlers = new Map();

  const actions = {
    /**
     * Register a handler for `action.type === name`. If a handler with the same
     * name already exists it is replaced (last-write-wins), with a console warning.
     *
     * The handler signature is `async (action, api) => void|boolean`. Returning
     * `false` explicitly asks the dispatcher to fall through to the legacy if-chain
     * (useful for handlers that only want to handle certain sub-cases).
     */
    register(name, handler) {
      if (!name || typeof name !== "string") {
        console.warn("[Xplainer] actions.register called with invalid name:", name);
        return;
      }
      if (typeof handler !== "function") {
        console.warn("[Xplainer] actions.register requires a function for", name);
        return;
      }
      if (handlers.has(name)) {
        console.warn("[Xplainer] action handler for '" + name + "' is being replaced");
      }
      handlers.set(name, handler);
    },

    /** Register the same handler for multiple aliases. */
    registerAliases(names, handler) {
      if (!Array.isArray(names)) return;
      for (const n of names) actions.register(n, handler);
    },

    has(name) {
      return handlers.has(name);
    },

    list() {
      return Array.from(handlers.keys()).sort();
    },

    /**
     * Dispatch hook called from runAction in explain_player.js. Returns a Promise
     * that resolves to `true` if a handler ran and consumed the action, or `false`
     * if the dispatcher should continue with its legacy if-chain.
     */
    async maybeRun(action, tokenAtStart, opts) {
      if (!action || typeof action.type !== "string") return false;
      const handler = handlers.get(action.type);
      if (!handler) return false;
      const api = window.Xplainer.playerApi;
      if (!api || !api.isReady) {
        console.warn("[Xplainer] playerApi not ready, falling through to legacy dispatch for:", action.type);
        return false;
      }
      // Expose the abort token via the api so handlers can check api.isAborted().
      const scopedApi = Object.assign(Object.create(api), {
        tokenAtStart,
        runOpts: opts || {},
        isAborted() {
          return api.getCurrentToken && api.getCurrentToken() !== tokenAtStart;
        },
      });
      const result = await handler(action, scopedApi);
      if (result === false) return false; // handler explicitly asked for fall-through
      return true;
    },
  };

  /**
   * PlayerAPI — placeholder until explain_player.js binds real implementations.
   *
   * explain_player.js calls Xplainer.playerApi.bind({...}) once its helpers are
   * defined. Until then, isReady is false and handlers will fall through.
   */
  const playerApi = {
    isReady: false,
    bind(impl) {
      Object.assign(this, impl, { isReady: true });
      // Engines namespace is populated by src/player/engines/base.js on load,
      // so we don't overwrite it if already present.
      if (!this.engines && window.Xplainer.engines) this.engines = window.Xplainer.engines;
    },
  };

  /**
   * loadScriptOnce — shared lazy-script loader used by fx handlers, the math
   * and rough-notation lazy loaders in explain_player.js, and anything else
   * that needs to pull in a runtime dependency on first use.
   *
   * Gated by a data-xplainer-src attribute so concurrent callers with the same
   * URL share one <script> tag. Resolves on load, rejects on error.
   *
   * Why it lives here (and not in fx.js): explain_player.js needs it before
   * fx.js runs (for ensureMath / ensureRoughNotation), so it has to be
   * attached to the namespace that loads first. core.js is that file.
   */
  function loadScriptOnce(src) {
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
  }

  window.Xplainer = {
    actions,
    playerApi,
    engines: window.Xplainer && window.Xplainer.engines ? window.Xplainer.engines : null,
    loadScriptOnce,
    version: "0.1.0",
  };
})();
