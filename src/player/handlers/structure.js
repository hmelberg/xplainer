/**
 * Xplainer structure handlers — new_page, title, wait, defaults, web_defaults.
 *
 * First file in Phase B's extraction (see .claude/plans/scalable-swimming-nest.md).
 * These are the simplest handlers, chosen first so the extraction pattern can be
 * validated before the harder handlers (write_speak, image, mark, comp, …) follow.
 *
 * Extraction rules (mechanical — the same for every handler):
 *   1. state access is LIVE via api.state.foo — never destructure.
 *   2. Cancel tokens use api.tokenAtStart (the capture), not api.getCurrentToken().
 *   3. Helpers on api.internal.* instead of module-scope closure references.
 *   4. Returning normally consumes the action; returning `false` explicitly asks
 *      the dispatcher to fall through to the legacy if-chain in runAction.
 *
 * The new_page handler ALSO absorbs the transition CSS helper that used to live
 * in src/player/transitions.js. transitions.js no longer registers a handler —
 * it just attaches applyTransition() onto window.Xplainer.transitions, which we
 * call from here. See B.6 in the plan for why: the registry has no handler-chain
 * support, so having two handlers for new_page would mean last-write-wins.
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (!window.Xplainer || !window.Xplainer.actions) {
    console.warn("[Xplainer.structure] core.js must load before handlers/structure.js");
    return;
  }
  const actions = window.Xplainer.actions;

  // ---------- :::defaults / :::default ----------
  async function handleDefaults(action, api) {
    const { applySkinDefaults, extractDefaults, applyThemeDefaults, applyLayout,
      preloadPyodide, startBackgroundRequirements, clearDimAll, autoDimLatest } = api.internal;
    api.state.defaults = applySkinDefaults({ ...api.state.defaults, ...extractDefaults(action) });
    api.state.dimEnabled = !!api.state.defaults.dim;
    if (!api.state.dimEnabled) clearDimAll();
    if (api.state.dimEnabled) autoDimLatest();
    applyThemeDefaults(api.state.defaults);
    applyLayout();
    if (api.state.defaults.pyodide_preload) preloadPyodide();
    startBackgroundRequirements();
  }
  actions.registerAliases(["defaults", "default"], handleDefaults);

  // ---------- :::web_defaults ----------
  async function handleWebDefaults(action, api) {
    if (!api.state.webComponentBodyAttrDefaults) api.state.webComponentBodyAttrDefaults = {};
    if (action.mappings && typeof action.mappings === "object") {
      Object.assign(api.state.webComponentBodyAttrDefaults, action.mappings);
    }
  }
  actions.register("web_defaults", handleWebDefaults);

  // ---------- :::new_page ----------
  // Absorbs the transition decorator from src/player/transitions.js:
  // reads action.transition (falls back to state.defaults.transition), applies
  // the CSS class via window.Xplainer.transitions.applyTransition AFTER the
  // board has been cleared and the next slide's content has been populated.
  // rAF is used so the animation targets the freshly-rendered slide, not the
  // empty board state.
  async function handleNewPage(action, api) {
    api.internal.clearBoard();
    api.internal.setPageTitle(action.title || "", action);
    api.state.currentDrawContext = null;

    const transitionName = String(
      action.transition ?? (api.state.defaults && api.state.defaults.transition) ?? "cut"
    ).toLowerCase();
    if (transitionName && transitionName !== "cut" && transitionName !== "none" &&
        window.Xplainer.transitions && typeof window.Xplainer.transitions.applyTransition === "function") {
      const duration = Number(action.transition_ms || action.duration) || 0;
      const board = api.els.board || api.els.playerWrap || api.els.textContent;
      requestAnimationFrame(() => {
        try { window.Xplainer.transitions.applyTransition(board, transitionName, duration); } catch (err) {
          console.warn("[Xplainer.structure] applyTransition failed:", err);
        }
      });
    }
  }
  actions.register("new_page", handleNewPage);

  // ---------- :::title ----------
  async function handleTitle(action, api) {
    const nextTitle = action.title ?? action.text ?? action.markdown ?? "";
    api.internal.setPageTitle(nextTitle, action);
    if (!api.runOpts.instant && action.speak) {
      await api.speak(action.speak, api.tokenAtStart, action);
    }
  }
  actions.register("title", handleTitle);

  // ---------- :::wait ----------
  async function handleWait(action, api) {
    if (api.runOpts.instant) return;
    const rawSeconds = action.seconds;
    const seconds = typeof rawSeconds === "number" && Number.isFinite(rawSeconds)
      ? rawSeconds
      : (typeof rawSeconds === "string" && /^\d+(\.\d+)?$/.test(rawSeconds) ? Number(rawSeconds) : 0);
    if (seconds > 0) {
      await api.sleep((seconds * 1000) / api.state.speed, api.tokenAtStart);
      return;
    }
    // Backward-compatibility: treat numeric wait= as timed wait when seconds is not provided.
    const rawWait = action.wait;
    const legacyWaitSeconds = typeof rawWait === "number" && Number.isFinite(rawWait)
      ? rawWait
      : (typeof rawWait === "string" && /^\d+(\.\d+)?$/.test(rawWait) ? Number(rawWait) : 0);
    if (legacyWaitSeconds > 0) {
      await api.sleep((legacyWaitSeconds * 1000) / api.state.speed, api.tokenAtStart);
      return;
    }
    // Default wait behavior: show continue button and pause until clicked.
    await api.internal.waitForClick(
      action.wait_label || action.label || "Continue",
      action.location || "right",
      api.tokenAtStart,
    );
  }
  actions.register("wait", handleWait);
})();
