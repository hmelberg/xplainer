/**
 * Xplainer.engines — unified entry point for code execution.
 *
 * Right now the player has four near-identical pipelines in explain_player.js:
 *
 *   - Pyodide: runPyodideCode (line ~840) + renderPyodideResult (line ~954)
 *   - webR:    runRCode       (line ~994) + renderRResult       (line ~1072)
 *   - JS:      runJsCode      (line ~1129) + renderJsResult     (line ~1154)
 *   - Brython: ensureBrythonSharedModule (line ~2799) + renderBrythonResult (line ~2998)
 *
 * Each engine has its own load, parse, execute, capture, render dance. Unifying
 * them in one big rewrite would be risky — they each handle subtly different
 * shapes of stdout/stderr, Pyodide micropip auto-install, R package hints, etc.
 *
 * Instead, this file introduces a thin wrapper: `Xplainer.engines.executeCode`.
 * It calls into the legacy functions via the playerApi underscore hooks
 * (`_runPyodideCode`, `_runRCode`, `_runJsCode`, `_renderPyodideResult`, …).
 * New handlers (especially the fx blocks in Step 3 and any future blocks)
 * should target THIS wrapper instead of importing engine internals, so the
 * day we refactor the engines into real modules, only this file needs to
 * change — not every call site.
 *
 * Usage from a handler:
 *
 *   const result = await api.engines.executeCode({
 *     engine: "python",
 *     code:   "import math; math.pi",
 *     render: outputEl,        // optional: auto-renders into this element
 *     autoInstall: true,       // pyodide only
 *     micropipSpecs: [],       // pyodide only
 *   });
 *
 *   // result = { ok: boolean, value?: any, stdout?: string, stderr?: string, error?: Error }
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (window.Xplainer && window.Xplainer.engines && window.Xplainer.engines.executeCode) return;

  function getApi() {
    return window.Xplainer && window.Xplainer.playerApi;
  }

  const SUPPORTED = ["python", "pyodide", "r", "webr", "js", "javascript"];

  async function executeCode(opts) {
    opts = opts || {};
    const engine = String(opts.engine || "").toLowerCase();
    const code = String(opts.code || "");
    const api = getApi();
    if (!api || !api.isReady) {
      return { ok: false, error: new Error("Xplainer playerApi not ready — engines cannot run yet") };
    }
    if (!SUPPORTED.includes(engine)) {
      return { ok: false, error: new Error("Unknown engine: " + engine + ". Supported: " + SUPPORTED.join(", ")) };
    }
    if (!code.trim()) {
      return { ok: true, value: undefined, stdout: "", stderr: "" };
    }

    let result;
    try {
      if (engine === "python" || engine === "pyodide") {
        if (typeof api._runPyodideCode !== "function") throw new Error("pyodide runner not bound");
        result = await api._runPyodideCode(code, opts.autoInstall !== false, opts.micropipSpecs || []);
        if (opts.render) api._renderPyodideResult(result, opts.render, !!opts.append);
      } else if (engine === "r" || engine === "webr") {
        if (typeof api._runRCode !== "function") throw new Error("webR runner not bound");
        result = await api._runRCode(code);
        if (opts.render) api._renderRResult(result, opts.render, !!opts.append);
      } else if (engine === "js" || engine === "javascript") {
        if (typeof api._runJsCode !== "function") throw new Error("JS runner not bound");
        result = await api._runJsCode(code);
        if (opts.render) api._renderJsResult(result, opts.render);
      }
    } catch (err) {
      return { ok: false, error: err };
    }

    // Normalise the result shape across engines. Each legacy runner returns a
    // slightly different object; we expose a single envelope so handlers don't
    // have to branch by engine.
    const normalised = {
      ok: !(result && (result.error || result.err)),
      value: result && (result.value ?? result.result ?? undefined),
      stdout: (result && (result.stdout ?? result.output ?? "")) || "",
      stderr: (result && (result.stderr ?? result.errorOutput ?? "")) || "",
      raw: result,
    };
    if (result && (result.error || result.err)) {
      normalised.error = result.error || result.err;
    }
    return normalised;
  }

  const engines = {
    executeCode,
    supported: SUPPORTED.slice(),
  };

  if (!window.Xplainer) {
    // core.js hasn't loaded yet — stake out the namespace.
    window.Xplainer = { engines };
  } else {
    window.Xplainer.engines = engines;
    // If playerApi already loaded, attach so consumers can use api.engines.
    if (window.Xplainer.playerApi && !window.Xplainer.playerApi.engines) {
      window.Xplainer.playerApi.engines = engines;
    }
  }
})();
