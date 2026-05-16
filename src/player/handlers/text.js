/**
 * Xplainer text handlers — write, write_speak, speak, message.
 *
 * Phase B.2 extraction. write/write_speak is the single most common block
 * type, so this file is hot path — every narration beat runs through here.
 * Port is near-verbatim from the runAction if-chain; the only changes are
 * closure refs rewritten as api.internal.* / api.state.* / api.speak and
 * tokenAtStart threaded through as api.tokenAtStart.
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (!window.Xplainer || !window.Xplainer.actions) {
    console.warn("[Xplainer.text] core.js must load before handlers/text.js");
    return;
  }
  const actions = window.Xplainer.actions;

  // ---------- :::speak ----------
  async function handleSpeak(action, api) {
    if (api.runOpts.instant) return;
    const { parseWriteSpeakChunk, resolveLocation, getColumnForLocation,
      renderMarkdownBlock, scrollColumnToBottom, speakTextPlan } = api.internal;
    const raw = action.text || action.speak_text || "";
    const parsed = parseWriteSpeakChunk(raw, { defaultWrite: false, defaultSpeak: true });
    if (parsed.write.trim()) {
      const loc = resolveLocation(action.location, "left");
      const target = getColumnForLocation(loc);
      renderMarkdownBlock(parsed.write_markup || parsed.write, { ...action, pause_on_click_type: "speak" }, target);
      scrollColumnToBottom(target);
    }
    if (parsed.speak_plan && parsed.speak_plan.length) {
      await speakTextPlan(parsed.speak_plan, api.tokenAtStart, action);
    } else {
      await api.speak(parsed.speak, api.tokenAtStart, action);
    }
  }
  actions.register("speak", handleSpeak);

  // ---------- :::write / :::write_speak ----------
  // Near-verbatim port. The write loop splits markdown into chunks, renders each
  // via renderMarkdownBlock, then either animates the reveal solo (write) or in
  // parallel with narration (write_speak). Typewriter mode defers rough-notation
  // annotations until after the reveal completes so ink doesn't appear before
  // the text underneath it.
  async function handleWrite(action, api) {
    const { parseWriteSpeakChunk, splitWriteText, resolveWriteSpeakMode,
      extractMarkdownHeadlines, markdownToText, renderMarkdownBlock,
      resolveLocation, getColumnForLocation, animateWriteReveal,
      applyRoughAnnotations, speakText, speakTextPlan } = api.internal;
    const loc = resolveLocation(action.location, "left");
    const target = getColumnForLocation(loc);
    const markdown = action.markdown || "";
    const split = action.split ?? api.state.defaults.write_split ?? false;
    const splitMode = action.split_mode ?? api.state.defaults.write_split_mode ?? "paragraph";
    const effect = action.write_effect ?? action.effect ?? api.state.defaults.write_effect ?? "fade";
    const effectName = String(effect).toLowerCase();
    const shouldSplit = split;
    const chunks = shouldSplit ? splitWriteText(markdown, splitMode) : [markdown];
    const reveal = effectName === "typewriter" ? "typewriter" : "appear";
    const writeSpeakMode = action.type === "write_speak" ? resolveWriteSpeakMode(action) : "all";
    let spokeOnce = false;
    let prevListItem = false;
    let prevChunk = false;
    const listSpeed = action.list_speed_multiplier ?? api.state.defaults.write_list_speed_multiplier;

    for (const chunk of chunks) {
      const parseOpts = action.type === "write" ? { defaultSpeak: false } : {};
      const parsed = parseWriteSpeakChunk(chunk, parseOpts);
      const writeChunk = parsed.write;
      const writeChunkMarkup = parsed.write_markup || writeChunk;
      const speakChunk = parsed.speak;
      const isListItem = /^(\s*[-*+]\s+|\s*\d+[.)]\s+)/.test(writeChunk);
      const listOpts = isListItem ? { list_item: true, list_continued: prevListItem } : {};
      const contOpts = prevChunk ? { continued: true } : {};
      prevListItem = isListItem;
      prevChunk = true;
      const deferAnnotations = reveal === "typewriter";
      const block = renderMarkdownBlock(
        writeChunkMarkup,
        { ...action, ...listOpts, ...contOpts, defer_annotations: deferAnnotations, pause_on_click_type: action.type },
        target
      );
      if (api.runOpts.instant) continue;
      if (reveal === "typewriter" && api.els.textViewport) {
        const blockRect = block.container.getBoundingClientRect();
        const viewportRect = api.els.textViewport.getBoundingClientRect();
        if (blockRect.height > viewportRect.height * 0.6) {
          block.container.scrollIntoView({ block: "start", behavior: "smooth" });
        }
      }
      const speedOverride = (isListItem && typeof listSpeed === "number")
        ? { write_speed_chars_per_sec: (action.write_speed_chars_per_sec ?? api.state.defaults.write_speed_chars_per_sec ?? 35) * listSpeed }
        : {};
      if (action.type === "write_speak") {
        const explicitSpeak = action.speak_text || action.text;
        const headlineSpeak = extractMarkdownHeadlines(writeChunk);
        const computedSpeak = writeSpeakMode === "headlines"
          ? headlineSpeak
          : (speakChunk || markdownToText(speakChunk || ""));
        const speakTextValue = spokeOnce && explicitSpeak ? "" : (explicitSpeak || computedSpeak);
        spokeOnce = spokeOnce || !!explicitSpeak;
        const speakPromise = (() => {
          if (!speakTextValue) return Promise.resolve();
          if (explicitSpeak || writeSpeakMode === "headlines") {
            return speakText(speakTextValue, api.tokenAtStart, { ...action, speak_markdown: true });
          }
          if (parsed.speak_plan && parsed.speak_plan.length) {
            return speakTextPlan(parsed.speak_plan, api.tokenAtStart, { ...action, speak_markdown: true });
          }
          return speakText(speakTextValue, api.tokenAtStart, { ...action, speak_markdown: true });
        })();
        await Promise.all([
          speakPromise,
          animateWriteReveal(block.container, block.plainText, api.tokenAtStart, { ...action, reveal, ...speedOverride }),
        ]);
        if (deferAnnotations) applyRoughAnnotations(block.container);
      } else {
        await animateWriteReveal(block.container, block.plainText, api.tokenAtStart, { ...action, reveal, ...speedOverride });
        if (deferAnnotations) applyRoughAnnotations(block.container);
        if (action.type === "write" && speakChunk.trim()) {
          if (parsed.speak_plan && parsed.speak_plan.length) {
            await speakTextPlan(parsed.speak_plan, api.tokenAtStart, { ...action, speak_markdown: true });
          } else {
            await speakText(speakChunk, api.tokenAtStart, { ...action, speak_markdown: true });
          }
        }
      }
    }
  }
  actions.registerAliases(["write", "write_speak"], handleWrite);

  // ---------- :::message ----------

  // Named icon lookup for ::: message(icon=...). Keys should be lowercase,
  // snake_case-friendly names. Authors can also pass a literal emoji in the
  // icon= argument and it'll be used verbatim.
  const MESSAGE_ICON_MAP = {
    // Level defaults (also used when no icon= is given)
    info: "ℹ️", warn: "⚠️", warning: "⚠️", error: "⛔", note: "📝",
    // Status & feedback
    check: "✅", success: "✅", ok: "✅", done: "✅",
    cross: "❌", fail: "❌", no: "❌",
    question: "❓", ask: "❓", help: "❓",
    // Medical / health
    pill: "💊", drug: "💊", medicine: "💊",
    heart: "❤️", heartbeat: "💓",
    hospital: "🏥", stethoscope: "🩺",
    dna: "🧬", microbe: "🦠", virus: "🦠",
    // Knowledge & ideas
    bulb: "💡", lightbulb: "💡", idea: "💡", tip: "💡",
    book: "📖", study: "📖", read: "📖",
    brain: "🧠", think: "🧠",
    // Content & tools
    link: "🔗", url: "🔗",
    doc: "📄", document: "📄", file: "📄", paper: "📄",
    folder: "📁",
    chart: "📊", graph: "📊", stats: "📊",
    calendar: "📅", date: "📅",
    clock: "⏰", time: "⏰",
    pin: "📌", pushpin: "📌",
    flag: "🚩", milestone: "🚩",
    // Security
    lock: "🔒", secure: "🔒",
    key: "🔑",
    shield: "🛡️",
    // Emphasis & drama
    star: "⭐", favorite: "⭐",
    fire: "🔥", hot: "🔥",
    rocket: "🚀", launch: "🚀",
    sparkles: "✨", magic: "✨",
    gear: "⚙️", cog: "⚙️", settings: "⚙️",
    // Misc
    eye: "👁️", watch: "👁️", see: "👁️",
    ear: "👂", listen: "👂",
    speech: "💬", chat: "💬", comment: "💬",
    zap: "⚡", bolt: "⚡",
    tool: "🔧", wrench: "🔧", fix: "🔧",
    bell: "🔔", alert: "🔔",
    money: "💰", cost: "💰", price: "💰",
    globe: "🌐", world: "🌐",
  };

  function resolveMessageIcon(iconArg, level) {
    // 1. Explicit icon= argument: try name lookup, else use as-is (emoji or text).
    if (iconArg != null && String(iconArg).trim()) {
      const key = String(iconArg).trim().toLowerCase();
      if (MESSAGE_ICON_MAP[key]) return MESSAGE_ICON_MAP[key];
      // Not a known name — use the raw value (author may have passed an emoji).
      return String(iconArg);
    }
    // 2. No icon= given: pick based on level.
    const lv = (level || "info").toLowerCase();
    if (lv === "warn" || lv === "warning") return MESSAGE_ICON_MAP.warn;
    if (lv === "error") return MESSAGE_ICON_MAP.error;
    if (lv === "note") return MESSAGE_ICON_MAP.note;
    return MESSAGE_ICON_MAP.info;
  }

  async function handleMessage(action, api) {
    const { resolveLocation, getColumnForLocation, applyPauseOnClick,
      getMd, processInlineMarkup, scrollColumnToBottom } = api.internal;
    const loc = resolveLocation(action.location, "left");
    const target = getColumnForLocation(loc);
    const level = (action.level || "info").toLowerCase();
    const msg = document.createElement("div");
    msg.className = `msg ${level}`;
    applyPauseOnClick(msg, "message", action);
    const icon = document.createElement("span");
    icon.className = "icon";
    icon.textContent = resolveMessageIcon(action.icon, level);
    const textRaw = action.text || action.markdown || "";
    const text = document.createElement("div");
    text.className = "msg-body md";
    if (textRaw.trim()) {
      text.innerHTML = getMd().render(textRaw.trim());
      processInlineMarkup(text);
    }
    msg.appendChild(icon);
    msg.appendChild(text);
    target.appendChild(msg);
    scrollColumnToBottom(target);
    if (action.speak) await api.speak(action.speak, api.tokenAtStart, action);
  }
  actions.register("message", handleMessage);
})();
