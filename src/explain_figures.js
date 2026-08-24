/**
 * Stage 2 of AI generation: compile ::: drawcast(request="…") placeholder
 * blocks into full YAML specs using drawcast's compiler pipeline
 * (vendor/drawcast/compiler.js: schema-constrained call → validate → visual
 * lint → capped repairs). Anthropic-only (BYOK or vended key). Pure
 * text-transform helpers live on window.XplainerFigures for tests;
 * explain_ai.js calls compileAll() after a successful generation.
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;

  var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || "";
  var COMPILER_URL = SCRIPT_SRC
    ? new URL("../vendor/drawcast/compiler.js", SCRIPT_SRC).href
    : "vendor/drawcast/compiler.js";

  /**
   * Placeholders = ::: drawcast headers with a request= arg whose body is
   * empty (nothing but blank lines before the next ::: or EOF). Filled
   * bodies — including failure comments — are never placeholders again.
   */
  function findPlaceholders(text) {
    var lines = String(text).split("\n");
    var found = [];
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^:::\s*drawcast\s*\((.*)\)\s*$/);
      if (!m) continue;
      var rq = m[1].match(/request\s*=\s*"((?:[^"\\]|\\.)*)"/) || m[1].match(/request\s*=\s*'((?:[^'\\]|\\.)*)'/);
      if (!rq) continue;
      var end = i + 1;
      var empty = true;
      while (end < lines.length && !/^\s*:::/.test(lines[end])) {
        if (lines[end].trim() !== "") empty = false;
        end++;
      }
      if (empty) found.push({ headerLine: i, bodyStart: i + 1, bodyEnd: end, request: rq[1] });
    }
    return found;
  }

  /** Replace one placeholder's (empty) body span with content; returns new text. */
  function fillBody(text, placeholder, body) {
    var lines = String(text).split("\n");
    var inserted = String(body).replace(/\s+$/, "").split("\n");
    return lines.slice(0, placeholder.bodyStart).concat(inserted, lines.slice(placeholder.bodyEnd)).join("\n");
  }

  /**
   * Compile every placeholder in document order, re-finding after each fill
   * (fills shift line numbers). Failures become a # comment in the block
   * body and compilation continues — the promise NEVER rejects.
   */
  function compileAllWith(compiler, text, opts) {
    var total = findPlaceholders(text).length;
    var done = 0;
    var failed = 0;
    function next(current) {
      var remaining = findPlaceholders(current);
      if (!remaining.length) return Promise.resolve({ text: current, compiled: done - failed, failed: failed });
      var p = remaining[0];
      if (opts.onProgress) opts.onProgress(done, total, p.request);
      return compiler
        .compileFigure(p.request, { apiKey: opts.apiKey, model: opts.model })
        .then(
          function (result) {
            done++;
            if (!result || !result.yaml) {
              failed++;
              return next(fillBody(current, p, "# drawing generation failed: " + ((result && result.error) || "unknown error")));
            }
            return next(fillBody(current, p, result.yaml));
          },
          function (err) {
            done++;
            failed++;
            return next(fillBody(current, p, "# drawing generation failed: " + (err && err.message ? err.message : String(err))));
          }
        );
    }
    return next(String(text));
  }

  function compileAll(text, opts) {
    if (!findPlaceholders(text).length) return Promise.resolve({ text: String(text), compiled: 0, failed: 0 });
    return import(COMPILER_URL).then(function (compiler) {
      return compileAllWith(compiler, text, opts);
    });
  }

  window.XplainerFigures = {
    findPlaceholders: findPlaceholders,
    fillBody: fillBody,
    compileAllWith: compileAllWith,
    compileAll: compileAll,
  };
})();
