/**
 * Xplainer diagrams & sketch handlers — mermaid, p5 / p5js, p5_control.
 *
 * Phase B.5. Mermaid uses the renderMermaidDiagram helper which lazily imports
 * the mermaid library; p5 leans on createP5FromAction which handles lazy-loading
 * of p5.js itself. Both engines stay lazy — this file just wraps the dispatch.
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (!window.Xplainer || !window.Xplainer.actions) {
    console.warn("[Xplainer.diagrams] core.js must load before handlers/diagrams.js");
    return;
  }
  const actions = window.Xplainer.actions;

  // ---------- :::mermaid ----------
  async function handleMermaid(action, api) {
    const { renderMermaidDiagram, applyPauseOnClick } = api.internal;
    const wrapper = await renderMermaidDiagram(action.code || action.text || "", {
      maxWidth: action.max_width || "100%",
      center: action.center !== false,
    });
    if (wrapper) {
      applyPauseOnClick(wrapper, "mermaid", action);
      api.appendToLocation(wrapper, action.location);
    }
    if (action.speak) await api.speak(action.speak, api.tokenAtStart, action);
  }
  actions.register("mermaid", handleMermaid);

  // ---------- :::p5 / :::p5js ----------
  async function handleP5(action, api) {
    const { createP5FromAction, isMovieMode, waitForClick } = api.internal;
    const entry = await createP5FromAction(action, api.tokenAtStart, api.runOpts);
    if (!entry) return;
    if (action.speak) await api.speak(action.speak, api.tokenAtStart, action);
    const waitAfter = action.wait_after ?? api.state.defaults.p5_wait_after ?? false;
    if (waitAfter && !api.runOpts.instant) {
      if (isMovieMode()) {
        const sec = action.movie_seconds ?? api.state.defaults.movie_wait_seconds ?? 2;
        await api.sleep(sec * 1000, api.tokenAtStart);
      } else {
        await waitForClick(action.wait_label, action.wait_location || "right", api.tokenAtStart);
      }
      const clearPage = action.new_page ?? action.clear_page ?? action.code_new_page
        ?? api.state.defaults.code_new_page ?? api.state.defaults.p5_clear_page ?? false;
      if (clearPage) api.clearBoard();
    }
  }
  actions.registerAliases(["p5", "p5js"], handleP5);

  // ---------- :::p5_control ----------
  async function handleP5Control(action, api) {
    const { createP5FromAction, removeP5Instance } = api.internal;
    const id = action.id;
    const entry = api.state.p5Instances && api.state.p5Instances.get(id);
    if (!entry) return;
    const inst = entry.instance;
    const cmd = (action.action || action.cmd || "toggle").toLowerCase();
    if (cmd === "pause" || cmd === "stop") inst.noLoop();
    else if (cmd === "play" || cmd === "start") inst.loop();
    else if (cmd === "toggle") {
      const looping = inst.isLooping ? inst.isLooping() : true;
      if (looping) inst.noLoop(); else inst.loop();
    } else if (cmd === "reset") {
      const resetAction = { ...entry.action, clear_page: false };
      removeP5Instance(id);
      await createP5FromAction(resetAction, api.tokenAtStart, { instant: false });
    } else if (cmd === "remove") {
      removeP5Instance(id);
    }
  }
  actions.register("p5_control", handleP5Control);
})();
