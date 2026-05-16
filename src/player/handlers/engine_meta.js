/**
 * Xplainer engine meta handlers — pyodide_preload.
 *
 * Phase B.7. This is the only Tier 1/2 handler in the "engine" family; the
 * actual python / r / js / brython / pyodide handlers remain in runAction for
 * now (they're Tier 3 and need engine unification first — see the plan's
 * out-of-scope section).
 *
 * :::pyodide_preload just kicks off a background Pyodide fetch so the first
 * :::python block starts faster. It's fire-and-forget; the handler returns
 * immediately and doesn't await anything.
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (!window.Xplainer || !window.Xplainer.actions) {
    console.warn("[Xplainer.engine_meta] core.js must load before handlers/engine_meta.js");
    return;
  }
  window.Xplainer.actions.register("pyodide_preload", async function handlePyodidePreload(action, api) {
    api.internal.preloadPyodide();
  });
})();
