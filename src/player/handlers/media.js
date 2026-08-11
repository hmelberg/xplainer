/**
 * Xplainer media handlers — image/img, video, youtube, pdf, svg, html, table.
 *
 * Phase B.3 extraction. Mechanical port from runAction in src/explain_player.js.
 * All shared helpers (createHtmlElement, applyPauseOnClick, applyCssFromSpec,
 * appendToLocation, renderMarkdownBlock, speakText, …) come through api.internal
 * and api.speak.
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (!window.Xplainer || !window.Xplainer.actions) {
    console.warn("[Xplainer.media] core.js must load before handlers/media.js");
    return;
  }
  const actions = window.Xplainer.actions;

  // ---------- :::html ----------
  async function handleHtml(action, api) {
    const { resolveLocation, getColumnForLocation, createHtmlElement,
      applyPauseOnClick, scrollColumnToBottom } = api.internal;
    const loc = resolveLocation(action.location, "left");
    const target = getColumnForLocation(loc);
    const allowHtml = action.allow_html ?? api.state.defaults.allow_html ?? false;
    const spec = { ...action };
    delete spec.type;
    delete spec.location;
    delete spec.allow_html;
    if (!allowHtml) delete spec.html;
    const el = createHtmlElement(spec);
    applyPauseOnClick(el, "html", action);
    target.appendChild(el);
    scrollColumnToBottom(target);
    if (action.speak) await api.speak(action.speak, api.tokenAtStart, action);
  }
  actions.register("html", handleHtml);

  // ---------- :::image / :::img ----------
  async function handleImage(action, api) {
    const { createHtmlElement, applyPauseOnClick, applyCssFromSpec,
      registerElement, renderMarkdownBlock } = api.internal;
    const block = document.createElement("div");
    block.className = "image-block" + (action.startImage ? " start-image-block" : "");
    block.style.width = String(action.block_width ?? api.state.defaults.image_block_width ?? "100%");
    block.style.maxWidth = String(action.block_max_width ?? api.state.defaults.image_block_max_width ?? "100%");
    if (action.startImage) {
      block.style.height = "100%";
      block.style.minHeight = "100%";
      block.style.display = "flex";
      block.style.alignItems = "center";
      block.style.justifyContent = "center";
    }
    const baseImgStyles = action.startImage
      ? {
          width: "auto",
          maxWidth: "100%",
          height: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          borderRadius: action.border_radius ?? action.radius ?? api.state.defaults.image_border_radius ?? "8px",
        }
      : {
          width: action.width ?? api.state.defaults.image_width ?? "100%",
          maxWidth: action.max_width ?? api.state.defaults.image_max_width ?? "100%",
          height: action.height ?? api.state.defaults.image_height ?? "auto",
          maxHeight: action.max_height ?? api.state.defaults.image_max_height ?? "72vh",
          objectFit: action.fit ?? action.object_fit ?? api.state.defaults.image_object_fit ?? "contain",
          borderRadius: action.border_radius ?? action.radius ?? api.state.defaults.image_border_radius ?? "8px",
        };
    const imgStyles = (action.styles && typeof action.styles === "object")
      ? { ...baseImgStyles, ...action.styles }
      : baseImgStyles;
    const img = createHtmlElement({
      tag: "img",
      attrs: { src: action.src, alt: action.alt || "" },
      styles: { display: "block", ...imgStyles },
    });
    const overlay = document.createElement("div");
    overlay.className = "image-overlay";
    block.appendChild(img);
    block.appendChild(overlay);
    applyPauseOnClick(block, "image", action);
    if (action.css) applyCssFromSpec(block, action.css);
    const target = api.appendToLocation(block, action.location);
    if (action.id) {
      registerElement(action.id, { type: "image", container: block, img, overlay });
    }
    if (action.caption) {
      const cap = renderMarkdownBlock(
        action.caption,
        { role: "footnote", muted: true, pause_on_click_type: "image", pause_on_click: action.pause_on_click },
        target
      );
      cap.container.classList.add("figure-footnote");
    }
    if (action.speak) await api.speak(action.speak, api.tokenAtStart, action);
  }
  actions.registerAliases(["image", "img"], handleImage);

  // ---------- :::table ----------
  async function handleTable(action, api) {
    const { renderTableBlock, applyCssFromSpec, updateAllColumns } = api.internal;
    const tableBlock = renderTableBlock(action);
    if (action.css) applyCssFromSpec(tableBlock, action.css);
    const target = api.appendToLocation(tableBlock, action.location);
    if (action.speak) await api.speak(action.speak, api.tokenAtStart, action);
    if (action.caption && target) updateAllColumns();
  }
  actions.register("table", handleTable);

  // ---------- :::svg ----------
  async function handleSvg(action, api) {
    const { resolveLocation, getColumnForLocation, applyPauseOnClick, applyCssFromSpec,
      renderMarkdownBlock, mountSvgString, scrollColumnToBottom, autoDimLatest,
      animateSvgDraw } = api.internal;
    const loc = resolveLocation(action.location, "left");
    const target = getColumnForLocation(loc);
    const wrap = document.createElement("div");
    wrap.className = "svg-block";
    applyPauseOnClick(wrap, "svg", action);
    if (action.css) applyCssFromSpec(wrap, action.css);
    if (action.title) {
      const t = renderMarkdownBlock(
        action.title,
        { role: "title", muted: false, pause_on_click_type: "svg", pause_on_click: action.pause_on_click },
        wrap
      );
      t.container.classList.add("figure-title");
    }
    if (action.subtitle) {
      const s = renderMarkdownBlock(
        action.subtitle,
        { role: "subtitle", muted: true, pause_on_click_type: "svg", pause_on_click: action.pause_on_click },
        wrap
      );
      s.container.classList.add("figure-subtitle");
    }
    const svgInner = document.createElement("div");
    svgInner.className = "svg-block-inner";
    const raw = (action.svg || action.content || "").trim();
    if (raw) {
      const svgText = /^\s*<svg[\s>]/i.test(raw) ? raw : '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' + raw + "</svg>";
      const root = mountSvgString(svgInner, svgText);
      if (root) {
        if (action.width != null) root.setAttribute("width", String(action.width));
        if (action.height != null) root.setAttribute("height", String(action.height));
      }
      wrap.appendChild(svgInner);
    }
    if (action.footnote) {
      const f = renderMarkdownBlock(
        action.footnote,
        { role: "footnote", muted: true, pause_on_click_type: "svg", pause_on_click: action.pause_on_click },
        wrap
      );
      f.container.classList.add("figure-footnote");
    }
    target.appendChild(wrap);
    scrollColumnToBottom(target);
    autoDimLatest(wrap);
    const root = wrap.querySelector(".svg-block-inner svg");
    const shouldAnimate = action.animate ?? api.state.defaults.svg_animate ?? true;
    const waitUntilDrawn = action.wait_until_drawn ?? action.svg_wait_until_drawn ?? api.state.defaults.svg_wait_until_drawn ?? true;
    if (root && shouldAnimate) {
      await new Promise((r) => requestAnimationFrame(r));
      const animOpts = {
        baseDelay: action.svg_base_delay ?? api.state.defaults.svg_base_delay ?? 0,
        stepDelay: action.svg_step_delay ?? api.state.defaults.svg_step_delay ?? 400,
        minDur: action.svg_min_dur ?? api.state.defaults.svg_min_dur ?? 700,
        durPer100px: action.svg_dur_per_100px ?? api.state.defaults.svg_dur_per_100px ?? 220,
        revealText: action.svg_reveal_text ?? api.state.defaults.svg_reveal_text ?? true,
      };
      const totalMs = animateSvgDraw(root, animOpts);
      if (waitUntilDrawn && totalMs > 0) await api.sleep(totalMs, api.tokenAtStart);
    }
    if (action.speak) await api.speak(action.speak, api.tokenAtStart, action);
  }
  actions.register("svg", handleSvg);

  // ---------- :::pdf ----------
  async function handlePdf(action, api) {
    const { createHtmlElement, applyCssFromSpec, applyPauseOnClick, renderMarkdownBlock } = api.internal;
    const src = action.src || action.url || action.href || "";
    if (!src) return;
    const target = api.appendToLocation(createHtmlElement({ tag: "div" }), action.location);
    if (action.css) applyCssFromSpec(target, action.css);
    applyPauseOnClick(target, "pdf", action);
    const titleText = action.title || action.label || action.text || src;
    const showPreview = action.preview !== false;
    const height = action.height || action.preview_height || "360px";
    const link = createHtmlElement({
      tag: "a",
      attrs: { href: src, target: action.target || "_blank", rel: "noopener noreferrer" },
      text: titleText,
      styles: { color: "var(--accent)", display: "inline-block", marginBottom: "6px" },
    });
    target.appendChild(link);
    if (showPreview) {
      const frame = createHtmlElement({
        tag: "iframe",
        attrs: { src, loading: "lazy", title: titleText },
        styles: {
          width: "100%",
          height,
          border: "1px solid rgba(255,255,255,.12)",
          borderRadius: "8px",
          background: "rgba(255,255,255,.02)",
        },
      });
      target.appendChild(frame);
    }
    if (action.caption) {
      const cap = renderMarkdownBlock(
        action.caption,
        { role: "footnote", muted: true, pause_on_click_type: "pdf", pause_on_click: action.pause_on_click },
        target
      );
      cap.container.classList.add("figure-footnote");
    }
  }
  actions.register("pdf", handlePdf);

  // ---------- :::video ----------
  async function handleVideo(action, api) {
    const { createHtmlElement, applyCssFromSpec, applyPauseOnClick, renderMarkdownBlock } = api.internal;
    const video = createHtmlElement({
      tag: "video",
      attrs: {
        src: action.src,
        controls: action.controls !== false ? "true" : undefined,
        poster: action.poster,
      },
      styles: action.styles || { maxWidth: "100%", borderRadius: "8px" },
    });
    applyPauseOnClick(video, "video", action);
    if (action.css) applyCssFromSpec(video, action.css);
    const target = api.appendToLocation(video, action.location);
    if (action.caption) {
      const cap = renderMarkdownBlock(
        action.caption,
        { role: "footnote", muted: true, pause_on_click_type: "video", pause_on_click: action.pause_on_click },
        target
      );
      cap.container.classList.add("figure-footnote");
    }
  }
  actions.register("video", handleVideo);

  // ---------- :::youtube ----------
  // Pull the 11-char video id out of whatever a user is likely to paste: a
  // watch URL, a youtu.be short link, an /embed//shorts//live/ path, or a bare
  // id. Returns "" when nothing looks like an id, so the caller can fall back
  // to using the string as a literal src (e.g. a youtube-nocookie embed URL).
  function extractYoutubeId(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    if (/^[\w-]{11}$/.test(s)) return s;
    let u;
    try {
      u = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s);
    } catch (_) {
      return "";
    }
    if (u.hostname.replace(/^www\./i, "").toLowerCase() === "youtu.be") {
      return u.pathname.slice(1).split("/")[0] || "";
    }
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/\/(?:embed|shorts|live|v)\/([\w-]+)/);
    return m ? m[1] : "";
  }

  async function handleYoutube(action, api) {
    const { createHtmlElement, applyCssFromSpec, applyPauseOnClick, renderMarkdownBlock } = api.internal;
    // id/video_id stay verbatim (unchanged behaviour). url/positional/body get
    // parsed; src remains the literal-embed-URL escape hatch.
    const positional = Array.isArray(action.__positional) ? action.__positional[0] : undefined;
    const loose = action.url ?? positional ?? action.content;
    const looseStr = typeof loose === "string" ? loose.trim() : "";
    const isUrl = /^https?:\/\//i.test(looseStr);
    const explicitId = action.id || action.video_id || "";
    let src = "";
    if (explicitId) {
      src = `https://www.youtube.com/embed/${explicitId}`;
    } else if (isUrl && /\/embed\//.test(looseStr)) {
      // Already an embed URL — keep it verbatim so youtube-nocookie.com and any
      // player params the author set (?start=, ?rel=) survive.
      src = looseStr;
    } else {
      const id = extractYoutubeId(loose);
      if (id) src = `https://www.youtube.com/embed/${id}`;
      else if (isUrl) src = looseStr;
      else src = action.src || "";
    }
    const caption = action.caption ?? action.title;
    if (!src) {
      // Never fail silently: an empty iframe is invisible and looks like the
      // block was ignored. Say so on the board and in the console.
      console.warn("[explainer] youtube block: no video id or URL found", action);
      const warn = renderMarkdownBlock(
        "⚠️ **youtube:** no video id or URL — use `id=VIDEO_ID` or `url=https://www.youtube.com/watch?v=VIDEO_ID`",
        { role: "footnote", muted: true },
        api.internal.getColumnForLocation(api.internal.resolveLocation(action.location, "left"))
      );
      warn.container.classList.add("figure-footnote");
      return;
    }
    const iframe = createHtmlElement({
      tag: "iframe",
      attrs: {
        src,
        title: caption,
        allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
        allowfullscreen: "true",
        loading: "lazy",
      },
      styles: action.styles || { width: "100%", aspectRatio: "16/9", border: "0", borderRadius: "8px" },
    });
    applyPauseOnClick(iframe, "youtube", action);
    if (action.css) applyCssFromSpec(iframe, action.css);
    const target = api.appendToLocation(iframe, action.location);
    if (caption) {
      const cap = renderMarkdownBlock(
        String(caption),
        { role: "footnote", muted: true, pause_on_click_type: "youtube", pause_on_click: action.pause_on_click },
        target
      );
      cap.container.classList.add("figure-footnote");
    }
  }
  actions.register("youtube", handleYoutube);
})();
