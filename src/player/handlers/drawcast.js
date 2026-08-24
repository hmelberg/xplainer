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
 * size (px max-width, default 480; shrunk further so the whole figure fits
 * the viewport), style (sketchy|clean; default = drawcast_style lecture
 * default, else clean), speed, location (left|right, drawings default
 * right). Body: YAML (or JSON) spec.
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
    : "./vendor/drawcast/engine.js";
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
        api.state.actionHeartbeat = Date.now();
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
    container.style.margin = "0 auto";
    api.appendToLocation(container, action.location || (api.state && api.state.defaults && api.state.defaults.draw_location) || "right");

    var specText = String(action.content || "");
    var meaningful = specText.split("\n").some(function (l) {
      var t = l.trim();
      return t !== "" && t.charAt(0) !== "#";
    });
    if (!meaningful) {
      var comment = (specText.split("\n").find(function (l) { return l.trim().charAt(0) === "#"; }) || "").trim();
      var compiling = window.XplainerAI && window.XplainerAI.figuresCompiling;
      container.appendChild(errorCard(
        compiling && action.request
          ? 'this figure is still being generated ("' + action.request + '"). Wait for the status line to finish, then press Play again.'
          : comment ? comment.replace(/^#\s*/, "")
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

    // Shrink the figure so the whole thing (title + 4:3 stage + caption
    // strip) fits between its current position and the bottom bar — the
    // stage's height is width * 3/4, so height budget converts to a width cap.
    var rect = container.getBoundingClientRect();
    var bar = document.getElementById("bottomBar");
    var availH = window.innerHeight - rect.top - (bar ? bar.offsetHeight : 0) - 16;
    var chromeH = (loaded.spec && loaded.spec.title ? 34 : 0) + 54;
    var fitWidth = Math.floor((availH - chromeH) * 4 / 3);
    if (fitWidth >= 260 && fitWidth < size) container.style.maxWidth = fitWidth + "px";

    var instant = !!(api.runOpts && api.runOpts.instant);
    var styleArg = action.style || (api.state && api.state.defaults && api.state.defaults.drawcast_style) || "clean";
    var handle;
    try {
      handle = await engine.render(loaded.spec, container, {
        style: styleArg === "sketchy" ? "sketchy" : "clean",
        mode: instant ? "instant" : "narrated",
        speed: parseFloat(action.speed) || (api.state && api.state.speed) || 1,
        speech: makeSpeechAdapter(api, action),
        callbacks: { onStep: function () { api.state.actionHeartbeat = Date.now(); } },
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

    // The container was appended empty and grew after the async mount, so
    // xplainer's append-time scroll fired before there was anything to show.
    if (!instant && typeof container.scrollIntoView === "function") {
      container.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    try {
      await handle.timeline.play();
    } finally {
      if (api.isAborted()) handle.destroy();
    }
  }

  window.Xplainer.actions.register("drawcast", handleDrawcast);
})();
