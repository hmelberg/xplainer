/**
 * Xplainer annotation & drawing handlers — dim, no_dim, new_drawing, draw,
 * mark, mark_image, annotate.
 *
 * Phase B.4. Also absorbs the `underline / move / rotate / change / delete`
 * element-mutation dispatch — those aren't separate action types in runAction
 * but share the same dispatcher (uses getTargetIds). Kept in annotation.js
 * because they all mutate existing elements registered via registerElement.
 *
 * Rough-notation is now always lazy (see Phase A.4) — the mark/annotate/
 * mark_image handlers call api.internal.ensureRoughNotation() before
 * touching window.RoughNotation. applyRoughAnnotations handles its own lazy
 * loading via a fire-and-forget retry.
 *
 * state.currentDrawContext is module-scoped mutable state shared with
 * new_page (structure.js) which resets it to null. MUST be accessed through
 * api.state.currentDrawContext (live reference), not destructured.
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (!window.Xplainer || !window.Xplainer.actions) {
    console.warn("[Xplainer.annotation] core.js must load before handlers/annotation.js");
    return;
  }
  const actions = window.Xplainer.actions;

  // ---------- :::dim ----------
  async function handleDim(action, api) {
    const { getFocusableElements, parseIndexSpec, setDimForIndices } = api.internal;
    const elements = getFocusableElements();
    if (!elements.length) return;
    const indices = parseIndexSpec(
      action.index ?? action.indices ?? action.slice ?? action.range ?? action.text ?? action.value,
      elements.length,
    );
    if (!indices || !indices.length) {
      setDimForIndices([elements.length - 1], true);
    } else {
      setDimForIndices(indices, true);
    }
    api.state.dimEnabled = true;
  }
  actions.register("dim", handleDim);

  // ---------- :::no_dim ----------
  async function handleNoDim(action, api) {
    const { getFocusableElements, parseIndexSpec, clearDimAll, undimIndices } = api.internal;
    const elements = getFocusableElements();
    if (!elements.length) return;
    const indices = parseIndexSpec(
      action.index ?? action.indices ?? action.slice ?? action.range ?? action.text ?? action.value,
      elements.length,
    );
    if (!indices || !indices.length) {
      clearDimAll();
      api.state.dimEnabled = false;
      return;
    }
    undimIndices(indices);
  }
  actions.register("no_dim", handleNoDim);

  // ---------- :::underline / :::move / :::rotate / :::change / :::delete ----------
  // These share a single dispatch path in the legacy if-chain. They target
  // previously-registered elements by id and mutate them (e.g. redraw with a
  // new underline, move to a new location, rotate).
  async function handleElementMutation(action, api) {
    const { getTargetIds, getElement, applyUnderline, applyMove, applyRotate,
      applyChange, applyDelete } = api.internal;
    const ids = getTargetIds(action);
    for (const id of ids) {
      const reg = getElement(id);
      if (!reg) continue;
      if (action.type === "underline") applyUnderline(reg, action.color);
      if (action.type === "move") applyMove(reg, action);
      if (action.type === "rotate") applyRotate(reg, action);
      if (action.type === "change") applyChange(reg, action);
      if (action.type === "delete") applyDelete(id, reg);
    }
  }
  actions.registerAliases(["underline", "move", "rotate", "change", "delete"], handleElementMutation);

  // ---------- :::new_drawing ----------
  async function handleNewDrawing(action, api) {
    const { resolveLocation, getColumnForLocation, renderMarkdownBlock, createDrawBlock } = api.internal;
    const location = resolveLocation(action.location, api.state.defaults.draw_location || "right");
    const targetColumn = getColumnForLocation(location);
    if (action.title) {
      const t = renderMarkdownBlock(
        action.title,
        { role: "title", muted: false, pause_on_click_type: "draw", pause_on_click: action.pause_on_click },
        targetColumn
      );
      t.container.classList.add("figure-title");
    }
    if (action.subtitle) {
      const s = renderMarkdownBlock(
        action.subtitle,
        { role: "subtitle", muted: true, pause_on_click_type: "draw", pause_on_click: action.pause_on_click },
        targetColumn
      );
      s.container.classList.add("figure-subtitle");
    }
    api.state.currentDrawContext = createDrawBlock(
      action.size ?? api.state.defaults.draw_height_px ?? 160,
      targetColumn,
      { id: action.id, padding: action.padding, max_width_px: action.max_width_px,
        pause_on_click: action.pause_on_click, pause_on_click_type: "draw" }
    );
    if (action.footnote) {
      const f = renderMarkdownBlock(
        action.footnote,
        { role: "footnote", muted: true, pause_on_click_type: "draw", pause_on_click: action.pause_on_click },
        targetColumn
      );
      f.container.classList.add("figure-footnote");
    }
  }
  actions.register("new_drawing", handleNewDrawing);

  // ---------- :::draw ----------
  async function handleDraw(action, api) {
    const { resolveLocation, getColumnForLocation, createDrawBlock, runDrawCommand } = api.internal;
    if (!api.state.currentDrawContext) {
      const location = resolveLocation(action.location, api.state.defaults.draw_location || "right");
      const targetColumn = getColumnForLocation(location);
      // Prefer the block-level `size=` attribute (spread onto every command by
      // the parser) over the global draw_height_px default.
      api.state.currentDrawContext = createDrawBlock(
        action.size ?? api.state.defaults.draw_height_px ?? 160,
        targetColumn,
        { padding: action.padding, max_width_px: action.max_width_px,
          pause_on_click: action.pause_on_click, pause_on_click_type: "draw" }
      );
    }
    const drawContext = api.state.currentDrawContext;
    const drawOpts = {
      speed: action.draw_speed_sec_per_100 ?? api.state.defaults.draw_speed_sec_per_100 ?? 1.0,
      animate: api.runOpts.instant ? false : (action.animate ?? api.state.defaults.draw_animate ?? true),
      stroke_width: action.stroke_width ?? api.state.defaults.stroke_width ?? 1.8,
      draw_stroke_alpha: action.draw_stroke_alpha ?? api.state.defaults.draw_stroke_alpha ?? 0.85,
    };
    if (api.tokenAtStart !== api.state.cancelToken) return;
    const cmd = { ...action };
    delete cmd.type;
    await runDrawCommand(cmd, api.tokenAtStart, drawContext, drawOpts);
  }
  actions.register("draw", handleDraw);

  // ---------- :::mark ----------
  async function handleMark(action, api) {
    await api.internal.ensureRoughNotation();
    if (!window.RoughNotation) return;
    const { resolveMarkTarget, resolveMarkColor, runWholeElementMark,
      runCodeHighlight, runTableAnnotate, runTextAnnotate } = api.internal;
    const resolved = resolveMarkTarget(action);
    if (!resolved) {
      console.warn("No mark target found.");
      return;
    }
    const markColor = resolveMarkColor(
      action.color ?? api.state.defaults.mark_color ?? "yellow",
      action.mark_opacity ?? api.state.defaults.mark_opacity ?? 0.95,
    );
    const hasTextOrLine = !!(action.text || action.code_text || action.line || action.line_start || action.line_end);
    const markAction = {
      ...action,
      color: markColor,
      permanent: !!action.permanent || action.temporary === false,
      duration: action.duration ?? action.seconds,
      speak: action.speak,
      text: action.text ?? action.code_text,
      code_text: action.code_text ?? action.text,
    };
    const isWhole = !hasTextOrLine;
    if (isWhole) {
      const containerEl = resolved.type === "code" ? (resolved.entry?.wrap || resolved.el) : resolved.el;
      if (!containerEl) {
        console.warn("No container for whole-element mark.");
        return;
      }
      const wholeAction = { ...markAction, effect: markAction.effect || "circle" };
      await runWholeElementMark(containerEl, wholeAction, api.tokenAtStart, api.runOpts);
      return;
    }
    if (resolved.type === "code") {
      if (!resolved.entry) {
        console.warn("No code entry for mark target.");
        return;
      }
      const idx = api.state.codeCells.indexOf(resolved.entry);
      markAction.location = idx < 0 ? -1 : -(api.state.codeCells.length - idx);
      await runCodeHighlight(markAction, api.tokenAtStart, api.runOpts);
    } else if (resolved.type === "table") {
      await runTableAnnotate(resolved.el, markAction, api.tokenAtStart, api.runOpts);
    } else {
      await runTextAnnotate(resolved.el, markAction, api.tokenAtStart, api.runOpts);
    }
  }
  actions.register("mark", handleMark);

  // ---------- :::mark_image ----------
  async function handleMarkImage(action, api) {
    await api.internal.runImageMark(action, api.tokenAtStart, api.runOpts);
  }
  actions.register("mark_image", handleMarkImage);

  // ---------- :::annotate ----------
  async function handleAnnotate(action, api) {
    await api.internal.ensureRoughNotation();
    if (!window.RoughNotation) return;
    const { getElement, runTextAnnotate, runTableAnnotate, runCodeHighlight,
      resolveCodeCell, pickElementByLocation, pickLatestElement, getAnnotateText } = api.internal;
    if (action.id) {
      const reg = getElement(action.id);
      const baseEl = reg?.container || reg?.el || null;
      if (!baseEl) return;
      await runTextAnnotate(baseEl, action, api.tokenAtStart, api.runOpts);
      return;
    }

    const targetOverride = String(action.target || action.annotate_target || "").toLowerCase();
    if (targetOverride) {
      if (targetOverride === "code") {
        const entry = resolveCodeCell(action.location);
        if (!entry) {
          console.warn("No code cell found for annotate target=code.");
          return;
        }
        const text = getAnnotateText(action);
        if (!text && !action.line && !action.line_start && !action.line_end) {
          console.warn("annotate target=code needs text or line/line_start/line_end.");
          return;
        }
        await runCodeHighlight({
          ...action,
          code_text: action.code_text ?? text ?? "",
        }, api.tokenAtStart, api.runOpts);
        return;
      }
      if (targetOverride === "table") {
        const table = pickElementByLocation(".table-block", action.location);
        if (!table) {
          console.warn("No table found for annotate target=table.");
          return;
        }
        await runTableAnnotate(table, action, api.tokenAtStart, api.runOpts);
        return;
      }
      if (targetOverride === "text") {
        const baseEl = pickElementByLocation(".line", action.location);
        if (!baseEl) return;
        await runTextAnnotate(baseEl, action, api.tokenAtStart, api.runOpts);
        return;
      }
    }

    const latest = pickLatestElement([".code-input-wrap", ".table-block", ".line"]);
    if (!latest) return;

    if (latest.classList.contains("code-input-wrap")) {
      const entry = api.state.codeCells.find((item) => item.wrap === latest);
      if (!entry) return;
      const text = getAnnotateText(action);
      if (!text && !action.line && !action.line_start && !action.line_end) {
        console.warn("annotate on code needs text or line/line_start/line_end.");
        return;
      }
      const idx = api.state.codeCells.indexOf(entry);
      await runCodeHighlight({
        ...action,
        code_text: action.code_text ?? text ?? "",
        location: -(api.state.codeCells.length - idx),
      }, api.tokenAtStart, api.runOpts);
      return;
    }

    if (latest.classList.contains("table-block")) {
      await runTableAnnotate(latest, action, api.tokenAtStart, api.runOpts);
      return;
    }

    await runTextAnnotate(latest, action, api.tokenAtStart, api.runOpts);
  }
  actions.register("annotate", handleAnnotate);
})();
