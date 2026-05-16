/**
 * Xplainer interactive handlers — component, webcomponent, comp/web, link,
 * accordion, xplainer_link / tutorial_link.
 *
 * Phase B.6. The comp/web handler is the largest in this group; it:
 *   1. Resolves the tag (with a couple of legacy aliases: chart-data →
 *      comp-chart-data, web-mermaid → comp-mermaid).
 *   2. Waits for any pending js_requirements that might define the tag.
 *   3. Falls back to lazy-loading components/<tag>.js from local or a
 *      configured CDN base.
 *   4. Creates the custom element, copies action kwargs as attributes,
 *      resolves the `into` attribute/property for body content.
 *   5. Optionally centers the element, applies pause-on-click, and appends.
 *
 * CRITICAL: webComponentRegistry is a live mutable reference exposed through
 * api.internal.webComponentRegistry. Property writes here are visible to the
 * rest of the player (and vice versa). Do NOT destructure or snapshot.
 * Similarly, state.webComponentBodyAttrDefaults and state.jsRequirementsPromise
 * must be accessed via api.state.* each time.
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (!window.Xplainer || !window.Xplainer.actions) {
    console.warn("[Xplainer.interactive] core.js must load before handlers/interactive.js");
    return;
  }
  const actions = window.Xplainer.actions;

  // ---------- :::component ----------
  async function handleComponent(action, api) {
    const { loadExplainComponents, applyPauseOnClick, showWaitClickScreen } = api.internal;
    const tag = action.tag;
    if (!tag || !window.customElements) return;
    await loadExplainComponents();
    const Ctor = customElements.get(tag);
    if (!Ctor) {
      console.warn("[explainer] Unknown component tag:", tag);
      return;
    }
    const el = document.createElement(tag);
    const skipKeys = new Set(["type", "tag", "location"]);
    for (const [k, v] of Object.entries(action)) {
      if (skipKeys.has(k) || v === undefined) continue;
      const attr = k.replace(/_/g, "-");
      if (typeof v === "boolean") {
        el.setAttribute(attr, v ? "true" : "false");
      } else if (typeof v === "object" && v !== null && (v.constructor === Object || Array.isArray(v))) {
        try { el.setAttribute(attr, JSON.stringify(v)); } catch (_) {}
      } else {
        el.setAttribute(attr, String(v));
      }
    }
    if (action.content !== undefined && action.content !== "") {
      el.setAttribute("content", String(action.content));
      if ("content" in el) el.content = action.content;
    }
    applyPauseOnClick(el, tag === "ui-flashcard" ? "write" : "component", action);
    api.appendToLocation(el, action.location);
    if (tag === "ui-flashcard") {
      api.state.paused = true;
      await showWaitClickScreen(api.tokenAtStart);
    } else if (action.speak) {
      await api.speak(action.speak, api.tokenAtStart, action);
    }
  }
  actions.register("component", handleComponent);

  // ---------- :::webcomponent ----------
  // Historical no-op: ":::webcomponent" blocks register definitions ahead of time
  // via a separate pre-pass (runWebComponentDefinitions) and have no dispatch
  // side-effect during runAction. Kept registered for documentation parity.
  actions.register("webcomponent", async function handleWebComponentStub(action, api) {
    // intentionally empty
  });

  // ---------- :::comp / :::web ----------
  async function handleComp(action, api) {
    const { loadWebComponentScript, applyPauseOnClick, webComponentRegistry,
      libraryComponentsBase } = api.internal;
    let tag = action.tag && String(action.tag).trim();
    if (!tag || !tag.includes("-")) return;
    if (tag === "chart-data") tag = "comp-chart-data";
    else if (tag === "web-mermaid") tag = "comp-mermaid";
    let meta = webComponentRegistry[tag];
    // External components may be loaded via js_requirements; wait for them before first use.
    if (!meta && api.state.jsRequirementsPromise) {
      await api.state.jsRequirementsPromise;
      meta = webComponentRegistry[tag];
    }
    // Auto-load from local components/ or optional fallback if still not registered.
    if (!meta) {
      const localUrl = new URL("components/" + tag + ".js", document.baseURI).href;
      try {
        await loadWebComponentScript(localUrl);
        if (typeof customElements !== "undefined" && customElements.get(tag)) {
          webComponentRegistry[tag] = { body_attr: "content", shadow: true };
        }
      } catch (_) {
        if (libraryComponentsBase) {
          const base = libraryComponentsBase.replace(/\/?$/, "/");
          const fallbackUrl = base + "components/" + tag + ".js";
          try {
            await loadWebComponentScript(fallbackUrl);
            if (typeof customElements !== "undefined" && customElements.get(tag)) {
              webComponentRegistry[tag] = { body_attr: "content", shadow: true };
            }
          } catch (e2) {
            console.warn("[explainer] Web component not loaded:", tag, e2);
          }
        }
      }
    }
    meta = webComponentRegistry[tag];
    const el = document.createElement(tag);
    const skipKeys = new Set(["type", "tag", "location", "speak", "content", "into", "_bodyText", "center", "centered"]);
    for (const [k, v] of Object.entries(action)) {
      if (skipKeys.has(k) || v === undefined) continue;
      const attr = k.replace(/_/g, "-");
      if (typeof v === "boolean") {
        if (v) el.setAttribute(attr, "true"); else el.removeAttribute(attr);
      } else if (typeof v === "object" && v !== null && (v.constructor === Object || Array.isArray(v))) {
        try { el.setAttribute(attr, JSON.stringify(v)); } catch (_) {}
      } else {
        el.setAttribute(attr, String(v));
      }
    }
    const hasExplicitInto = action.into !== undefined;
    const rawContent = action.content !== undefined && action.content !== "" ? String(action.content).trim() : null;
    const rawBodyText = action._bodyText !== undefined && action._bodyText !== "" ? String(action._bodyText).trim() : null;
    const bodyText = (hasExplicitInto && rawBodyText) ?? rawContent ?? rawBodyText ?? null;
    let intoAttr = hasExplicitInto && action.into !== "" ? String(action.into).trim() : null;
    if (intoAttr === null && bodyText !== null) {
      intoAttr = (meta && meta.body_attr)
        || (api.state.webComponentBodyAttrDefaults && api.state.webComponentBodyAttrDefaults[tag])
        || (tag === "comp-chart" ? "config" : tag === "comp-chart-data" ? "content" : null);
    }
    if (typeof window !== "undefined" && (tag === "comp-chart" || bodyText === null || window.__explainLogWeb)) {
      console.log("[explain player] web action", { tag, bodyTextLen: bodyText ? bodyText.length : 0, intoAttr, hasContent: !!rawContent, hasBodyText: !!rawBodyText });
    }
    if (bodyText !== null && intoAttr !== null) {
      let propVal = bodyText;
      if (intoAttr === "data" && (bodyText.trim().startsWith("[") || bodyText.trim().startsWith("{"))) {
        try {
          const parsed = JSON.parse(bodyText);
          if (Array.isArray(parsed)) propVal = parsed;
        } catch (_) {}
      } else if (intoAttr === "config" && (bodyText.trim().startsWith("[") || bodyText.trim().startsWith("{"))) {
        try {
          const parsed = JSON.parse(bodyText);
          if (parsed && typeof parsed === "object") propVal = parsed;
        } catch (_) {}
      }
      if (intoAttr in el) el[intoAttr] = propVal;
      el.setAttribute(intoAttr, bodyText);
    } else {
      const fallbackBody = (action.content !== undefined && action.content !== "" ? action.content : null) ?? (action._bodyText !== undefined && action._bodyText !== "" ? action._bodyText : null);
      if (fallbackBody !== null) {
        const frag = document.createRange().createContextualFragment(String(fallbackBody));
        el.appendChild(frag);
      }
    }
    applyPauseOnClick(el, "comp", action);
    const shouldCenter = !!(action.center || action.centered);
    const toAppend = shouldCenter
      ? (() => {
          const wrap = document.createElement("div");
          wrap.style.display = "flex";
          wrap.style.justifyContent = "center";
          wrap.style.width = "100%";
          wrap.appendChild(el);
          return wrap;
        })()
      : el;
    api.appendToLocation(toAppend, action.location);
    if (action.speak) await api.speak(action.speak, api.tokenAtStart, action);
  }
  actions.registerAliases(["comp", "web"], handleComp);

  // ---------- :::link ----------
  async function handleLink(action, api) {
    const { createHtmlElement, applyPauseOnClick, applyCssFromSpec } = api.internal;
    const a = createHtmlElement({
      tag: "a",
      attrs: { href: action.href, target: action.target || "_blank", rel: "noopener noreferrer" },
      text: action.text || action.href || "",
      styles: action.styles || { color: "var(--accent)" },
    });
    applyPauseOnClick(a, "link", action);
    if (action.css) applyCssFromSpec(a, action.css);
    api.appendToLocation(a, action.location);
  }
  actions.register("link", handleLink);

  // ---------- :::accordion ----------
  async function handleAccordion(action, api) {
    const { applyPauseOnClick, getMd, processInlineMarkup, applyRoughAnnotations,
      applyMermaidInContainer, applyCssFromSpec } = api.internal;
    const container = document.createElement("div");
    applyPauseOnClick(container, "accordion", action);
    const items = Array.isArray(action.items) ? action.items : [action];
    items.forEach((item) => {
      const details = document.createElement("details");
      if (item.open) details.open = true;
      const summary = document.createElement("summary");
      summary.textContent = item.title || "Details";
      details.appendChild(summary);
      const body = document.createElement("div");
      body.style.marginTop = "6px";
      if (item.markdown) {
        body.innerHTML = getMd().render(item.markdown);
        processInlineMarkup(body);
        applyRoughAnnotations(body);
        applyMermaidInContainer(body);
      } else if (item.text) {
        body.textContent = item.text;
      }
      details.appendChild(body);
      container.appendChild(details);
    });
    if (action.css) applyCssFromSpec(container, action.css);
    api.appendToLocation(container, action.location);
  }
  actions.register("accordion", handleAccordion);

  // ---------- :::xplainer_link / :::tutorial_link (deprecated alias) ----------
  async function handleXplainerLink(action, api) {
    const { applyPauseOnClick, applyCssFromSpec, loadLectureFromReference,
      startPlayback, renderMarkdownBlock } = api.internal;
    const label = action.text || action.title || action.url || "";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tutorial-link";
    btn.textContent = label || "Open explainer";
    btn.style.color = "var(--accent)";
    btn.style.background = "rgba(96,165,250,.12)";
    btn.style.border = "1px solid rgba(147,197,253,.35)";
    btn.style.borderRadius = "999px";
    btn.style.padding = "6px 12px";
    btn.style.margin = "4px 0";
    applyPauseOnClick(btn, "xplainer_link", action);
    if (action.css) applyCssFromSpec(btn, action.css);
    const target = api.appendToLocation(btn, action.location);
    btn.onclick = async () => {
      const raw = action.url || action.href || action.src || "";
      const input = String(raw || "").trim();
      if (!input) return;
      btn.disabled = true;
      btn.textContent = "Loading...";
      try {
        await loadLectureFromReference(input);
        startPlayback();
      } catch (err) {
        console.warn("Failed to load explainer:", err);
        btn.textContent = label || "Open explainer";
        btn.disabled = false;
      }
    };
    if (action.speak) await api.speak(action.speak, api.tokenAtStart, action);
    if (action.caption && target) {
      const cap = renderMarkdownBlock(
        action.caption,
        { role: "footnote", muted: true, pause_on_click_type: "xplainer_link", pause_on_click: action.pause_on_click },
        target,
      );
      cap.container.classList.add("figure-footnote");
    }
  }
  actions.registerAliases(["xplainer_link", "tutorial_link"], handleXplainerLink);
})();
