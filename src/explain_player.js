/* ---------------- Player implementation ---------------- */

// Boot timing. Paired with a console.info just before state.pages = buildPages()
// near the bottom of this file. `[xplainer] boot NN ms` in the console lets us
// measure Phase A's startup savings empirically.
const __xplainerBootStart = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();

let lecture = null;
const webComponentRegistry = {};
const baseDefaults = window.explainDefaults ? structuredClone(window.explainDefaults) : {};
let lectureDefaults = {};
let initialDefaults = { ...baseDefaults };

/**
 * isLazy(feature) — consult the lecture-level ::: defaults(lazy=...) flag.
 *
 * Authors opt into lazy loading of optional runtime dependencies by writing
 * e.g. `::: defaults(lazy=math)` or `::: defaults(lazy="math,rough")` at the
 * top of their .txt file. `lazy=all` defers everything lazy-able.
 *
 * Supported features (so far): "math" (KaTeX + markdown-it-texmath),
 * "rough" (rough-notation). Callers: ensureMath() / lectureNeedsMath() /
 * ensureRoughNotation() below.
 *
 * NOTE: this reads state.defaults at call time (not at script load), so the
 * flag only takes effect after resetForLecture() has applied the lecture's
 * defaults block. That's intentional — boot-time code should NOT consult
 * isLazy() because state.defaults isn't populated yet when the player script
 * first executes.
 */
function isLazy(feature) {
  try {
    const raw = state && state.defaults && state.defaults.lazy;
    if (!raw) return false;
    const list = String(raw).toLowerCase().split(/[,\s]+/).filter(Boolean);
    return list.includes("all") || list.includes(feature);
  } catch {
    return false;
  }
}

/**
 * md — markdown-it instance. Built lazily via getMd() so that lectures with
 * `lazy=math` can construct an md WITHOUT the texmath plugin and never load
 * KaTeX. The math plan in A.3 walks the lecture at parse time, decides if
 * math is needed, and (if yes) awaits ensureMath() BEFORE any block renders.
 * Once ensureMath() resolves, `md` is rebuilt with texmath and all downstream
 * md.render() calls just work — they never have to become async themselves.
 */
let md = null;
let mdMathEnabled = false;
function buildMd(withMath) {
  const m = window.markdownit({ html: true, linkify: true, typographer: true });
  if (withMath && window.texmath && window.katex) {
    return m.use(window.texmath, {
      engine: window.katex,
      delimiters: ["dollars", "brackets"],
      katexOptions: { throwOnError: false },
    });
  }
  return m;
}
function getMd() {
  if (!md) {
    // At script load, isLazy() can't see the lecture's `lazy=math` flag yet
    // (state.defaults is empty until a lecture is parsed). So the default
    // boot behavior is: build md WITH math if texmath+katex are present
    // (they are, because index.html eagerly loads them). Lectures that set
    // lazy=math + run resetForLecture() replace md via buildMd(false) before
    // any block renders; see the math handling inside resetForLecture.
    md = buildMd(!!(window.texmath && window.katex));
    if (md !== buildMd(false)) mdMathEnabled = true;
  }
  return md;
}

/**
 * ensureMath() — on-demand loader for KaTeX + markdown-it-texmath. Called by
 * resetForLecture() when a lecture both (a) sets lazy=math and (b) actually
 * contains math. Idempotent; safe to call multiple times.
 */
async function ensureMath() {
  if (mdMathEnabled) return;
  if (!window.Xplainer || !window.Xplainer.loadScriptOnce) {
    console.warn("[xplainer] ensureMath called before Xplainer.loadScriptOnce is available — math will fail to render");
    return;
  }
  if (!window.katex) {
    await window.Xplainer.loadScriptOnce("https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js");
  }
  if (!window.texmath) {
    await window.Xplainer.loadScriptOnce("https://cdn.jsdelivr.net/npm/markdown-it-texmath@1.0.0/texmath.min.js");
  }
  md = buildMd(true);
  mdMathEnabled = true;
}

/**
 * lectureNeedsMath(lecture) — scans a parsed lecture for math content so
 * resetForLecture() can decide whether to await ensureMath() before playback.
 * Errs on the side of false positives (loads math if any `$...$` pattern
 * shows up in block text — including inside code blocks). Harmless false
 * positives; silent missed math is the thing we want to avoid.
 */
function lectureNeedsMath(lecture) {
  if (!lecture || !Array.isArray(lecture.commands)) return false;
  for (const cmd of lecture.commands) {
    if (!cmd) continue;
    if (cmd.type === "math") return true;
    const text = (cmd.markdown || cmd.text || cmd.content || cmd._bodyText || "");
    if (typeof text !== "string" || !text) continue;
    if (/\$\$[\s\S]+?\$\$/.test(text) || /\$[^\n$]+?\$/.test(text)) return true;
  }
  return false;
}

/**
 * ensureRoughNotation() — on-demand loader for rough-notation, used by
 * :::mark / :::annotate / :::highlight / :::annotate_table handlers. The
 * library is ~15 KB, so latency on first annotation is negligible. Existing
 * call sites already guard with `if (!window.RoughNotation) return;` so
 * awaiting this loader at dispatch time is seamless.
 */
let roughNotationLoading = null;
async function ensureRoughNotation() {
  if (window.RoughNotation) return;
  if (!window.Xplainer || !window.Xplainer.loadScriptOnce) {
    console.warn("[xplainer] ensureRoughNotation called before Xplainer.loadScriptOnce is available");
    return;
  }
  if (!roughNotationLoading) {
    roughNotationLoading = window.Xplainer.loadScriptOnce("https://unpkg.com/rough-notation/lib/rough-notation.iife.js");
  }
  try {
    await roughNotationLoading;
  } catch (err) {
    console.warn("[xplainer] rough-notation failed to load:", err);
    roughNotationLoading = null; // allow retry on next call
  }
}

const skinDefaultsMap = {
  playful: {
    font_family: '"Comic Neue", "Patrick Hand", "Kalam", "Segoe Script", "Comic Sans MS", system-ui, sans-serif',
    code_font_family: '"Fira Code", "JetBrains Mono", "Cascadia Code", ui-monospace, monospace',
    highlight_style: "highlight",
    highlight_color: "rgba(250, 204, 21, 0.65)",
    highlight_animate: true,
  },
  chalk: {
    font_family: '"Chalkboard SE", "Comic Neue", "Patrick Hand", "Segoe Print", system-ui, sans-serif',
    code_font_family: '"Cascadia Mono", "Fira Code", ui-monospace, monospace',
    highlight_style: "underline",
    highlight_color: "rgba(255, 255, 255, 0.75)",
    highlight_animate: true,
  },
  minimal: {
    font_family: 'system-ui, -apple-system, Segoe UI, Roboto, Arial',
    code_font_family: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    highlight_style: "box",
    highlight_color: "rgba(250, 204, 21, 0.45)",
    highlight_animate: false,
  },
};

const els = {
  textViewport: document.getElementById("textViewport"),
  textContent: document.getElementById("textContent"),
  drawViewport: document.getElementById("drawViewport"),
  drawContent: document.getElementById("drawContent"),
  playerWrap: document.getElementById("playerWrap"),
  pageTitle: document.getElementById("pageTitle"),
  board: document.getElementById("board"),
  player: document.getElementById("player"),
  centerPlay: document.getElementById("centerPlay"),
  centerPlayBtn: document.getElementById("centerPlayBtn"),
  captions: document.getElementById("captions"),
  bottomBar: document.getElementById("bottomBar"),
  playPauseBtn: document.getElementById("playPauseBtn"),
  rewindBtn: document.getElementById("rewindBtn"),
  prevPageBtn: document.getElementById("prevPageBtn"),
  nextPageBtn: document.getElementById("nextPageBtn"),
  progress: document.getElementById("progress"),
  timeText: document.getElementById("timeText"),
  speedSel: document.getElementById("speedSel"),
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  fontDecreaseBtn: document.getElementById("fontDecreaseBtn"),
  fontIncreaseBtn: document.getElementById("fontIncreaseBtn"),
  ccBtn: document.getElementById("ccBtn"),
  muteBtn: document.getElementById("muteBtn"),
  sourceMenuBtn: document.getElementById("sourceMenuBtn"),
  sourcePanel: document.getElementById("sourcePanel"),
  sourceInput: document.getElementById("sourceInput"),
  sourceLoadBtn: document.getElementById("sourceLoadBtn"),
  sourceFileBtn: document.getElementById("sourceFileBtn"),
  sourceFileInput: document.getElementById("sourceFileInput"),
  sourceStatus: document.getElementById("sourceStatus"),
  editorPane: document.getElementById("editorPane"),
  editorTextarea: document.getElementById("editorTextarea"),
  editorStatus: document.getElementById("editorStatus"),
  editorToggleBtn: document.getElementById("editorToggleBtn"),
  editorApplyBtn: document.getElementById("editorApplyBtn"),
  editorCloseBtn: document.getElementById("editorCloseBtn"),
  editorHelpBtn: document.getElementById("editorHelpBtn"),
  editorDownloadBtn: document.getElementById("editorDownloadBtn"),
  editorSaveAsAppBtn: document.getElementById("editorSaveAsAppBtn"),
  editorUploadBtn: document.getElementById("editorUploadBtn"),
  editorFileInput: document.getElementById("editorFileInput"),
  editorUrlInput: document.getElementById("editorUrlInput"),
  editorLoadBtn: document.getElementById("editorLoadBtn"),
  editorListSelect: document.getElementById("editorListSelect"),
  editorListRefreshBtn: document.getElementById("editorListRefreshBtn"),
};

const columns = [
  { viewport: els.textViewport, content: els.textContent },
  { viewport: els.drawViewport, content: els.drawContent },
];

let voices = [];

let state = {
  pageIndex: 0,
  commandIndex: 0,
  lastExecutedIndex: -1,
  playing: false,
  paused: false,
  cancelToken: 0,
  editorOpen: false,
  editorText: "",
  sourceText: "",
  editorApplying: false,
  editorClosing: false,
  editorLastAppliedText: "",
  editorAutoApplyTimer: null,
  editorTutorialListCache: null,
  editorLoadedUrl: null,
  defaults: structuredClone(initialDefaults),
  baseDefaults,
  lectureDefaults,
  currentDrawContext: null,
  pages: [],
  speed: 1.0,
  hideBarTimer: null,
  elements: new Map(),
  captionsOn: false,
  muted: false,
  webr: null,
  webrReady: false,
  webrQueue: Promise.resolve(),
  webrDefaultPackagesPromise: null,
  pyodide: null,
  pyodideReady: false,
  pyodideQueue: Promise.resolve(),
  pyodideDefaultPackagesPromise: null,
  jsRequirementsPromise: null,
  jsModules: null,
  jsQueue: Promise.resolve(),
  brythonQueue: Promise.resolve(),
  p5Instances: new Map(),
  codeCells: [],
  dimEnabled: false,
  webrShelter: null,
  // Number of nested "waiting for the viewer to do something" scopes currently
  // open (continue button, question answer). The stall watchdog in
  // playFromHere ignores steps while this is > 0 — a deliberate pause is not a
  // stall. See beginUserInputWait / endUserInputWait.
  awaitingUserInput: 0,
  stallNotice: null,
};

function beginUserInputWait() {
  state.awaitingUserInput += 1;
}

function endUserInputWait() {
  state.awaitingUserInput = Math.max(0, state.awaitingUserInput - 1);
}

function refreshVoices() {
  voices = speechSynthesis.getVoices() || [];
}
speechSynthesis.onvoiceschanged = refreshVoices;
refreshVoices();

function pickVoice(lang, pref) {
  if (!voices.length) return null;
  const lowerPref = (pref || "").toLowerCase();
  if (lowerPref === "uk_female") {
    const gb = voices.filter((v) => (v.lang || "").toLowerCase().startsWith("en-gb"));
    return gb[0] || voices[0];
  }
  if (lowerPref === "female") {
    const byLang = voices.filter((v) => (v.lang || "").toLowerCase().startsWith((lang || "").toLowerCase()));
    const pool = byLang.length ? byLang : voices;
    const female = pool.find((v) => /zira|susan|aria|sara|eva|female/i.test(v.name));
    if (female) return female;
  }
  if (lowerPref === "male") {
    const byLang = voices.filter((v) => (v.lang || "").toLowerCase().startsWith((lang || "").toLowerCase()));
    const pool = byLang.length ? byLang : voices;
    const male = pool.find((v) => /david|mark|james|male/i.test(v.name));
    if (male) return male;
  }
  const byLang = voices.find((v) => (v.lang || "").toLowerCase().startsWith((lang || "").toLowerCase()));
  return byLang || voices[0];
}

function updateCaptions(text) {
  if (!els.captions) return;
  const shouldShow = state.captionsOn || state.muted;
  if (!shouldShow || !text) {
    els.captions.style.display = "none";
    els.captions.textContent = "";
    return;
  }
  els.captions.style.display = "block";
  els.captions.textContent = text;
}

function parseRoughValue(val) {
  if (val === undefined || val === null) return undefined;
  const v = String(val).trim();
  if (v === "") return undefined;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
  if ((v.startsWith("[") && v.endsWith("]")) || (v.startsWith("{") && v.endsWith("}"))) {
    try { return JSON.parse(v); } catch {}
  }
  return v;
}

function buildRoughConfig(el, typeOverride) {
  const cfg = {
    type: typeOverride || el.getAttribute("data-annotate") || "underline",
    animate: el.hasAttribute("animate") ? (el.getAttribute("animate") !== "false") : undefined,
    animationDuration: parseRoughValue(el.getAttribute("animationDuration")),
    color: el.getAttribute("color") || undefined,
    strokeWidth: parseRoughValue(el.getAttribute("strokeWidth")),
    padding: parseRoughValue(el.getAttribute("padding")),
    multiline: parseRoughValue(el.getAttribute("multiline")),
    iterations: parseRoughValue(el.getAttribute("iterations")),
    brackets: parseRoughValue(el.getAttribute("brackets")),
    rtl: parseRoughValue(el.getAttribute("rtl")),
  };
  Object.keys(cfg).forEach((k) => cfg[k] === undefined && delete cfg[k]);
  return cfg;
}

function applyRoughAnnotations(root) {
  if (!root) return;
  // Lazy-load rough-notation on first use. Phase A.4 removes the eager
  // <script> tag; this keeps the existing sync call sites working by
  // detecting the library's absence, kicking off a load, and re-running
  // once the library shows up. `data-annotate` markers on the DOM survive
  // the async gap since we only check dataset.annotated before drawing.
  if (!window.RoughNotation) {
    // Fire-and-forget: schedule a retry once the library arrives. Every
    // synchronous call site (including renderMarkdownBlock) stays sync.
    ensureRoughNotation().then(() => { if (window.RoughNotation) applyRoughAnnotations(root); }).catch(() => {});
    return;
  }
  const nodes = root.querySelectorAll("[data-annotate]");
  nodes.forEach((el) => {
    if (el.dataset.annotated) return;
    const cfg = buildRoughConfig(el);
    const ann = window.RoughNotation.annotate(el, cfg);
    ann.show();
    el.dataset.annotated = "1";
  });
}

async function applyMermaidInContainer(container, resizeFn) {
  if (!container) return;
  const nodes = [...container.querySelectorAll("[data-mermaid-code]")];
  if (!nodes.length) return;
  for (const node of nodes) {
    if (node.dataset.mermaidRendered) continue;
    const code = node.dataset.mermaidCode || node.textContent || "";
    const wrapper = await renderMermaidDiagram(code, { maxWidth: "100%", center: false });
    if (wrapper) {
      node.replaceWith(wrapper);
    }
    node.dataset.mermaidRendered = "1";
  }
  if (resizeFn) resizeFn();
  updateAllColumns();
}

function processInlineMarkup(root) {
  if (!root) return;
  if (!root.querySelector("box, underline, circle, highlight, strike-through, crossed-off, bracket, info, note, warning, error, mermaid")) {
    return;
  }
  const map = [
    ["box", "box"],
    ["underline", "underline"],
    ["circle", "circle"],
    ["highlight", "highlight"],
    ["strike-through", "strike-through"],
    ["crossed-off", "crossed-off"],
    ["bracket", "bracket"],
  ];
  map.forEach(([tag, type]) => {
    root.querySelectorAll(tag).forEach((node) => {
      const span = document.createElement("span");
      span.setAttribute("data-annotate", type);
      [...node.attributes].forEach((attr) => span.setAttribute(attr.name, attr.value));
      span.innerHTML = node.innerHTML;
      node.replaceWith(span);
    });
  });
  const msgMap = [
    ["info", "info"],
    ["note", "note"],
    ["warning", "warn"],
    ["error", "error"],
  ];
  msgMap.forEach(([tag, cls]) => {
    root.querySelectorAll(tag).forEach((node) => {
      const span = document.createElement("span");
      span.className = `msg ${cls}`;
      span.innerHTML = node.innerHTML;
      node.replaceWith(span);
    });
  });
  root.querySelectorAll("mermaid").forEach((node) => {
    const div = document.createElement("div");
    div.className = "mermaid-placeholder";
    div.dataset.mermaidCode = node.getAttribute("code") || node.textContent || "";
    node.replaceWith(div);
  });
}

function createHtmlElement(spec = {}) {
  const tag = (spec.tag || "div").toLowerCase();
  const el = document.createElement(tag);
  if (spec.attrs && typeof spec.attrs === "object") {
    Object.entries(spec.attrs).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      el.setAttribute(k, String(v));
    });
  }
  if (spec.styles && typeof spec.styles === "object") {
    Object.assign(el.style, spec.styles);
  }
  if (spec.text !== undefined) {
    el.textContent = String(spec.text);
  }
  if (spec.html !== undefined) {
    el.innerHTML = String(spec.html);
  }
  if (Array.isArray(spec.children)) {
    spec.children.forEach((child) => {
      el.appendChild(createHtmlElement(child));
    });
  }
  return el;
}

function appendToLocation(el, location) {
  const loc = resolveLocation(location, "left");
  const target = getColumnForLocation(loc);
  target.appendChild(el);
  scrollColumnToBottom(target);
  return target;
}

// Lazy-load explain_components.js (only when a component is first used)
const EXPLAIN_COMPONENTS_SCRIPT = typeof window.explainComponentsScriptUrl === "string"
  ? window.explainComponentsScriptUrl
  : "explain_components.js";
let explainComponentsLoadPromise = null;

// Optional fallback base URL for auto-loading web components (e.g. CDN or GitHub raw). Empty = only try local components/.
const EXPLAINER_LIBRARY_COMPONENTS_BASE = typeof window.explainLibraryComponentsBase === "string" ? window.explainLibraryComponentsBase : "";

function loadExplainComponents() {
  if (explainComponentsLoadPromise) return explainComponentsLoadPromise;
  explainComponentsLoadPromise = new Promise((resolve, reject) => {
    if (document.querySelector('script[src*="explain_components"]')) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = EXPLAIN_COMPONENTS_SCRIPT;
    script.onload = () => resolve();
    script.onerror = () => {
      explainComponentsLoadPromise = null;
      reject(new Error("Failed to load " + EXPLAIN_COMPONENTS_SCRIPT));
    };
    document.head.appendChild(script);
  });
  return explainComponentsLoadPromise;
}

function isNumericCell(value) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  return /^-?\d+(?:[.,]\d+)?$/.test(text.replace(/\s/g, ""));
}

function detectNumericColumns(headers, rows) {
  const cols = Math.max(headers.length, ...rows.map((r) => r.length));
  const numeric = Array(cols).fill(true);
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows.length; r += 1) {
      const value = rows[r][c];
      if (value === undefined || value === null || String(value).trim() === "") continue;
      if (!isNumericCell(value)) {
        numeric[c] = false;
        break;
      }
    }
  }
  return numeric;
}

function renderTableBlock(action = {}) {
  const headers = Array.isArray(action.headers) ? action.headers : [];
  const rows = Array.isArray(action.rows) ? action.rows : [];
  const engine = String(action.engine || "native").toLowerCase();
  if (engine !== "native") {
    console.warn("Unknown table engine, falling back to native:", engine);
  }
  const wrap = document.createElement("div");
  wrap.className = "table-block";
  applyPauseOnClick(wrap, "table", action);
  if (action.striped !== false) wrap.classList.add("striped");
  if (action.compact) wrap.classList.add("compact");

  if (action.title) {
    const title = document.createElement("div");
    title.className = "table-title";
    title.textContent = action.title;
    wrap.appendChild(title);
  }

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  const numericCols = detectNumericColumns(headers, rows);

  const renderCell = (cell) => {
    const s = String(cell ?? "").trim();
    if (!s) return "";
    const m = getMd();
    if (typeof m.renderInline === "function") {
      return m.renderInline(s);
    }
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };

  if (headers.length) {
    const tr = document.createElement("tr");
    headers.forEach((cell, idx) => {
      const th = document.createElement("th");
      th.classList.add("md");
      th.innerHTML = renderCell(cell);
      processInlineMarkup(th);
      if (numericCols[idx]) th.classList.add("is-numeric");
      tr.appendChild(th);
    });
    thead.appendChild(tr);
  }

  const highlight = action.highlight_row ?? action.highlight;
  const highlightIndex = typeof highlight === "number" ? Math.max(1, highlight) - 1 : null;
  rows.forEach((row, rIdx) => {
    const tr = document.createElement("tr");
    if (highlightIndex !== null && rIdx === highlightIndex) tr.classList.add("is-highlight");
    row.forEach((cell, cIdx) => {
      const td = document.createElement("td");
      td.classList.add("md");
      td.innerHTML = renderCell(cell);
      processInlineMarkup(td);
      if (numericCols[cIdx]) td.classList.add("is-numeric");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  if (thead.childNodes.length) table.appendChild(thead);
  table.appendChild(tbody);
  wrap.appendChild(table);

  if (action.caption) {
    const cap = document.createElement("div");
    cap.className = "table-caption";
    cap.textContent = action.caption;
    wrap.appendChild(cap);
  }
  autoDimLatest(wrap);
  return wrap;
}

function mountSvgString(container, svgText) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;
  container.replaceChildren(document.importNode(svg, true));
  return container.querySelector("svg");
}

function animateSvgDraw(svg, opts = {}) {
  const baseDelay = opts.baseDelay ?? 0;
  const stepDelay = opts.stepDelay ?? 120;
  const minDur = opts.minDur ?? 180;
  const durPer100px = opts.durPer100px ?? 90;
  const revealText = opts.revealText ?? true;

  if (!svg.querySelector("style[data-draw-anim]")) {
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.setAttribute("data-draw-anim", "1");
    style.textContent = `
      .__draw{stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:var(--len,1000);stroke-dashoffset:var(--len,1000);animation:__draw var(--dur,700ms) ease forwards;animation-delay:var(--delay,0ms)}
      .__reveal{opacity:0;animation:__reveal var(--dur,220ms) ease forwards;animation-delay:var(--delay,0ms)}
      @keyframes __draw{to{stroke-dashoffset:0}}
      @keyframes __reveal{to{opacity:1}}
    `;
    svg.insertBefore(style, svg.firstChild);
  }

  const drawableSel = "path,line,polyline,polygon,rect,circle,ellipse";
  const textSel = "text,image,foreignObject";

  const explicit = Array.from(svg.querySelectorAll("[data-step]"))
    .sort((a, b) => (+a.dataset.step || 0) - (+b.dataset.step || 0));

  const drawable = explicit.length
    ? explicit.filter((el) => el.matches(drawableSel))
    : Array.from(svg.querySelectorAll(drawableSel));

  const texts = Array.from(svg.querySelectorAll(textSel));

  const approxLen = (el) => {
    try { if (typeof el.getTotalLength === "function") return el.getTotalLength(); } catch {}
    const tag = el.tagName.toLowerCase();
    if (tag === "line") {
      const x1 = +el.getAttribute("x1"), y1 = +el.getAttribute("y1");
      const x2 = +el.getAttribute("x2"), y2 = +el.getAttribute("y2");
      return Math.hypot(x2 - x1, y2 - y1);
    }
    if (tag === "rect") {
      const w = +el.getAttribute("width") || 0, h = +el.getAttribute("height") || 0;
      return 2 * (w + h);
    }
    if (tag === "circle") return 2 * Math.PI * (+el.getAttribute("r") || 0);
    if (tag === "ellipse") {
      const rx = +el.getAttribute("rx") || 0, ry = +el.getAttribute("ry") || 0;
      return 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2);
    }
    return 600;
  };

  let k = 0;
  let lastDrawableEnd = 0;

  for (const el of drawable) {
    const cs = getComputedStyle(el);
    const hasStroke = cs.stroke && cs.stroke !== "none" && cs.strokeWidth !== "0px";
    if (!hasStroke) continue;

    const len = approxLen(el);
    const delay = baseDelay + k * stepDelay;
    const dur = Math.max(minDur, (len / 100) * durPer100px);

    el.classList.add("__draw");
    el.style.setProperty("--len", String(len));
    el.style.setProperty("--delay", `${delay}ms`);
    el.style.setProperty("--dur", `${dur}ms`);

    const hadFill = cs.fill && cs.fill !== "none";
    if (hadFill) {
      const fill = cs.fill;
      el.style.fill = "none";
      setTimeout(() => { el.style.fill = fill; }, delay + dur);
    }

    lastDrawableEnd = delay + dur;
    k++;
  }

  if (revealText && texts.length) {
    const endDelay = baseDelay + k * stepDelay;
    texts.forEach((el, j) => {
      el.classList.add("__reveal");
      el.style.setProperty("--delay", `${endDelay + j * 50}ms`);
      el.style.setProperty("--dur", "220ms");
    });
    lastDrawableEnd = Math.max(lastDrawableEnd, endDelay + (texts.length - 1) * 50 + 220);
  }

  return lastDrawableEnd;
}

/**
 * Resolve to `fallback` if `promise` has not settled within `ms`.
 *
 * Used to bound awaits on third-party code (mermaid, CDN module loads) that can
 * hang forever on a stalled chunk request. A never-settling promise inside
 * runAction freezes playback with nothing on screen to explain it, which is the
 * failure mode the stall watchdog in playFromHere also guards against.
 */
function withTimeout(promise, ms, fallbackFactory) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __timedOut: true }), ms);
  });
  return Promise.race([promise, timeout]).then((value) => {
    if (timer) clearTimeout(timer);
    if (value && value.__timedOut) return fallbackFactory ? fallbackFactory() : null;
    return value;
  }, (err) => {
    if (timer) clearTimeout(timer);
    throw err;
  });
}

let mermaidInitPromise = null;
async function initMermaid() {
  if (mermaidInitPromise) return mermaidInitPromise;
  mermaidInitPromise = withTimeout(
    import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs"),
    20000,
    () => { throw new Error("Timed out loading mermaid from CDN"); },
  )
    .then((mod) => {
      window.mermaid = mod.default || mod.mermaid || mod;
      window.mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });
      return window.mermaid;
    })
    .catch((err) => {
      console.error("Mermaid load failed", err);
      return null;
    });
  return mermaidInitPromise;
}

function mermaidErrorBlock(message) {
  const pre = document.createElement("pre");
  pre.className = "code-pre";
  pre.textContent = `Mermaid error:\n${message}`;
  return pre;
}

async function renderMermaidDiagram(code, opts = {}) {
  const mermaid = await initMermaid();
  if (!mermaid) return mermaidErrorBlock("mermaid failed to load (see console)");
  const id = `mermaid-${Math.random().toString(36).slice(2)}`;
  try {
    // mermaid.render can hang indefinitely if one of its lazily-imported
    // diagram chunks never arrives. Bound it so a bad network does not freeze
    // the whole presentation on a diagram.
    const rendered = await withTimeout(mermaid.render(id, code), 15000, () => null);
    if (!rendered) return mermaidErrorBlock("diagram render timed out after 15s");
    const { svg, bindFunctions } = rendered;
    const wrapper = document.createElement("div");
    wrapper.className = "mermaid-block";
    wrapper.innerHTML = svg;
    if (bindFunctions) bindFunctions(wrapper);
    if (opts.maxWidth) wrapper.style.maxWidth = opts.maxWidth;
    if (opts.center) wrapper.style.margin = "0 auto";
    return wrapper;
  } catch (err) {
    console.error("[xplainer] mermaid render failed", err, code);
    return mermaidErrorBlock(err && err.message ? err.message : String(err));
  }
}

let p5InitPromise = null;
async function initP5() {
  if (window.p5) return window.p5;
  if (p5InitPromise) return p5InitPromise;
  p5InitPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/p5@1.9.0/lib/p5.min.js";
    script.onload = () => resolve(window.p5 || null);
    script.onerror = () => {
      console.error("p5.js load failed");
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return p5InitPromise;
}

function buildP5Sketch(code, container, opts = {}) {
  return (p) => {
    let out = {};
    try {
      const fn = new Function("p", "container", `
        let out = {};
        with (p) {
          ${code}
        }
        if (typeof setup === "function") out.setup = setup;
        if (typeof draw === "function") out.draw = draw;
        if (typeof mousePressed === "function") out.mousePressed = mousePressed;
        if (typeof mouseDragged === "function") out.mouseDragged = mouseDragged;
        if (typeof mouseReleased === "function") out.mouseReleased = mouseReleased;
        if (typeof keyPressed === "function") out.keyPressed = keyPressed;
        if (typeof keyReleased === "function") out.keyReleased = keyReleased;
        if (typeof keyTyped === "function") out.keyTyped = keyTyped;
        if (typeof windowResized === "function") out.windowResized = windowResized;
        return out;
      `);
      out = fn(p, container) || {};
    } catch (err) {
      console.error("p5 sketch error", err);
      out = {};
    }
    Object.assign(p, out);
    if (!p.setup) {
      p.setup = () => {
        const w = container.clientWidth || 320;
        const h = container.clientHeight || 200;
        p.createCanvas(w, h);
        p.background(245);
      };
    }
    const autoResize = opts.auto_resize ?? state.defaults.p5_auto_resize ?? true;
    if (!p.windowResized && autoResize) {
      p.windowResized = () => {
        const w = container.clientWidth || 320;
        const h = container.clientHeight || 200;
        p.resizeCanvas(w, h);
      };
    }
  };
}

function removeP5Instance(id) {
  const entry = state.p5Instances.get(id);
  if (!entry) return;
  if (entry.instance?.remove) entry.instance.remove();
  if (entry.wrapper?.parentNode) entry.wrapper.parentNode.removeChild(entry.wrapper);
  state.p5Instances.delete(id);
}

function clearP5Instances() {
  for (const id of state.p5Instances.keys()) {
    removeP5Instance(id);
  }
}

async function createP5FromAction(action, tokenAtStart, opts = {}) {
  const loc = resolveLocation(action.location ?? state.defaults.p5_location, "right");
  const target = getColumnForLocation(loc);
  const clearPage = action.new_page ?? action.clear_page ?? action.code_new_page
    ?? state.defaults.code_new_page ?? state.defaults.p5_clear_page ?? false;
  if (clearPage) clearBoard();
  if (opts.instant) return null;

  const id = action.id || `p5-${Math.random().toString(36).slice(2)}`;
  if (state.p5Instances.has(id)) removeP5Instance(id);

  if (action.title) {
    const t = renderMarkdownBlock(
      action.title,
      { role: "title", pause_on_click_type: "p5", pause_on_click: action.pause_on_click },
      target
    );
    t.container.classList.add("figure-title");
  }
  if (action.subtitle) {
    const s = renderMarkdownBlock(
      action.subtitle,
      { role: "subtitle", muted: true, pause_on_click_type: "p5", pause_on_click: action.pause_on_click },
      target
    );
    s.container.classList.add("figure-subtitle");
  }

  const wrapper = document.createElement("div");
  wrapper.className = "p5-block";
  applyPauseOnClick(wrapper, "p5", action);
  wrapper.style.width = action.width ?? state.defaults.p5_width ?? "100%";
  wrapper.style.height = action.height ?? state.defaults.p5_height ?? "240px";
  wrapper.dataset.p5Id = id;

  const canvasHost = document.createElement("div");
  canvasHost.style.width = "100%";
  canvasHost.style.height = "100%";
  wrapper.appendChild(canvasHost);

  target.appendChild(wrapper);
  scrollColumnToBottom(target);

  const p5 = await initP5();
  if (!p5) {
    const pre = document.createElement("pre");
    pre.textContent = "Failed to load p5.js";
    wrapper.appendChild(pre);
    return null;
  }

  const code = action.sketch ?? action.code ?? "";
  const instance = new p5(buildP5Sketch(code, canvasHost, { auto_resize: action.auto_resize }), canvasHost);

  const autorun = action.autorun ?? state.defaults.p5_autorun ?? true;
  if (!autorun) instance.noLoop();

  const controls = action.controls ?? state.defaults.p5_controls ?? false;
  let controlsEl = null;
  if (controls) {
    controlsEl = document.createElement("div");
    controlsEl.className = "p5-controls";
    const playBtn = document.createElement("button");
    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset";
    const updatePlayLabel = () => {
      const looping = instance.isLooping ? instance.isLooping() : true;
      playBtn.textContent = looping ? "Pause" : "Play";
    };
    playBtn.onclick = () => {
      const looping = instance.isLooping ? instance.isLooping() : true;
      if (looping) instance.noLoop(); else instance.loop();
      updatePlayLabel();
    };
    resetBtn.onclick = () => {
      const resetAction = { ...action, clear_page: false };
      removeP5Instance(id);
      createP5FromAction(resetAction, tokenAtStart, { instant: false });
    };
    updatePlayLabel();
    controlsEl.appendChild(playBtn);
    controlsEl.appendChild(resetBtn);
    target.appendChild(controlsEl);
  }

  if (action.footnote) {
    const f = renderMarkdownBlock(action.footnote, { role: "footnote", muted: true }, target);
    f.container.classList.add("figure-footnote");
  }

  state.p5Instances.set(id, { id, instance, wrapper, canvasHost, controlsEl, action: { ...action, location: loc } });
  if (action.id) {
    registerElement(action.id, { type: "p5", el: wrapper, instance });
  }
  return { id, instance, wrapper };
}

async function initWebR() {
  if (state.webrReady && state.webr) return state.webr;
  const mod = globalThis.loadWebR ? globalThis.loadWebR : await import("https://webr.r-wasm.org/latest/webr.mjs");
  const WebR = mod.WebR || mod.default?.WebR || mod.default;
  state.webr = new WebR();
  await state.webr.init();
  await state.webr.evalR('setwd("/")');
  state.webrReady = true;
  return state.webr;
}

async function initPyodide(preload = false) {
  if (state.pyodideReady && state.pyodide) return state.pyodide;
  const loadScript = () => new Promise((resolve, reject) => {
    if (window.loadPyodide) return resolve();
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  await loadScript();
  state.pyodide = await window.loadPyodide();
  state.pyodideReady = true;
  return state.pyodide;
}

function preloadPyodide() {
  if (state.pyodideReady) return;
  state.pyodideQueue = state.pyodideQueue.then(() => initPyodide(true)).catch(() => {});
}

function parseRequirementsList(str) {
  if (str == null || typeof str !== "string") return [];
  return str.split(",").map((s) => s.trim()).filter(Boolean);
}

function startBackgroundRequirements() {
  const req = state.defaults || {};
  const pyList = parseRequirementsList(req.python_requirements);
  const rList = parseRequirementsList(req.r_requirements);
  const jsList = parseRequirementsList(req.js_requirements);

  if (pyList.length && !state.pyodideDefaultPackagesPromise) {
    state.pyodideDefaultPackagesPromise = (async () => {
      try {
        const py = await initPyodide();
        await py.loadPackage("micropip");
        for (const spec of pyList) {
          await py.runPythonAsync(`import micropip\nawait micropip.install(${JSON.stringify(spec)})`);
        }
      } catch (e) {
        console.warn("[explainer] python_requirements install failed:", e);
      }
    })();
  }

  if (rList.length && !state.webrDefaultPackagesPromise) {
    state.webrDefaultPackagesPromise = (async () => {
      try {
        const webR = await initWebR();
        if (typeof webR.installPackages === "function") {
          await webR.installPackages(rList);
        }
      } catch (e) {
        console.warn("[explainer] r_requirements install failed:", e);
      }
    })();
    enqueueWebRTask(() => state.webrDefaultPackagesPromise);
  }

  if (jsList.length && !state.jsRequirementsPromise) {
    state.jsRequirementsPromise = (async () => {
      try {
        const modules = [];
        for (const url of jsList) {
          const mod = await import(/* @vite-ignore */ url);
          modules.push(mod);
        }
        state.jsModules = modules;
        return state.jsModules;
      } catch (e) {
        console.warn("[explainer] js_requirements load failed:", e);
        state.jsModules = [];
        return state.jsModules;
      }
    })();
  }
}

async function runPyodideCode(code, autoInstall = true, micropipSpecs = []) {
  const progress = arguments[3] || {};
  const cancelRequested = typeof progress.cancelRequested === "function" ? progress.cancelRequested : () => false;
  const throwIfCancelled = () => {
    if (cancelRequested()) {
      const err = new Error("Execution cancelled");
      err.__explainerCancelled = true;
      throw err;
    }
  };
  if (typeof progress.onStatus === "function") progress.onStatus("loading", "Loading Pyodide...");
  const py = await initPyodide();
  throwIfCancelled();
  if (state.pyodideDefaultPackagesPromise) {
    if (typeof progress.onStatus === "function") progress.onStatus("loading", "Loading standard packages...");
    await state.pyodideDefaultPackagesPromise;
    throwIfCancelled();
  }
  if (autoInstall && typeof py.loadPackagesFromImports === "function") {
    if (typeof progress.onStatus === "function") progress.onStatus("loading", "Loading imports...");
    await py.loadPackagesFromImports(code);
    throwIfCancelled();
  }
  if (micropipSpecs && micropipSpecs.length) {
    if (typeof progress.onStatus === "function") progress.onStatus("loading", "Installing packages...");
    await py.loadPackage("micropip");
    for (const spec of micropipSpecs) {
      await py.runPythonAsync(`import micropip\nawait micropip.install(${JSON.stringify(spec)})`);
      throwIfCancelled();
    }
  }
  let stdout = "";
  let stderr = "";
  if (typeof py.setStdout === "function") {
    py.setStdout({ batched: (s) => { stdout += s + "\n"; } });
  }
  if (typeof py.setStderr === "function") {
    py.setStderr({ batched: (s) => { stderr += s + "\n"; } });
  }
  const execWrapper = [
    "import ast",
    `__code = ${JSON.stringify(code)}`,
    "tree = ast.parse(__code) if __code.strip() else None",
    "if tree and tree.body and isinstance(tree.body[-1], ast.Expr):",
    "    expr = ast.Expression(tree.body[-1].value)",
    "    body = ast.Module(tree.body[:-1], type_ignores=[])",
    "    exec(compile(body, '<cell>', 'exec'), globals())",
    "    __result = eval(compile(expr, '<cell>', 'eval'), globals())",
    "    if __result is not None:",
    "        print(__result)",
    "else:",
    "    if tree:",
    "        exec(compile(tree, '<cell>', 'exec'), globals())",
  ].join("\n");
  try {
    if (typeof progress.onStatus === "function") progress.onStatus("running", "Running...");
    await py.runPythonAsync(execWrapper);
  } catch (e) {
    stderr += (e && e.message) ? e.message : String(e);
  }
  let images = [];
  try {
    const imgJson = await py.runPythonAsync(`
import json, io, base64
try:
    import matplotlib.pyplot as plt
except Exception:
    plt = None
images = []
if plt is not None:
    figs = [plt.figure(n) for n in plt.get_fignums()]
    for fig in figs:
        buf = io.BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight")
        images.append(base64.b64encode(buf.getvalue()).decode("ascii"))
    plt.close("all")
json.dumps(images)
`);
    if (typeof imgJson === "string") {
      images = JSON.parse(imgJson);
    }
  } catch (_) {}
  if (typeof py.setStdout === "function") py.setStdout();
  if (typeof py.setStderr === "function") py.setStderr();
  return { stdout: stdout.trim(), stderr: stderr.trim(), images };
}

function parseMicropipSpecs(code) {
  const specs = [];
  const lines = (code || "").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("#tag.micropip")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const val = line.slice(eq + 1).trim();
    if (!val) continue;
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      const inner = val.slice(1, -1).trim();
      if (inner) specs.push(inner);
      continue;
    }
    if (val.startsWith("[") && val.endsWith("]")) {
      const re = /(["'])(.*?)\1/g;
      let m;
      while ((m = re.exec(val)) !== null) {
        const s = (m[2] || "").trim();
        if (s) specs.push(s);
      }
    }
  }
  return specs;
}

function renderPyodideResult(result, outputEl, append = false) {
  const wrap = append ? document.createElement("div") : null;
  const target = append ? wrap : outputEl;
  if (!append) outputEl.innerHTML = "";
  const maxHeight = state.defaults.code_output_max_height;
  if (result?.images?.length) {
    result.images.forEach((b64) => {
      const img = document.createElement("img");
      img.src = `data:image/png;base64,${b64}`;
      img.alt = "Generated Plot";
      img.style.maxWidth = "100%";
      if (maxHeight) img.style.maxHeight = `${maxHeight}px`;
      img.style.objectFit = "contain";
      target.appendChild(img);
    });
  }
  const out = [];
  if (result?.stdout) out.push(String(result.stdout).trim());
  if (result?.stderr) out.push(String(result.stderr).trim());
  if (result && result.returned !== undefined) out.push(String(result.returned));
  if (result?.error) out.push(String(result.error));
  if (out.length) {
    const pre = document.createElement("pre");
    pre.textContent = out.filter(Boolean).join("\n");
    target.appendChild(pre);
  }
  if (append && wrap && wrap.childNodes.length) {
    outputEl.appendChild(wrap);
  }
}
function extractRPackages(code) {
  const pkgs = new Set();
  const re = /\b(?:library|require)\(\s*([A-Za-z0-9_.]+)\s*\)/g;
  let m;
  while ((m = re.exec(code || ""))) {
    pkgs.add(m[1]);
  }
  return [...pkgs];
}

async function runRCode(code) {
  const progress = arguments[1] || {};
  const cancelRequested = typeof progress.cancelRequested === "function" ? progress.cancelRequested : () => false;
  const throwIfCancelled = () => {
    if (cancelRequested()) {
      const err = new Error("Execution cancelled");
      err.__explainerCancelled = true;
      throw err;
    }
  };
  if (typeof progress.onStatus === "function") progress.onStatus("loading", "Loading webR...");
  const webR = await initWebR();
  throwIfCancelled();
  const pkgs = extractRPackages(code);
  if (pkgs.length && typeof webR.installPackages === "function") {
    if (typeof progress.onStatus === "function") progress.onStatus("loading", "Installing R packages...");
    await webR.installPackages(pkgs);
    throwIfCancelled();
  }
  if (!state.webrShelter) {
    state.webrShelter = await new webR.Shelter();
  }
  if (typeof progress.onStatus === "function") progress.onStatus("running", "Running...");
  return state.webrShelter.captureR(code, { withAutoprint: true });
}

function createRuntimeStatusControls(toolbar, engineLabel = "Runtime") {
  const status = document.createElement("div");
  status.className = "runtime-status";
  const dot = document.createElement("span");
  dot.className = "runtime-status-dot";
  const label = document.createElement("span");
  label.textContent = "Ready";
  status.appendChild(dot);
  status.appendChild(label);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "runtime-cancel-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.disabled = true;
  cancelBtn.style.display = "none";

  toolbar.appendChild(status);
  toolbar.appendChild(cancelBtn);

  const setState = (kind, text) => {
    status.classList.remove("is-loading", "is-running", "is-error", "is-cancelled");
    if (kind === "loading") status.classList.add("is-loading");
    else if (kind === "running") status.classList.add("is-running");
    else if (kind === "error") status.classList.add("is-error");
    else if (kind === "cancelled") status.classList.add("is-cancelled");
    label.textContent = text || (kind === "ready" ? "Ready" : "");
  };

  const setBusy = (busy) => {
    status.style.display = busy ? "inline-flex" : "none";
    cancelBtn.style.display = busy ? "" : "none";
    cancelBtn.disabled = !busy;
  };

  setState("ready", `${engineLabel}: Ready`);
  setBusy(false);

  return {
    setState,
    setBusy,
    onCancel(handler) { cancelBtn.onclick = handler || null; },
  };
}

function enqueueWebRTask(task) {
  state.webrQueue = state.webrQueue
    .catch(() => {})
    .then(task);
  return state.webrQueue;
}

function renderRResult(result, outputEl, append = false) {
  const wrap = append ? document.createElement("div") : null;
  const target = append ? wrap : outputEl;
  if (!append) outputEl.innerHTML = "";
  const maxHeight = state.defaults.code_output_max_height;
  if (result?.images?.length) {
    result.images.forEach((imgBitmap) => {
      const canvas = document.createElement("canvas");
      canvas.width = imgBitmap.width;
      canvas.height = imgBitmap.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(imgBitmap, 0, 0);
      const img = document.createElement("img");
      img.src = canvas.toDataURL();
      img.alt = "Generated Plot";
      img.style.maxWidth = "100%";
      if (maxHeight) img.style.maxHeight = `${maxHeight}px`;
      img.style.objectFit = "contain";
      target.appendChild(img);
    });
  }
  if (result?.output?.length) {
    const out = [];
    result.output.forEach((o) => {
      if (o.type === "stderr") out.push(String(o.data));
      else if (o.type === "stdout") out.push(String(o.data));
    });
    if (out.length) {
      const pre = document.createElement("pre");
      pre.textContent = out.join("\n").trim();
      target.appendChild(pre);
    }
  }
  if (result?.error) {
    const pre = document.createElement("pre");
    pre.textContent = String(result.error);
    target.appendChild(pre);
  }
  if (append && wrap && wrap.childNodes.length) outputEl.appendChild(wrap);
}

function outputClass(baseClass, action = {}) {
  const wide = action.wide_output ?? action.wider ?? state.defaults.code_output_wide ?? false;
  return wide ? `${baseClass} code-output-wide` : baseClass;
}

function formatJsValue(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function runJsCode(code) {
  if (state.jsRequirementsPromise) {
    await state.jsRequirementsPromise;
  }
  const logs = [];
  const errors = [];
  const consoleProxy = {
    log: (...args) => logs.push(args.map(formatJsValue).join(" ")),
    info: (...args) => logs.push(args.map(formatJsValue).join(" ")),
    warn: (...args) => errors.push(args.map(formatJsValue).join(" ")),
    error: (...args) => errors.push(args.map(formatJsValue).join(" ")),
  };
  const modules = state.jsModules || [];
  let returned;
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction("console", "modules", `"use strict";\n${code}`);
    returned = await fn(consoleProxy, modules);
  } catch (err) {
    const msg = err && err.stack ? err.stack : String(err);
    errors.push(msg);
  }
  return { stdout: logs.join("\n").trim(), stderr: errors.join("\n").trim(), returned };
}

function renderJsResult(result, outputEl) {
  outputEl.innerHTML = "";
  const out = [];
  if (result?.stdout) out.push(String(result.stdout).trim());
  if (result?.stderr) out.push(String(result.stderr).trim());
  if (result && result.returned !== undefined) out.push(formatJsValue(result.returned));
  if (out.length) {
    const pre = document.createElement("pre");
    pre.textContent = out.filter(Boolean).join("\n");
    outputEl.appendChild(pre);
  }
}

function cancelAll() {
  state.cancelToken++;
  speechSynthesis.cancel();
  // Every pending viewer-wait is abandoned by the token bump, so the balance
  // counter would otherwise drift up and permanently mute the stall watchdog.
  state.awaitingUserInput = 0;
  hideStallNotice();
}

function clearBoard() {
  clearP5Instances();
  els.textContent.innerHTML = "";
  els.drawContent.innerHTML = "";
  state.currentDrawContext = null;
  state.elements.clear();
  state.codeCells = [];
  clearDimAll();
  updateAllColumns();
  updateDrawLayout();
}

function setPageTitle(title, opts = {}) {
  els.pageTitle.textContent = title || "";
  els.pageTitle.dataset.contentRole = "title";
  const style = els.pageTitle.style;
  style.removeProperty("font-family");
  style.removeProperty("font-size");
  style.removeProperty("font-weight");
  style.removeProperty("color");
  const fontFamily = opts.font_family ?? opts.font;
  const fontSize = opts.font_size_px ?? opts.font_size ?? opts.size ?? contentFontPx("title");
  const fontWeight = opts.font_weight ?? opts.weight;
  const color = opts.color;
  if (fontFamily) style.fontFamily = String(fontFamily);
  if (fontSize !== undefined && fontSize !== null && String(fontSize) !== "") {
    style.fontSize = typeof fontSize === "number" ? `${fontSize}px` : String(fontSize);
  }
  if (fontWeight !== undefined && fontWeight !== null && String(fontWeight) !== "") {
    style.fontWeight = String(fontWeight);
  }
  if (color) style.color = String(color);
}

function updateAllColumns() {
  return;
}

function updateDrawLayout() {
  applyLayout();
}

function getScale() {
  return state.defaults.font_scale ?? 1.0;
}

const CONTENT_SIZE_RATIOS = { title: 20 / 22, subtitle: 16 / 22, footnote: 14 / 22, body: 1 };

function contentFontPx(role) {
  const scale = getScale();
  const isBody = role === "body";
  const base = isBody
    ? (state.defaults.body_font_size_px ?? state.defaults.font_size_px ?? 22)
    : (state.defaults.font_size_px ?? 22);
  const ratio = CONTENT_SIZE_RATIOS[role] ?? CONTENT_SIZE_RATIOS.body;
  return Math.round(base * ratio * scale);
}

function updateContentFontSizes() {
  document.querySelectorAll("[data-content-role]").forEach((el) => {
    const role = el.dataset.contentRole;
    if (!role) return;
    const size = contentFontPx(role);
    el.style.fontSize = size + "px";
    const md = el.querySelector(".md");
    if (md) md.style.fontSize = size + "px";
  });
}

function getHighlightDefaults() {
  return {
    effect: state.defaults.highlight_style,
    color: state.defaults.highlight_color,
    animate: state.defaults.highlight_animate,
  };
}

const markColorKeywords = {
  yellow: [250, 204, 21],
  green: [34, 197, 94],
  blue: [59, 130, 246],
  orange: [249, 115, 22],
  red: [239, 68, 68],
  pink: [236, 72, 153],
  cyan: [6, 182, 212],
  purple: [168, 85, 247],
};

function resolveMarkColor(value, opacity) {
  const op = Number(opacity);
  const a = Number.isFinite(op) && op >= 0 && op <= 1 ? op : 0.95;
  if (value === undefined || value === null) value = "yellow";
  const s = String(value).trim();
  const hexMatch = /^#([\da-fA-F]{3}|[\da-fA-F]{6}|[\da-fA-F]{8})$/.exec(s);
  if (hexMatch) {
    const hex = hexMatch[1];
    let r, g, b;
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  const rgbMatch = /^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(s);
  if (rgbMatch) return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${a})`;
  if (/^rgba\s*\(/.test(s)) return s;
  const key = s.toLowerCase();
  const rgb = markColorKeywords[key];
  if (rgb) return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
  return s;
}

function splitWriteText(markdown, mode = "paragraph") {
  const text = String(markdown ?? "");
  if (!text.trim()) return [""];
  const kind = String(mode || "paragraph").toLowerCase();
  if (kind === "line" || kind === "lines") {
    return text.split("\n").map((line) => line.trim()).filter(Boolean);
  }
  if (kind === "sentence" || kind === "sentences") {
    const chunks = text
      .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
      .map((part) => part.trim())
      .filter(Boolean);
    return chunks.length ? chunks : [text.trim()];
  }
  return text
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function extractMarkdownHeadlines(markdown = "") {
  const text = String(markdown ?? "");
  if (!text.trim()) return "";
  const lines = text.split("\n");
  const headlines = [];
  for (const line of lines) {
    const m = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    headlines.push(m[2].trim());
  }
  return headlines.join("\n");
}

function resolveWriteSpeakMode(action = {}) {
  const raw = action.speak ?? action.write_speak_speak ?? state.defaults.write_speak_speak ?? "all";
  const mode = String(raw ?? "").trim().toLowerCase();
  if (mode === "headlines") return "headlines";
  return "all";
}

// In write_speak: ((silent)...(/silent)) or ((s)...(/s)) = write only; ((invisible)...(/invisible)) or ((i)...(/i)) = speak only; ((skip)...(/skip)) or ((k)...(/k)) = neither.
// Only treat (( as a tag when a matching (/tag) exists; otherwise treat (( as normal text.
const WRITE_SPEAK_TAGS = [
  { name: "silent", close: "/silent", write: true, speak: false },
  { name: "invisible", close: "/invisible", write: false, speak: true },
  { name: "skip", close: "/skip", write: false, speak: false },
  { name: "write", close: "/write", write: true, speak: true },
  { name: "speak", close: "/speak", write: true, speak: true },
  { name: "s", close: "/s", write: true, speak: false },
  { name: "i", close: "/i", write: false, speak: true },
  { name: "k", close: "/k", write: false, speak: false },
  { name: "w", close: "/w", write: true, speak: true },
  { name: "p", close: "/p", write: true, speak: true },
];

const STOP_WRITE_TOKEN = "((stop_write))";
const STOP_SPEAK_TOKEN = "((stop_speak))";

function parseInlineTagArgs(argText = "") {
  const out = {};
  const text = String(argText || "").trim();
  if (!text) return out;
  const re = /([a-zA-Z0-9_.-]+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s]+)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const key = String(match[1] || "").trim();
    if (!key) continue;
    let raw = String(match[2] || "").trim();
    if (raw.endsWith(",")) raw = raw.slice(0, -1).trim();
    if (
      (raw.startsWith("\"") && raw.endsWith("\""))
      || (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      raw = raw.slice(1, -1);
    }
    const lower = raw.toLowerCase();
    if (lower === "true") out[key] = true;
    else if (lower === "false") out[key] = false;
    else if (raw !== "" && !Number.isNaN(Number(raw))) out[key] = Number(raw);
    else out[key] = raw;
  }
  return out;
}

function getInlinePresets(opts = {}) {
  const defaultsMap = state?.defaults?.speech_tags
    ?? state?.defaults?.inline_presets
    ?? state?.defaults?.styles;
  const actionMap = opts?.speech_tags ?? opts?.inline_presets ?? opts?.styles;
  const merged = {};
  if (defaultsMap && typeof defaultsMap === "object") Object.assign(merged, defaultsMap);
  if (actionMap && typeof actionMap === "object") Object.assign(merged, actionMap);
  return merged;
}

function camelToKebabCase(text = "") {
  return String(text || "").replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function normalizeInlinePreset(rawPreset) {
  if (!rawPreset || typeof rawPreset !== "object") {
    return { textStyle: {}, speech: {} };
  }
  const textStyle = {};
  const speech = {};
  const addStyle = (k, v) => {
    if (v === undefined || v === null || v === "") return;
    textStyle[k] = v;
  };
  const addSpeech = (k, v) => {
    if (v === undefined || v === null || v === "") return;
    speech[k] = v;
  };
  addStyle("color", rawPreset.color);
  addStyle("background", rawPreset.background ?? rawPreset.background_color);
  addStyle("fontFamily", rawPreset.font_family ?? rawPreset.fontFamily ?? rawPreset.font);
  addStyle("fontSize", rawPreset.font_size ?? rawPreset.fontSize ?? rawPreset.size);
  addStyle("fontWeight", rawPreset.font_weight ?? rawPreset.fontWeight ?? rawPreset.weight);
  addStyle("fontStyle", rawPreset.font_style ?? rawPreset.fontStyle);
  addStyle("textDecoration", rawPreset.text_decoration ?? rawPreset.textDecoration);

  addSpeech("speech_lang", rawPreset.speech_lang ?? rawPreset.lang);
  addSpeech("speech_voice", rawPreset.speech_voice ?? rawPreset.voice);
  addSpeech("speech_rate", rawPreset.speech_rate ?? rawPreset.rate);

  return { textStyle, speech };
}

function mergeInlineMeta(baseMeta = {}, nextMeta = {}) {
  return {
    textStyle: { ...(baseMeta.textStyle || {}), ...(nextMeta.textStyle || {}) },
    speech: { ...(baseMeta.speech || {}), ...(nextMeta.speech || {}) },
  };
}

function buildInlineStyleAttr(styleObj = {}) {
  const entries = Object.entries(styleObj).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!entries.length) return "";
  return entries
    .map(([k, v]) => `${camelToKebabCase(k)}:${String(v)}`)
    .join("; ");
}

function mergeSpeakOptionsFromArgs(argObj = {}) {
  return {
    speech_lang: argObj.speech_lang ?? argObj.lang,
    speech_voice: argObj.speech_voice ?? argObj.voice,
    speech_rate: argObj.speech_rate ?? argObj.rate,
  };
}

function parseWriteSpeakChunk(text, opts = {}) {
  const str = String(text ?? "");
  let defaultWrite = opts.defaultWrite !== false;
  let defaultSpeak = opts.defaultSpeak !== false;
  const presets = getInlinePresets(opts);
  const segments = [];
  let pendingWordMeta = null;
  const pushSegment = (chunk, write, speak, meta = null) => {
    const textChunk = String(chunk ?? "");
    if (!textChunk) return;
    const next = {
      text: textChunk,
      write: !!write,
      speak: !!speak,
      textStyle: { ...(meta?.textStyle || {}) },
      speech: { ...(meta?.speech || {}) },
    };
    const prev = segments[segments.length - 1];
    if (
      prev
      && prev.write === next.write
      && prev.speak === next.speak
      && JSON.stringify(prev.textStyle) === JSON.stringify(next.textStyle)
      && JSON.stringify(prev.speech) === JSON.stringify(next.speech)
    ) {
      prev.text += next.text;
      return;
    }
    segments.push(next);
  };
  let i = 0;
  while (i < str.length) {
    if (str.slice(i, i + 2) === "((") {
      if (str.slice(i, i + STOP_WRITE_TOKEN.length) === STOP_WRITE_TOKEN) {
        defaultWrite = false;
        i += STOP_WRITE_TOKEN.length;
        continue;
      }
      if (str.slice(i, i + STOP_SPEAK_TOKEN.length) === STOP_SPEAK_TOKEN) {
        defaultSpeak = false;
        i += STOP_SPEAK_TOKEN.length;
        continue;
      }
      const wordPresetMatch = str.slice(i).match(/^\(\(!([a-zA-Z0-9_.-]+)!\)\)/);
      if (wordPresetMatch) {
        const presetName = wordPresetMatch[1];
        const presetRaw = presets[presetName];
        const presetMeta = normalizeInlinePreset(presetRaw);
        pendingWordMeta = mergeInlineMeta(pendingWordMeta || {}, presetMeta);
        i += wordPresetMatch[0].length;
        continue;
      }

      const useMatch = str.slice(i).match(/^\(\(use\s+([a-zA-Z0-9_.-]+)\)\)/);
      if (useMatch) {
        const presetName = useMatch[1];
        const openLen = useMatch[0].length;
        const closePattern = "(/use)";
        const closeIdx = str.indexOf(closePattern, i + openLen);
        if (closeIdx === -1) {
          pushSegment("(", defaultWrite, defaultSpeak);
          i += 1;
          continue;
        }
        const content = str.slice(i + openLen, closeIdx);
        const presetRaw = presets[presetName];
        const presetMeta = normalizeInlinePreset(presetRaw);
        pushSegment(content, defaultWrite, defaultSpeak, presetMeta);
        i = closeIdx + closePattern.length;
        continue;
      }

      const sayMatch = str.slice(i).match(/^\(\(say(?:\s+([^)]*?))?\)\)/);
      if (sayMatch) {
        const argText = sayMatch[1] || "";
        const openLen = sayMatch[0].length;
        const closePattern = "(/say)";
        const closeIdx = str.indexOf(closePattern, i + openLen);
        if (closeIdx === -1) {
          pushSegment("(", defaultWrite, defaultSpeak);
          i += 1;
          continue;
        }
        const content = str.slice(i + openLen, closeIdx);
        const speechFromTag = mergeSpeakOptionsFromArgs(parseInlineTagArgs(argText));
        pushSegment(content, defaultWrite, defaultSpeak, { speech: speechFromTag });
        i = closeIdx + closePattern.length;
        continue;
      }

      let matched = null;
      for (const tag of WRITE_SPEAK_TAGS) {
        const open = "((" + tag.name + ")";
        if (str.slice(i, i + open.length) === open) {
          matched = tag;
          break;
        }
      }
      const closePattern = matched ? "(/" + matched.name + ")" : null;
      const closeLen = closePattern ? closePattern.length : 0;
      let closeIdx = -1;
      if (closePattern) {
        closeIdx = str.indexOf(closePattern, i + 2);
      }
      if (!matched || closeIdx === -1) {
        pushSegment("(", defaultWrite, defaultSpeak);
        i += 1;
        continue;
      }
      const openLen = 2 + matched.name.length + 1;
      const content = str.slice(i + openLen, closeIdx);
      pushSegment(content, matched.write, matched.speak);
      i = closeIdx + closeLen;
      continue;
    }
    if (pendingWordMeta && /\S/.test(str[i])) {
      let j = i;
      while (j < str.length && /\S/.test(str[j])) j += 1;
      const token = str.slice(i, j);
      pushSegment(token, defaultWrite, defaultSpeak, pendingWordMeta);
      pendingWordMeta = null;
      i = j;
      continue;
    }
    pushSegment(str[i], defaultWrite, defaultSpeak);
    i += 1;
  }

  const write = segments.filter((seg) => seg.write).map((seg) => seg.text).join("");
  const speak = segments.filter((seg) => seg.speak).map((seg) => seg.text).join("");
  const writeMarkup = segments
    .filter((seg) => seg.write)
    .map((seg) => {
      const styleAttr = buildInlineStyleAttr(seg.textStyle);
      if (!styleAttr) return seg.text;
      return `<span style="${escapeHtmlAttr(styleAttr)}">${escapeHtml(seg.text)}</span>`;
    })
    .join("");

  const speakPlan = [];
  segments.forEach((seg) => {
    if (!seg.speak || !seg.text) return;
    const last = speakPlan[speakPlan.length - 1];
    const optsKey = JSON.stringify(seg.speech || {});
    if (last && last._optsKey === optsKey) {
      last.text += seg.text;
      return;
    }
    speakPlan.push({
      text: seg.text,
      opts: { ...(seg.speech || {}) },
      _optsKey: optsKey,
    });
  });

  return {
    write,
    speak,
    write_markup: writeMarkup,
    speak_plan: speakPlan.map((item) => ({ text: item.text, opts: item.opts })),
  };
}

function applyLayout() {
  const w = els.board?.clientWidth || window.innerWidth;
  const single = w < 900;
  const split = Math.max(0, Math.min(100, state.defaults.layout_split ?? 60));
  const leftPct = single ? 100 : split;
  const rightPct = single ? 0 : (100 - split);

  const columnsEl = els.textViewport?.closest(".columns");
  if (columnsEl) columnsEl.classList.toggle("single-column", single);

  const leftCol = els.textViewport?.closest(".column.text");
  const rightCol = els.drawViewport?.closest(".column.draw");
  if (leftCol) leftCol.style.flex = `0 0 ${leftPct}%`;
  if (rightCol) rightCol.style.flex = `0 0 ${rightPct}%`;
}

function showBottomBar() {
  if (!els.bottomBar) return;
  els.bottomBar.classList.remove("hidden");
  if (state.hideBarTimer) clearTimeout(state.hideBarTimer);
  state.hideBarTimer = setTimeout(() => {
    if (state.editorOpen) return;
    if (!els.bottomBar.matches(":hover") && !els.bottomBar.contains(document.activeElement)) {
      els.bottomBar.classList.add("hidden");
    }
  }, 1600);
}

function setToggleState(btn, isOn) {
  if (!btn) return;
  btn.classList.toggle("is-on", !!isOn);
  btn.setAttribute("aria-pressed", isOn ? "true" : "false");
}

function updateMuteIcon() {
  if (!els.muteBtn) return;
  if (state.muted) {
    els.muteBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 6 H6 L9 3 V13 L6 10 H3 Z" fill="currentColor"></path>
        <path d="M11 5 L14 11 M14 5 L11 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>
      </svg>
    `;
    return;
  }
  els.muteBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 6 H6 L9 3 V13 L6 10 H3 Z" fill="currentColor"></path>
      <path d="M11 6.2 Q12.4 8 11 9.8" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"></path>
      <path d="M12.5 4.5 Q14.6 8 12.5 11.5" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"></path>
    </svg>
  `;
}

function showCenterPlay(onClick) {
  if (!els.centerPlay) return;
  els.centerPlay.style.display = "flex";
  if (els.centerPlayBtn) {
    els.centerPlayBtn.onclick = onClick || null;
  }
}

function hideCenterPlay() {
  if (!els.centerPlay) return;
  els.centerPlay.style.display = "none";
  els.centerPlayBtn.onclick = null;
}

function scrollColumnToBottom(targetEl) {
  const viewport = (targetEl === els.drawContent) ? els.drawViewport : els.textViewport;
  if (!viewport) return;
  const scrollNow = () => {
    const top = Math.max(0, viewport.scrollHeight);
    viewport.scrollTo({ top, behavior: "smooth" });
    const last = targetEl.lastElementChild;
    if (last && typeof last.scrollIntoView === "function") {
      last.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  };
  scrollNow();
  requestAnimationFrame(() => {
    scrollNow();
    requestAnimationFrame(scrollNow);
  });
}

function registerElement(id, payload) {
  if (!id) return;
  state.elements.set(id, payload);
}

function getElement(id) {
  return state.elements.get(id);
}

function registerCodeCell(cell, codeEl) {
  if (!cell || !codeEl) return;
  const id = `code-cell-${state.codeCells.length + 1}`;
  const entry = {
    id,
    cell,
    codeEl,
    overlay: null,
    wrap: null,
    highlightSpec: null,
    highlightToken: 0,
  };
  state.codeCells.push(entry);
  cell.dataset.codeCellId = id;
  if (codeEl.tagName === "TEXTAREA") {
    codeEl.addEventListener("input", () => {
      if (entry.highlightSpec) {
        renderCodeHighlight(entry, entry.highlightSpec);
      }
    });
    codeEl.addEventListener("scroll", () => {
      if (entry.overlay) syncHighlightOverlayScroll(entry);
    });
  }
  return entry;
}

function resolveCodeCell(location) {
  if (!state.codeCells.length) return null;
  const loc = Number(location ?? -1);
  if (Number.isNaN(loc)) return null;
  if (loc < 0) {
    const idx = state.codeCells.length + loc;
    return state.codeCells[idx] || null;
  }
  if (loc === 0) return state.codeCells[state.codeCells.length - 1] || null;
  return state.codeCells[loc - 1] || null;
}

function getImageBlocks() {
  const nodes = [];
  columns.forEach((col) => {
    const content = col.content;
    if (!content) return;
    content.querySelectorAll(".image-block").forEach((el) => nodes.push(el));
  });
  nodes.sort((a, b) => {
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  return nodes;
}

function resolveImageTarget(action = {}) {
  if (action.id) {
    const reg = getElement(action.id);
    if (!reg) return null;
    if (reg.type === "image" && reg.container && reg.overlay && reg.img) {
      return reg;
    }
    const container = reg.container || reg.el || null;
    if (!container) return null;
    const img = container.querySelector?.("img") || null;
    const overlay = container.querySelector?.(".image-overlay") || null;
    if (!img || !overlay) return null;
    return { type: "image", container, img, overlay };
  }
  const blocks = getImageBlocks();
  if (!blocks.length) return null;
  const index = Number(action.index ?? -1);
  const idx = Number.isNaN(index)
    ? blocks.length - 1
    : index < 0
      ? blocks.length + index
      : index === 0
        ? blocks.length - 1
        : index - 1;
  const container = blocks[idx];
  if (!container) return null;
  const img = container.querySelector("img");
  const overlay = container.querySelector(".image-overlay");
  if (!img || !overlay) return null;
  return { type: "image", container, img, overlay };
}

function toPercent(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return n;
}

function clampPercent(v) {
  return Math.max(0, Math.min(100, Number(v) || 0));
}

function sizeToPercent(sizeRaw, fallback = 24) {
  const key = String(sizeRaw ?? "").toLowerCase().trim();
  if (!key) return fallback;
  if (key === "small" || key === "s") return 16;
  if (key === "large" || key === "l") return 36;
  if (key === "medium" || key === "m") return 24;
  const n = Number(key);
  if (!Number.isNaN(n)) return n;
  return fallback;
}

function parseGridSpec(gridRaw) {
  const raw = String(gridRaw ?? "").trim().toLowerCase();
  if (!raw) return null;
  const m = raw.match(/^(\d+)\s*[x,]\s*(\d+)$/);
  if (!m) return null;
  const cols = Number(m[1]);
  const rows = Number(m[2]);
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) return null;
  return { cols, rows };
}

function parseGridCellSpec(action = {}) {
  if (action.cell !== undefined && action.cell !== null && action.cell !== "") {
    const raw = String(action.cell).trim().toLowerCase();
    const m = raw.match(/^(\d+)\s*[x,]\s*(\d+)$/);
    if (m) return { col: Number(m[1]), row: Number(m[2]) };
  }
  const col = Number(action.col ?? action.column);
  const row = Number(action.row);
  if (Number.isFinite(col) && Number.isFinite(row)) return { col, row };
  return null;
}

function resolveImageMarkRect(action = {}) {
  const size = action.size ?? state.defaults.image_mark_size ?? "medium";
  const defaultW = sizeToPercent(size, 24);
  const defaultH = sizeToPercent(size, 18);
  let w = toPercent(action.w ?? action.width, defaultW);
  let h = toPercent(action.h ?? action.height, defaultH);

  const shape = String(action.shape || state.defaults.image_mark_shape || "rect").toLowerCase();
  if ((action.h ?? action.height) === undefined && shape === "circle") {
    h = w;
  }

  let x = toPercent(action.x, null);
  let y = toPercent(action.y, null);
  const whereRaw = String(action.where ?? action.preset ?? "").toLowerCase().trim();
  const where = whereRaw.replace(/[-\s]+/g, "_");

  // Precedence: explicit x/y > grid+cell > where > center.
  if (x === null || y === null) {
    const gridSpec = parseGridSpec(action.grid ?? state.defaults.image_mark_grid ?? "3x3");
    const cellSpec = parseGridCellSpec(action);
    if (gridSpec && cellSpec) {
      const col = Math.max(1, Math.min(gridSpec.cols, Number(cellSpec.col) || 1));
      const row = Math.max(1, Math.min(gridSpec.rows, Number(cellSpec.row) || 1));
      const cx = ((col - 0.5) / gridSpec.cols) * 100;
      const cy = ((row - 0.5) / gridSpec.rows) * 100;
      if (x === null) x = cx - w / 2;
      if (y === null) y = cy - h / 2;
    }
  }

  if (x === null || y === null) {
    const pad = toPercent(action.pad ?? action.padding, 6);
    const anchor = where || "center";
    const horiz = anchor.endsWith("_left")
      ? "left"
      : anchor.endsWith("_right")
        ? "right"
        : (anchor.endsWith("_center") || anchor === "center")
          ? "center"
          : null;
    const vert = anchor.startsWith("top_")
      ? "top"
      : anchor.startsWith("bottom_")
        ? "bottom"
        : (anchor.startsWith("middle_") || anchor === "center")
          ? "middle"
          : null;

    const hPos = horiz || "center";
    const vPos = vert || "middle";

    if (x === null) {
      if (hPos === "left") x = pad;
      else if (hPos === "right") x = 100 - w - pad;
      else x = (100 - w) / 2;
    }
    if (y === null) {
      if (vPos === "top") y = pad;
      else if (vPos === "bottom") y = 100 - h - pad;
      else y = (100 - h) / 2;
    }
  }

  x = clampPercent(x);
  y = clampPercent(y);
  w = Math.max(1, clampPercent(w));
  h = Math.max(1, clampPercent(h));
  if (x + w > 100) x = Math.max(0, 100 - w);
  if (y + h > 100) y = Math.max(0, 100 - h);
  return { x, y, w, h };
}

function parseMoveRect(action = {}, current = null) {
  if (typeof action.move_to === "string" && action.move_to.trim()) {
    const parts = action.move_to.split(",").map((p) => Number(p.trim()));
    if (parts.length >= 4 && parts.every((n) => !Number.isNaN(n))) {
      return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    }
  }
  const x = toPercent(action.x_to ?? action.to_x, null);
  const y = toPercent(action.y_to ?? action.to_y, null);
  const w = toPercent(action.w_to ?? action.width_to, null);
  const h = toPercent(action.h_to ?? action.height_to, null);
  if (x === null && y === null && w === null && h === null) return null;
  const base = current || { x: 0, y: 0, w: 24, h: 18 };
  return {
    x: x ?? base.x,
    y: y ?? base.y,
    w: w ?? base.w,
    h: h ?? base.h,
  };
}

async function ensureImageReady(img, tokenAtStart) {
  if (!img) return;
  if (img.complete && (img.naturalWidth || img.naturalHeight)) return;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
      resolve();
    };
    const onLoad = () => finish();
    const onError = () => finish();
    img.addEventListener("load", onLoad, { once: true });
    img.addEventListener("error", onError, { once: true });
    const timer = setTimeout(finish, 1200);
    if (tokenAtStart !== state.cancelToken) {
      clearTimeout(timer);
      finish();
    }
  });
}

function resolveImageContentMetrics(resolved) {
  const container = resolved?.container;
  const img = resolved?.img;
  if (!container || !img) return null;
  const cRect = container.getBoundingClientRect();
  const iRect = img.getBoundingClientRect();
  const containerW = Math.max(1, cRect.width || container.clientWidth || 1);
  const containerH = Math.max(1, cRect.height || container.clientHeight || 1);
  const boxX = (iRect.left - cRect.left);
  const boxY = (iRect.top - cRect.top);
  const boxW = Math.max(1, iRect.width || img.clientWidth || 1);
  const boxH = Math.max(1, iRect.height || img.clientHeight || 1);

  let contentX = boxX;
  let contentY = boxY;
  let contentW = boxW;
  let contentH = boxH;

  const natW = img.naturalWidth || 0;
  const natH = img.naturalHeight || 0;
  const fit = String(window.getComputedStyle(img).objectFit || "fill").toLowerCase();
  if (natW > 0 && natH > 0 && (fit === "contain" || fit === "cover")) {
    const scale = fit === "cover"
      ? Math.max(boxW / natW, boxH / natH)
      : Math.min(boxW / natW, boxH / natH);
    const drawnW = natW * scale;
    const drawnH = natH * scale;
    contentW = drawnW;
    contentH = drawnH;
    contentX = boxX + (boxW - drawnW) / 2;
    contentY = boxY + (boxH - drawnH) / 2;
  }

  return { containerW, containerH, contentX, contentY, contentW, contentH };
}

function mapImageRectToOverlayPercent(rect, metrics) {
  if (!metrics) return rect;
  const pxLeft = metrics.contentX + (rect.x / 100) * metrics.contentW;
  const pxTop = metrics.contentY + (rect.y / 100) * metrics.contentH;
  const pxW = (rect.w / 100) * metrics.contentW;
  const pxH = (rect.h / 100) * metrics.contentH;
  return {
    x: (pxLeft / metrics.containerW) * 100,
    y: (pxTop / metrics.containerH) * 100,
    w: (pxW / metrics.containerW) * 100,
    h: (pxH / metrics.containerH) * 100,
  };
}

function getMarkableElements() {
  const selector = ".code-input-wrap, .table-block, .line";
  const nodes = [];
  columns.forEach((col) => {
    const content = col.content;
    if (!content) return;
    content.querySelectorAll(selector).forEach((el) => nodes.push(el));
  });
  nodes.sort((a, b) => {
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  return nodes.map((el) => {
    if (el.classList.contains("code-input-wrap")) {
      const entry = state.codeCells.find((item) => item.wrap === el);
      return { type: "code", el, entry: entry || null };
    }
    if (el.classList.contains("table-block")) return { type: "table", el };
    return { type: "text", el };
  });
}

function resolveMarkTarget(action) {
  if (action.id) {
    const reg = getElement(action.id);
    const baseEl = reg?.container || reg?.el || null;
    if (!baseEl) return null;
    if (baseEl.classList.contains("code-input-wrap")) {
      const entry = state.codeCells.find((item) => item.wrap === baseEl);
      return { type: "code", el: baseEl, entry: entry || null };
    }
    if (baseEl.classList.contains("table-block")) return { type: "table", el: baseEl };
    if (baseEl.classList.contains("line")) return { type: "text", el: baseEl };
    return { type: "text", el: baseEl };
  }
  const list = getMarkableElements();
  let filtered = list;
  const targetKind = String(action.target || "").toLowerCase();
  if (targetKind === "code" || targetKind === "table" || targetKind === "text") {
    filtered = list.filter((item) => item.type === targetKind);
  }
  if (!filtered.length) return null;
  const index = Number(action.index ?? -1);
  const idx = Number.isNaN(index)
    ? filtered.length - 1
    : index < 0
      ? filtered.length + index
      : index === 0
        ? filtered.length - 1
        : index - 1;
  const item = filtered[idx];
  return item || null;
}

function applySkinDefaults(defaults) {
  const skin = defaults?.skin;
  if (!skin) return { ...defaults };
  const preset = skinDefaultsMap[String(skin).toLowerCase()];
  if (!preset) return { ...defaults };
  return { ...preset, ...defaults };
}

function applyThemeDefaults(defaults) {
  const root = document.documentElement;
  const fontBody = defaults?.font_family;
  const fontCode = defaults?.code_font_family;
  if (fontBody) root.style.setProperty("--font-body", fontBody);
  if (fontCode) root.style.setProperty("--font-code", fontCode);
  const scale = defaults?.font_scale ?? 1.0;
  const codeBase = defaults?.code_font_size_px != null ? Number(defaults.code_font_size_px) : 13;
  if (Number.isFinite(codeBase)) root.style.setProperty("--font-code-size", `${codeBase * scale}px`);
  if (defaults?.output_font_size_px !== undefined && defaults?.output_font_size_px !== null) {
    const outSize = Number(defaults.output_font_size_px);
    if (Number.isFinite(outSize)) root.style.setProperty("--font-output-size", `${outSize * scale}px`);
  }
  const contentUiBase = 12;
  root.style.setProperty("--content-ui-font-size", `${contentUiBase * scale}px`);
  if (defaults?.write_gap !== undefined) {
    const gap = defaults.write_gap;
    root.style.setProperty("--write-gap", typeof gap === "number" ? `${gap}px` : String(gap));
  }
  if (defaults?.board_color) {
    root.style.setProperty("--board", String(defaults.board_color));
  }
  if (defaults?.svg_max_height !== undefined) {
    root.style.setProperty("--svg-max-height", String(defaults.svg_max_height));
  }
  if (defaults?.output_bg) {
    root.style.setProperty("--output-bg", String(defaults.output_bg));
  }
  if (defaults?.output_fg) {
    root.style.setProperty("--output-fg", String(defaults.output_fg));
  }
  if (defaults?.output_border) {
    root.style.setProperty("--output-border", String(defaults.output_border));
  }
}

function ensureHighlightOverlay(entry) {
  if (!entry || !entry.wrap) return null;
  if (entry.overlay) return entry.overlay;
  const overlay = document.createElement("div");
  overlay.className = "code-highlight-layer";
  overlay.setAttribute("aria-hidden", "true");
  entry.wrap.prepend(overlay);
  entry.overlay = overlay;
  syncHighlightOverlayStyle(entry);
  return overlay;
}

function syncHighlightOverlayStyle(entry) {
  if (!entry?.overlay || !entry?.codeEl) return;
  const style = window.getComputedStyle(entry.codeEl);
  entry.overlay.style.fontFamily = style.fontFamily;
  entry.overlay.style.fontSize = style.fontSize;
  entry.overlay.style.lineHeight = style.lineHeight;
  entry.overlay.style.letterSpacing = style.letterSpacing;
  entry.overlay.style.padding = style.padding;
  entry.overlay.style.borderRadius = style.borderRadius;
}

function syncHighlightOverlayScroll(entry) {
  if (!entry?.overlay || !entry?.codeEl) return;
  const left = entry.codeEl.scrollLeft || 0;
  const top = entry.codeEl.scrollTop || 0;
  entry.overlay.style.transform = `translate(${-left}px, ${-top}px)`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeHtmlAttr(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getAnnotateType(spec) {
  const raw = spec.effect ?? spec.annotate ?? spec.highlight_effect ?? "highlight";
  if (raw === false || raw === 0) return "none";
  const type = String(raw).toLowerCase().trim();
  if (!type || type === "none" || type === "off" || type === "false") return "none";
  return type;
}

function buildAnnotateAttrString(spec) {
  const type = getAnnotateType(spec);
  if (type === "none") return "";
  let attrs = ` data-annotate="${escapeHtmlAttr(type)}"`;
  const color = spec.rough_color ?? spec.color ?? "rgba(250, 204, 21, 0.65)";
  if (color) attrs += ` color="${escapeHtmlAttr(color)}"`;
  const animate = spec.animate ?? spec.rough_animate;
  if (animate === undefined) {
    attrs += ` animate="true"`;
  } else {
    attrs += ` animate="${escapeHtmlAttr(animate)}"`;
  }
  const padding = spec.rough_padding ?? spec.padding;
  if (padding !== undefined) attrs += ` padding="${escapeHtmlAttr(padding)}"`;
  const strokeWidth = spec.rough_stroke_width ?? spec.stroke_width;
  if (strokeWidth !== undefined) attrs += ` strokeWidth="${escapeHtmlAttr(strokeWidth)}"`;
  const animationDuration = spec.rough_animation_duration ?? spec.animation_duration;
  if (animationDuration !== undefined) attrs += ` animationDuration="${escapeHtmlAttr(animationDuration)}"`;
  return attrs;
}

function wrapFirstTextMatch(root, needle, caseSensitive = false) {
  if (!root || !needle) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const needleText = String(needle);
  const needleCmp = caseSensitive ? needleText : needleText.toLowerCase();
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const value = node.nodeValue || "";
    const haystack = caseSensitive ? value : value.toLowerCase();
    const idx = haystack.indexOf(needleCmp);
    if (idx === -1) continue;
    const before = value.slice(0, idx);
    const match = value.slice(idx, idx + needleText.length);
    const after = value.slice(idx + needleText.length);
    const span = document.createElement("span");
    span.textContent = match;
    const frag = document.createDocumentFragment();
    if (before) frag.appendChild(document.createTextNode(before));
    frag.appendChild(span);
    if (after) frag.appendChild(document.createTextNode(after));
    node.parentNode.replaceChild(frag, node);
    return span;
  }
  return null;
}

function pickElementByLocation(selector, location) {
  const nodes = [...document.querySelectorAll(selector)];
  if (!nodes.length) return null;
  const loc = Number(location ?? -1);
  if (Number.isNaN(loc)) return nodes[nodes.length - 1];
  if (loc < 0) return nodes[nodes.length + loc] || null;
  if (loc === 0) return nodes[nodes.length - 1] || null;
  return nodes[loc - 1] || null;
}

function getAnnotateText(action) {
  return action.text || action.word || action.value || action.annotate_text || action.match_text;
}

function pickLatestElement(selectors = []) {
  let latest = null;
  selectors.forEach((selector) => {
    const list = document.querySelectorAll(selector);
    if (!list.length) return;
    const candidate = list[list.length - 1];
    if (!latest) {
      latest = candidate;
      return;
    }
    if (latest.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING) {
      latest = candidate;
    }
  });
  return latest;
}

function getFocusableElements() {
  return [
    ...document.querySelectorAll(
      ".line, .draw-block, .question-block, .webr-cell, .pyodide-cell, .brython-cell, .js-cell, .table-block, .svg-block, .p5-block, .image-block, .msg"
    ),
  ];
}

function parseIndexSpec(spec, total) {
  if (spec === undefined || spec === null || spec === "") return null;
  if (Array.isArray(spec)) {
    return spec.flatMap((item) => parseIndexSpec(item, total) || []);
  }
  if (typeof spec === "number") {
    const idx = spec === 0 ? total - 1 : (spec < 0 ? total + spec : spec - 1);
    return Number.isFinite(idx) ? [idx] : null;
  }
  const raw = String(spec).trim();
  if (!raw) return null;
  if (raw.includes(",")) {
    return raw.split(",").flatMap((part) => parseIndexSpec(part.trim(), total) || []);
  }
  if (raw.includes(":")) {
    const [startRaw, endRaw] = raw.split(":");
    const startVal = startRaw === "" ? null : Number(startRaw);
    const endVal = endRaw === "" ? null : Number(endRaw);
    if (startVal === null && endVal !== null && endVal < 0) {
      const count = Math.min(total, Math.abs(endVal));
      return Array.from({ length: count }, (_, i) => total - count + i);
    }
    let startIdx = 0;
    let endIdx = total - 1;
    if (startVal !== null && !Number.isNaN(startVal)) {
      startIdx = startVal < 0 ? total + startVal : startVal - 1;
    }
    if (endVal !== null && !Number.isNaN(endVal)) {
      endIdx = endVal < 0 ? total + endVal : endVal - 1;
    }
    startIdx = Math.max(0, Math.min(total - 1, startIdx));
    endIdx = Math.max(0, Math.min(total - 1, endIdx));
    if (endIdx < startIdx) [startIdx, endIdx] = [endIdx, startIdx];
    return Array.from({ length: endIdx - startIdx + 1 }, (_, i) => startIdx + i);
  }
  const num = Number(raw);
  if (!Number.isNaN(num)) return parseIndexSpec(num, total);
  return null;
}

function setDimForIndices(indices, enable = true) {
  const elements = getFocusableElements();
  if (!elements.length) return;
  if (!enable) {
    elements.forEach((el) => el.classList.remove("dimmed"));
    return;
  }
  const keep = new Set((indices || []).filter((i) => i >= 0 && i < elements.length));
  elements.forEach((el, idx) => {
    if (keep.has(idx)) el.classList.remove("dimmed");
    else el.classList.add("dimmed");
  });
}

function clearDimAll() {
  getFocusableElements().forEach((el) => el.classList.remove("dimmed"));
}

function undimIndices(indices) {
  const elements = getFocusableElements();
  (indices || []).forEach((idx) => {
    const el = elements[idx];
    if (el) el.classList.remove("dimmed");
  });
}

function autoDimLatest(optionalEl) {
  if (!state.dimEnabled) return;
  state.dimEnabled = true;
  const elements = getFocusableElements();
  if (!elements.length) return;
  let index = elements.length - 1;
  if (optionalEl) {
    const idx = elements.indexOf(optionalEl);
    if (idx >= 0) index = idx;
  }
  setDimForIndices([index], true);
}

async function runTextAnnotate(baseEl, action, tokenAtStart, opts = {}) {
  if (!baseEl || !window.RoughNotation) return;
  const permanent = action.permanent ?? false;
  if (opts.instant && !permanent) return;
  const textRoot = baseEl.querySelector?.(".md") || baseEl;
  const matchText = getAnnotateText(action);
  const caseSensitive = action.case_sensitive ?? false;
  const targetEl = matchText ? (wrapFirstTextMatch(textRoot, matchText, caseSensitive) || baseEl) : baseEl;
  if (!targetEl) return;
  const typeOverride = action.effect || action.style || action.annotation || action.kind || "highlight";
  const cfg = buildRoughConfig(targetEl, String(typeOverride).toLowerCase());
  if (action.rough_color !== undefined || action.color !== undefined) cfg.color = action.rough_color ?? action.color;
  if (action.rough_padding !== undefined || action.padding !== undefined) cfg.padding = action.rough_padding ?? action.padding;
  if (action.rough_stroke_width !== undefined || action.stroke_width !== undefined) cfg.strokeWidth = action.rough_stroke_width ?? action.stroke_width;
  if (action.rough_animation_duration !== undefined || action.animation_duration !== undefined) {
    cfg.animationDuration = action.rough_animation_duration ?? action.animation_duration;
  }
  if (action.animate !== undefined) cfg.animate = action.animate;
  if (opts.instant) cfg.animate = false;
  if (action.multiline !== undefined) cfg.multiline = action.multiline;
  if (action.iterations !== undefined) cfg.iterations = action.iterations;
  if (action.brackets !== undefined) cfg.brackets = action.brackets;
  if (action.rtl !== undefined) cfg.rtl = action.rtl;

  const ann = window.RoughNotation.annotate(targetEl, cfg);
  ann.show();

  if (opts.instant) return;

  const pulse = action.pulse;
  if (pulse) {
    const count = pulse === true ? 2 : Math.max(1, Number(pulse) || 1);
    for (let i = 0; i < count; i++) {
      await sleep(700, tokenAtStart);
      ann.hide();
      await sleep(150, tokenAtStart);
      ann.show();
    }
  }

  if (action.speak) await speakText(action.speak, tokenAtStart, action);

  const durationSec = action.duration ?? action.seconds;
  if (!permanent && durationSec === undefined && action.speak) {
    ann.hide();
    return;
  }
  if (!permanent) {
    const waitMs = Math.max(0, Number(durationSec ?? 1.2)) * 1000;
    await sleep(waitMs, tokenAtStart);
    ann.hide();
  }
}

async function runTableAnnotate(table, action, tokenAtStart, opts = {}) {
  if (!window.RoughNotation || !table) return;
  const matchText = getAnnotateText(action);
  if (!matchText) {
    console.warn("annotate_table needs text/word/value.");
    return;
  }
  const caseSensitive = action.case_sensitive ?? false;
  const targetEl = wrapFirstTextMatch(table, matchText, caseSensitive);
  if (!targetEl) {
    console.warn("No matching table cell text for annotate_table.");
    return;
  }
  await runTextAnnotate(targetEl, action, tokenAtStart, opts);
}

async function runWholeElementMark(containerEl, action, tokenAtStart, opts = {}) {
  if (!containerEl || !window.RoughNotation) return;
  const permanent = action.permanent ?? false;
  if (opts.instant && !permanent) return;
  const typeOverride = action.effect || action.style || action.annotation || action.kind || "circle";
  const cfg = buildRoughConfig(containerEl, String(typeOverride).toLowerCase());
  if (action.rough_color !== undefined || action.color !== undefined) cfg.color = action.rough_color ?? action.color;
  if (action.rough_padding !== undefined || action.padding !== undefined) cfg.padding = action.rough_padding ?? action.padding;
  if (action.rough_stroke_width !== undefined || action.stroke_width !== undefined) cfg.strokeWidth = action.rough_stroke_width ?? action.stroke_width;
  if (action.animate !== undefined) cfg.animate = action.animate;
  if (opts.instant) cfg.animate = false;

  const ann = window.RoughNotation.annotate(containerEl, cfg);
  ann.show();

  if (opts.instant) return;

  if (action.speak) await speakText(action.speak, tokenAtStart, action);

  const durationSec = action.duration ?? action.seconds;
  if (!permanent && durationSec === undefined && action.speak) {
    ann.hide();
    return;
  }
  if (!permanent) {
    const waitMs = Math.max(0, Number(durationSec ?? 1.2)) * 1000;
    await sleep(waitMs, tokenAtStart);
    ann.hide();
  }
}

async function runImageMark(action, tokenAtStart, opts = {}) {
  await ensureRoughNotation();
  const resolved = resolveImageTarget(action);
  if (!resolved) {
    console.warn("No image target found for mark_image.");
    return;
  }
  await ensureImageReady(resolved.img, tokenAtStart);
  const permanent = action.permanent ?? false;
  if (opts.instant && !permanent) return;

  const overlay = resolved.overlay;
  const shape = String(action.shape ?? state.defaults.image_mark_shape ?? "rect").toLowerCase();
  const logicalRect = resolveImageMarkRect(action);
  const metrics = resolveImageContentMetrics(resolved);
  const rect = mapImageRectToOverlayPercent(logicalRect, metrics);
  const fillOpacity = action.opacity ?? action.mark_opacity ?? state.defaults.image_mark_opacity ?? 0.24;
  const fillColor = resolveMarkColor(action.color ?? state.defaults.image_mark_color ?? "yellow", fillOpacity);
  const strokeColor = String(action.stroke_color ?? action.stroke ?? action.color ?? state.defaults.image_mark_color ?? "#facc15");
  const strokeWidth = Number(action.stroke_width ?? state.defaults.image_mark_stroke_width ?? 2);
  const labelPos = String(action.label_pos ?? state.defaults.image_mark_label_pos ?? "top").toLowerCase();
  const labelOffset = Number(action.label_offset ?? action.offset ?? state.defaults.image_mark_label_offset ?? 10);

  const markEl = document.createElement("div");
  markEl.className = "image-mark-shape";
  markEl.style.left = `${rect.x}%`;
  markEl.style.top = `${rect.y}%`;
  markEl.style.width = `${rect.w}%`;
  markEl.style.height = `${rect.h}%`;
  markEl.style.border = `${Math.max(1, strokeWidth)}px solid ${strokeColor}`;
  markEl.style.background = fillColor;
  markEl.style.borderRadius = (shape === "circle") ? "999px" : "10px";

  const shouldAnimate = (action.animate ?? state.defaults.image_mark_animate ?? true) && !opts.instant;
  if (shouldAnimate) {
    markEl.style.opacity = "0";
    markEl.style.transform = "scale(0.985)";
    markEl.style.transition = "opacity 260ms ease, transform 260ms ease, left 320ms ease, top 320ms ease, width 320ms ease, height 320ms ease";
  } else {
    markEl.style.transition = "left 320ms ease, top 320ms ease, width 320ms ease, height 320ms ease";
  }
  overlay.appendChild(markEl);
  if (shouldAnimate) {
    requestAnimationFrame(() => {
      markEl.style.opacity = "1";
      markEl.style.transform = "scale(1)";
    });
  }

  const pulse = action.pulse ?? false;
  if (pulse) markEl.classList.add("pulse");

  const labelText = action.text ?? action.label ?? "";
  let labelEl = null;
  if (labelText) {
    const label = document.createElement("div");
    label.className = "image-mark-label";
    {
      const m = getMd();
      label.innerHTML = typeof m.renderInline === "function" ? m.renderInline(String(labelText)) : escapeHtml(String(labelText));
    }
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    label.style.left = `${cx}%`;
    label.style.top = `${cy}%`;
    if (labelPos === "bottom" || labelPos === "under") {
      label.style.transform = `translate(-50%, calc(50% + ${labelOffset}px))`;
    } else if (labelPos === "left") {
      label.style.transform = `translate(calc(-100% - ${labelOffset}px), -50%)`;
    } else if (labelPos === "right") {
      label.style.transform = `translate(${labelOffset}px, -50%)`;
    } else if (labelPos === "center") {
      label.style.transform = "translate(-50%, -50%)";
    } else {
      label.style.transform = `translate(-50%, calc(-100% - ${labelOffset}px))`;
    }
    overlay.appendChild(label);
    labelEl = label;
  }

  const moveRectRaw = parseMoveRect(action, logicalRect);
  if (moveRectRaw && !opts.instant) {
    const moveLogical = resolveImageMarkRect({ ...action, ...moveRectRaw, where: undefined, preset: undefined, size: undefined });
    const moveRect = mapImageRectToOverlayPercent(moveLogical, resolveImageContentMetrics(resolved));
    const moveMs = Math.max(0, Number(action.move_duration_ms ?? action.move_ms ?? action.move_duration ?? 700));
    if (moveMs > 0) await sleep(moveMs, tokenAtStart);
    markEl.style.left = `${moveRect.x}%`;
    markEl.style.top = `${moveRect.y}%`;
    markEl.style.width = `${moveRect.w}%`;
    markEl.style.height = `${moveRect.h}%`;
  }

  if (opts.instant) return;

  if (action.speak) await speakText(action.speak, tokenAtStart, action);

  if (!permanent) {
    const durationSec = action.duration ?? action.seconds ?? state.defaults.image_mark_duration ?? 1.4;
    await sleep(Math.max(0, Number(durationSec)) * 1000, tokenAtStart);
    markEl.remove();
    if (labelEl) labelEl.remove();
  }
}

function buildHighlightStyle() {
  return "";
}

function collectMatchRanges(text, spec) {
  const query = String(spec.code_text || spec.text || "").trim();
  const ranges = [];
  if (!query) return ranges;
  const caseSensitive = spec.case_sensitive ?? false;
  const isRegex = spec.regex ?? false;
  if (isRegex) {
    let flags = "g";
    if (!caseSensitive) flags += "i";
    let re;
    try {
      re = new RegExp(query, flags);
    } catch (err) {
      console.warn("Invalid highlight regex:", err);
      return ranges;
    }
    let match;
    while ((match = re.exec(text)) !== null) {
      if (!match[0]) {
        re.lastIndex += 1;
        continue;
      }
      ranges.push([match.index, match.index + match[0].length]);
    }
    return ranges;
  }
  const source = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  let idx = 0;
  while ((idx = source.indexOf(needle, idx)) !== -1) {
    ranges.push([idx, idx + needle.length]);
    idx += needle.length || 1;
  }
  return ranges;
}

function renderHighlightRanges(text, ranges, styleCss, spec) {
  if (!ranges.length) return escapeHtml(text);
  const out = [];
  let cursor = 0;
  const sorted = ranges
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .sort((a, b) => a[0] - b[0]);
  for (const [start, end] of sorted) {
    if (start > cursor) {
      out.push(escapeHtml(text.slice(cursor, start)));
    }
    const annotateAttrs = buildAnnotateAttrString(spec);
    const styleAttr = styleCss ? ` style="${styleCss}"` : "";
    out.push(`<span class="code-highlight"${annotateAttrs}${styleAttr}>${escapeHtml(text.slice(start, end))}</span>`);
    cursor = end;
  }
  if (cursor < text.length) out.push(escapeHtml(text.slice(cursor)));
  return out.join("");
}

function renderLineHighlights(text, spec, styleCss) {
  const lines = String(text).split("\n");
  const lineStart = Number(spec.line_start ?? spec.line ?? 0);
  const lineEnd = Number(spec.line_end ?? spec.line ?? 0);
  const start = lineStart > 0 ? lineStart : 0;
  const end = lineEnd > 0 ? lineEnd : 0;
  if (!start && !end) return escapeHtml(text);
  const from = start || end;
  const to = end || start;
  const annotateAttrs = buildAnnotateAttrString(spec);
  const styleAttr = styleCss ? ` style="${styleCss}"` : "";
  const out = lines.map((line, idx) => {
    const lineNo = idx + 1;
    if (lineNo >= from && lineNo <= to) {
      return `<span class="code-highlight"${annotateAttrs}${styleAttr}>${escapeHtml(line)}</span>`;
    }
    return escapeHtml(line);
  });
  return out.join("\n");
}

function renderCodeHighlight(entry, spec) {
  if (!entry || !spec) return;
  const overlay = ensureHighlightOverlay(entry);
  if (!overlay) return;
  syncHighlightOverlayStyle(entry);
  const text = entry.codeEl?.value ?? entry.codeEl?.textContent ?? "";
  if (!text) {
    console.warn("No code text to highlight.");
    return;
  }
  const styleCss = buildHighlightStyle(spec);
  let html = "";
  if (spec.line || spec.line_start || spec.line_end) {
    html = renderLineHighlights(text, spec, styleCss);
  } else {
    const ranges = collectMatchRanges(text, spec);
    if (!ranges.length) {
      console.warn("No matches for code highlight.");
      return;
    }
    if (spec.all) {
      html = renderHighlightRanges(text, ranges, styleCss, spec);
    } else {
      const occurrence = Number(spec.occurrence ?? 1);
      const idx = Math.max(1, occurrence) - 1;
      const pick = ranges[idx] ? [ranges[idx]] : [ranges[0]];
      html = renderHighlightRanges(text, pick, styleCss, spec);
    }
  }
  overlay.innerHTML = html;
  if (window.RoughNotation) {
    applyRoughAnnotations(overlay);
  }
  entry.highlightSpec = spec;
  syncHighlightOverlayScroll(entry);
}

function clearCodeHighlight(entry, token) {
  if (!entry?.overlay) return;
  if (token && entry.highlightToken !== token) return;
  entry.overlay.innerHTML = "";
  entry.highlightSpec = null;
}

async function runCodeHighlight(action, tokenAtStart, opts = {}) {
  const entry = resolveCodeCell(action.location);
  if (!entry) {
    console.warn("No code cell found for highlight.");
    return;
  }
  const spec = {
    ...action,
    code_text: action.code_text ?? action.text ?? action.markdown ?? "",
    style: String(action.style || action.highlight_style || action.kind || "background").toLowerCase(),
  };
  const highlightDefaults = getHighlightDefaults();
  if (spec.effect === undefined && highlightDefaults.effect) spec.effect = highlightDefaults.effect;
  if (spec.color === undefined && highlightDefaults.color) spec.color = highlightDefaults.color;
  if (spec.animate === undefined && highlightDefaults.animate !== undefined) spec.animate = highlightDefaults.animate;
  const token = (entry.highlightToken = (entry.highlightToken || 0) + 1);
  if (opts.instant) {
    if (action.permanent) renderCodeHighlight(entry, spec);
    return;
  }
  renderCodeHighlight(entry, spec);
  const speakTextValue = action.speak || action.speak_text || "";
  const permanent = action.permanent ?? false;
  const durationSec = (action.duration ?? action.seconds);
  if (speakTextValue) {
    await speakText(speakTextValue, tokenAtStart, action);
    if (!permanent && durationSec === undefined) {
      clearCodeHighlight(entry, token);
      return;
    }
  }
  if (permanent) return;
  const waitMs = Math.max(0, Number(durationSec ?? 1.2)) * 1000;
  await sleep(waitMs, tokenAtStart);
  clearCodeHighlight(entry, token);
}

function applyTooltip(el, text) {
  if (!text) return;
  if (el.namespaceURI === "http://www.w3.org/2000/svg") {
    let title = el.querySelector("title");
    if (!title) {
      title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      el.prepend(title);
    }
    title.textContent = text;
  } else {
    el.title = text;
  }
}

function setTextContent(reg, markdown, fontSize) {
  const html = getMd().render(markdown || "");
  reg.foreignDiv.innerHTML = html;
  reg.foreignDiv.dataset.contentRole = "body";
  reg.foreignDiv.style.fontSize = fontSize + "px";
  if (reg.svg && reg.foreign && reg.width) {
    const height = Math.max(24, Math.ceil(reg.foreignDiv.getBoundingClientRect().height || 0));
    reg.svg.setAttribute("height", String(height));
    reg.svg.setAttribute("viewBox", `0 0 ${reg.width} ${height}`);
    reg.foreign.setAttribute("height", String(height));
  }
  updateAllColumns();
}

function resolveLocation(loc, fallback) {
  const w = els.board?.clientWidth || window.innerWidth;
  const split = Number(state.defaults.layout_split ?? 60);
  const single = w < 900 || split >= 100;
  if (single) return "left";
  const value = (loc || fallback || "left").toLowerCase();
  return value === "right" ? "right" : "left";
}

function resolveResultLocation(loc, fallback) {
  const value = loc ?? fallback ?? "right";
  if (typeof value === "string" && value.toLowerCase() === "inside") return "inside";
  return resolveLocation(value, fallback);
}

const pauseOnClickDefaults = {
  write: true,
  write_speak: true,
  speak: true,
  math: true,
  draw: true,
  new_drawing: true,
  mermaid: true,
  message: true,
  question: false,
  pyodide: false,
  webr: false,
  js: false,
  html: false,
  img: false,
  image: false,
  video: false,
  youtube: false,
  link: false,
  accordion: false,
  table: false,
  svg: false,
  pdf: false,
  p5: false,
  xplainer_link: false,
  brython: false,
};

function resolvePauseOnClick(actionType, action = {}) {
  if (action && action.pause_on_click !== undefined) return !!action.pause_on_click;
  if (actionType && pauseOnClickDefaults[actionType] !== undefined) {
    return pauseOnClickDefaults[actionType];
  }
  if (state.defaults.pause_on_click !== undefined) return !!state.defaults.pause_on_click;
  return true;
}

function applyPauseOnClick(el, actionType, action = {}) {
  if (!el) return;
  const shouldPause = resolvePauseOnClick(actionType, action);
  el.dataset.pauseOnClick = shouldPause ? "true" : "false";
}

let brythonLoaded = false;

async function ensureBrythonLoaded() {
  if (brythonLoaded) return;
  await new Promise((resolve, reject) => {
    const core = document.createElement("script");
    core.src = "https://cdn.jsdelivr.net/npm/brython@3.12.0/brython.min.js";
    core.onload = () => {
      const stdlib = document.createElement("script");
      stdlib.src = "https://cdn.jsdelivr.net/npm/brython@3.12.0/brython_stdlib.js";
      stdlib.onload = () => {
        try {
          if (typeof brython === "function") {
            brython();
          }
          brythonLoaded = true;
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      stdlib.onerror = () => reject(new Error("Failed to load Brython standard library"));
      document.head.appendChild(stdlib);
    };
    core.onerror = () => reject(new Error("Failed to load Brython core"));
    document.head.appendChild(core);
  });
}

async function ensureBrythonSharedModule() {
  await ensureBrythonLoaded();
  if (window.brythonSharedModule && typeof window.brythonSharedModule._execute_code === "function") {
    return;
  }
  if (typeof __BRYTHON__ === "undefined" || !__BRYTHON__ || typeof __BRYTHON__.runPythonSource !== "function") {
    throw new Error("Brython runtime is not available");
  }
  window.brythonSharedModule = __BRYTHON__.runPythonSource(`
import sys
import json
from io import StringIO

_shared_vars = {}
_output_buffer = StringIO()
_original_stdout = sys.stdout

def _capture_output():
    sys.stdout = _output_buffer

def _restore_output():
    sys.stdout = _original_stdout
    output = _output_buffer.getvalue()
    _output_buffer.seek(0)
    _output_buffer.truncate()
    return output

from browser import DOMNode, document

def _get_plotly_spec(obj):
    try:
        if hasattr(obj, 'to_json') and callable(getattr(obj, 'to_json')):
            s = obj.to_json()
            return s if isinstance(s, str) else json.dumps(s)
        if hasattr(obj, 'to_plotly_json') and callable(getattr(obj, 'to_plotly_json')):
            return json.dumps(obj.to_plotly_json())
        if hasattr(obj, 'data') and hasattr(obj, 'layout'):
            spec = {'data': getattr(obj, 'data', None), 'layout': getattr(obj, 'layout', None)}
            return json.dumps(spec)
    except Exception:
        pass
    return None

def _show(obj):
    if obj is None:
        return None
    elif isinstance(obj, str):
        return obj
    elif isinstance(obj, DOMNode):
        return obj
    plotly_spec = _get_plotly_spec(obj)
    if plotly_spec is not None:
        return "plotlyplot:" + plotly_spec
    if hasattr(obj, 'to_html') and callable(getattr(obj, 'to_html')):
        try:
            div = document.createElement("div")
            div.className = "brython-dataframe"
            div.innerHTML = obj.to_html()
            return div
        except Exception:
            pass
    if hasattr(obj, '_show'):
        return obj._show()
    return str(obj)

def show(obj):
    return _show(obj)

_shared_vars['show'] = show

def _execute_code(code):
    try:
        _capture_output()
        exec(code, _shared_vars)
        lines = code.strip().split(chr(10))
        if lines:
            last_line = lines[-1].strip()
            if last_line and not last_line.startswith('#'):
                try:
                    result = eval(last_line, _shared_vars)
                    show_result = _show(result)
                    if show_result is not None:
                        return show_result
                except Exception:
                    pass
        return _restore_output()
    except Exception as e:
        _restore_output()
        return "Error: " + str(e)
`, {});
  if (!window.brythonSharedModule || typeof window.brythonSharedModule._execute_code !== "function") {
    throw new Error("Failed to initialize Brython shared environment");
  }
}

async function runBrythonCode(code) {
  await ensureBrythonSharedModule();
  let result;
  try {
    result = window.brythonSharedModule._execute_code(String(code || ""));
  } catch (err) {
    return "Error: " + String(err && err.message ? err.message : err);
  }
  return result;
}

function loadWebComponentScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load web component script: ${url}`));
    document.head.appendChild(script);
  });
}

async function runWebComponentDefine(action) {
  const tag = action.tag && String(action.tag).trim();
  if (!tag || !tag.includes("-")) return;
  const meta = {
    body_attr: action.body_attr ?? "content",
    shadow: action.shadow !== false,
  };
  if (action.script) {
    const url = String(action.script).trim();
    if (!url) return;
    await loadWebComponentScript(url);
    webComponentRegistry[tag] = meta;
    return;
  }
  const code = action.code && String(action.code).trim();
  const lang = (action.lang && String(action.lang).toLowerCase()) || "js";
  if (code) {
    if (lang === "brython") {
      await ensureBrythonSharedModule();
      try {
        await runBrythonCode(code);
      } catch (err) {
        console.warn("[webcomponent] Brython define failed for", tag, err);
        return;
      }
    } else {
      try {
        (function () {
          const customElements = window.customElements;
          const document = window.document;
          eval(code);
        })();
      } catch (err) {
        console.warn("[webcomponent] JS define failed for", tag, err);
        return;
      }
    }
  }
  webComponentRegistry[tag] = meta;
}

async function runWebComponentDefinitions(commands) {
  if (!Array.isArray(commands)) return;
  for (const cmd of commands) {
    if (cmd && cmd.type === "webcomponent") {
      try {
        await runWebComponentDefine(cmd);
      } catch (err) {
        console.warn("[webcomponent] Define failed:", cmd.tag, err);
      }
    }
  }
}

function applyWebDefaults(commands) {
  if (!Array.isArray(commands)) return;
  if (!state.webComponentBodyAttrDefaults) state.webComponentBodyAttrDefaults = {};
  for (const cmd of commands) {
    if (cmd && cmd.type === "web_defaults" && cmd.mappings && typeof cmd.mappings === "object") {
      Object.assign(state.webComponentBodyAttrDefaults, cmd.mappings);
    }
  }
}

let plotlyLoaded = false;
let plotlyLoading = null;

function ensurePlotlyLoaded() {
  if (plotlyLoaded) return Promise.resolve();
  if (plotlyLoading) return plotlyLoading;
  plotlyLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.plot.ly/plotly-2.32.0.min.js";
    script.onload = () => {
      plotlyLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load Plotly.js"));
    document.head.appendChild(script);
  });
  return plotlyLoading;
}

function renderBrythonResult(result, outputEl) {
  if (!outputEl) return;
  outputEl.innerHTML = "";
  if (result == null) return;
  const isDomNode = (val) =>
    typeof Node !== "undefined" && val instanceof Node
    || val && typeof val === "object" && "nodeType" in val && val.nodeType === 1;

  const renderPlotlyInto = (el, spec) => {
    if (!el) return;
    el.style.width = "100%";
    el.style.minWidth = "0";
    // Ensure container is in the DOM
    if (!el.parentNode) {
      outputEl.appendChild(el);
    }
    ensurePlotlyLoaded()
      .then(() => {
        if (typeof Plotly === "undefined") {
          return;
        }
        try {
          const rawSpec = spec || {};
          let data;
          let layout = {};
          let config = {};
          if (rawSpec.type === "plotly") {
            data = rawSpec.data;
            layout = rawSpec.layout || {};
            config = rawSpec.config || {};
          } else if (Array.isArray(rawSpec)) {
            data = rawSpec;
          } else {
            data = rawSpec.data || rawSpec;
            layout = rawSpec.layout || {};
            config = rawSpec.config || {};
          }
          // Omit width so Plotly fills container; only set height. Strips Python's default width.
          const defaultHeight = 380;
          const effectiveLayout = {
            margin: { t: 40, r: 20, b: 40, l: 50 },
            autosize: true,
            ...layout,
            height: layout.height != null ? layout.height : defaultHeight,
          };
          delete effectiveLayout.width;
          const effectiveConfig = { responsive: true, ...(config || {}) };
          Plotly.newPlot(el, data, effectiveLayout, effectiveConfig);
          const doResize = () => {
            try {
              if (el.isConnected && typeof Plotly !== "undefined" && Plotly.Plots && Plotly.Plots.resize) {
                Plotly.Plots.resize(el);
              }
            } catch (_) {}
          };
          if (typeof ResizeObserver !== "undefined") {
            const ro = new ResizeObserver(() => doResize());
            ro.observe(el);
            el._plotlyResizeObserver = ro;
          }
          requestAnimationFrame(() => requestAnimationFrame(doResize));
          setTimeout(doResize, 150);
          setTimeout(doResize, 400);
        } catch (err) {
          const pre = document.createElement("pre");
          pre.textContent = "Error rendering Plotly plot: " + String(err && err.message ? err.message : err);
          outputEl.appendChild(pre);
        }
      })
      .catch((err) => {
        const pre = document.createElement("pre");
        pre.textContent = "Error loading Plotly.js: " + String(err && err.message ? err.message : err);
        outputEl.appendChild(pre);
      });
  };

  // DOM node result: check for Plotly spec first
  if (isDomNode(result)) {
    const el = result;
    const spec = el.__plotlySpec
      || (el.dataset && el.dataset.plotlySpec ? (() => {
        try { return JSON.parse(el.dataset.plotlySpec); } catch { return null; }
      })() : null);
    if (spec) {
      renderPlotlyInto(el, spec);
    } else {
      outputEl.appendChild(el);
    }
    return;
  }

  // Object envelope from Brython (e.g. { type: "table", columns, data } or { type: "html", html })
  if (result && typeof result === "object") {
    if (result.type === "html" && typeof result.html === "string") {
      const wrap = document.createElement("div");
      wrap.className = "brython-html-output";
      wrap.innerHTML = result.html;
      outputEl.appendChild(wrap);
      return;
    }
    if (result.type === "table" && Array.isArray(result.columns) && Array.isArray(result.data)) {
      const table = document.createElement("table");
      table.className = "brython-dataframe";
      const thead = document.createElement("thead");
      const tr = document.createElement("tr");
      result.columns.forEach((col) => {
        const th = document.createElement("th");
        th.textContent = col;
        tr.appendChild(th);
      });
      thead.appendChild(tr);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      result.data.forEach((row) => {
        const tr = document.createElement("tr");
        (Array.isArray(row) ? row : Object.values(row)).forEach((cell) => {
          const td = document.createElement("td");
          td.textContent = cell;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      outputEl.appendChild(table);
      return;
    }
  }

  const text = String(result);
  if (!text) return;

  // String-encoded plotly spec: "plotlyplot:<json>"
  if (text.startsWith("plotlyplot:")) {
    const jsonStr = text.slice("plotlyplot:".length);
    try {
      const spec = JSON.parse(jsonStr);
      const div = document.createElement("div");
      div.className = "brython-plotly-container";
      div.style.width = "100%";
      div.style.minWidth = "0";
      outputEl.appendChild(div);
      renderPlotlyInto(div, spec);
      return;
    } catch {
      // Fall through to plain text rendering if JSON parse fails
    }
  }

  const pre = document.createElement("pre");
  pre.textContent = text;
  outputEl.appendChild(pre);
}

function applyCssFromSpec(container, cssSpec) {
  if (!container || !cssSpec || typeof cssSpec !== "object") return;
  let target = container;
  let targetIndex = null;
  const styleEntries = [];

  for (const [key, value] of Object.entries(cssSpec)) {
    if (key === "target_index") {
      const idx = Number(value);
      if (Number.isFinite(idx) && idx >= 0) {
        targetIndex = Math.floor(idx);
      }
      continue;
    }
    if (value === undefined || value === null) continue;
    styleEntries.push([key, value]);
  }

  if (targetIndex !== null && container.children && container.children.length > targetIndex) {
    target = container.children[targetIndex];
  }

  if (!styleEntries.length) return;

  const toKebab = (prop) => prop.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

  styleEntries.forEach(([prop, rawVal]) => {
    const name = toKebab(prop);
    let val = String(rawVal);
    let important = "";
    if (/\!important\s*$/i.test(val)) {
      important = "important";
      val = val.replace(/\!important\s*$/i, "").trim();
    }
    target.style.setProperty(name, val, important);
  });
}

function getColumnForLocation(loc) {
  return loc === "right" ? els.drawContent : els.textContent;
}

function showContinueButtonLowerRight(labelMarkdown, tokenAtStart) {
  return new Promise((resolve) => {
    const label = labelMarkdown ? markdownToText(labelMarkdown) : "Continue";
    let settled = false;
    let cancelTimer = null;
    // Declared up front: done() can run before the overlay is built (no board).
    let wrap = null;
    // This is a deliberate pause, not a stall — tell the watchdog to hold off.
    beginUserInputWait();
    const done = () => {
      if (settled) return;
      settled = true;
      endUserInputWait();
      state.waitingForClick = null;
      if (cancelTimer) clearInterval(cancelTimer);
      if (wrap && wrap.parentNode) wrap.remove();
      resolve();
    };
    state.waitingForClick = done;
    if (!els.board) { done(); return; }
    els.board.querySelectorAll(".continue-overlay").forEach((el) => el.remove());
    wrap = document.createElement("div");
    wrap.className = "continue-overlay";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = label;
    btn.innerHTML = label + ' <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5 L18 12 L8 19 Z" fill="currentColor"></path></svg>';
    btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); done(); };
    wrap.appendChild(btn);
    els.board.appendChild(wrap);
    if (typeof tokenAtStart === "number") {
      cancelTimer = setInterval(() => {
        if (tokenAtStart !== state.cancelToken) done();
      }, 120);
    }
  });
}

async function waitForClick(labelMarkdown, location, tokenAtStart) {
  return showContinueButtonLowerRight(labelMarkdown, tokenAtStart);
}

function showWaitNextButton(tokenAtStart) {
  return waitForClick("Next", "right", tokenAtStart);
}

function showWaitClickScreen(tokenAtStart) {
  return waitForClick("Continue", "right", tokenAtStart);
}

function isMovieMode() {
  return (state.defaults.execution_mode || "presentation").toLowerCase() === "movie";
}


async function renderQuestion(question, requireAnswer, instant, tokenAtStart, location, drawLocation) {
  const target = getColumnForLocation(resolveLocation(location, "left"));
  const block = document.createElement("div");
  block.className = "question-block";
  applyPauseOnClick(block, "question", question);
  const label = document.createElement("div");
  label.className = "label";
  label.textContent = "Question";
  block.appendChild(label);
  target.appendChild(block);
  scrollColumnToBottom(target);

  if (question.id) {
    registerElement(question.id, { type: "html", container: block });
  }

  renderMarkdownBlock(
    question.markdown || "",
    { font_size_px: question.font_size_px, muted: question.muted, pause_on_click_type: "question", pause_on_click: question.pause_on_click },
    block
  );

  const drawCommands = question.draw_commands || [];
  if (Array.isArray(drawCommands) && drawCommands.length) {
    const drawLoc = resolveLocation(drawLocation || state.defaults.draw_location, "right");
    for (const cmd of drawCommands) {
      if (tokenAtStart !== state.cancelToken) return;
      if (cmd.type === "new_drawing") {
        const loc = resolveLocation(cmd.location, drawLoc);
        const targetColumn = getColumnForLocation(loc);
        if (cmd.title) {
          const t = renderMarkdownBlock(cmd.title, { role: "title", pause_on_click_type: "draw", pause_on_click: cmd.pause_on_click }, targetColumn);
          t.container.classList.add("figure-title");
        }
        if (cmd.subtitle) {
          const s = renderMarkdownBlock(cmd.subtitle, { role: "subtitle", muted: true, pause_on_click_type: "draw", pause_on_click: cmd.pause_on_click }, targetColumn);
          s.container.classList.add("figure-subtitle");
        }
        state.currentDrawContext = createDrawBlock(
          cmd.size ?? state.defaults.draw_height_px ?? 160,
          targetColumn,
          { id: cmd.id, pause_on_click: cmd.pause_on_click, pause_on_click_type: "draw" }
        );
        if (cmd.footnote) {
          const f = renderMarkdownBlock(cmd.footnote, { role: "footnote", muted: true, pause_on_click_type: "draw", pause_on_click: cmd.pause_on_click }, targetColumn);
          f.container.classList.add("figure-footnote");
        }
        continue;
      }
      if (!state.currentDrawContext) {
        const loc = resolveLocation(drawLocation || state.defaults.draw_location, "right");
        const targetColumn = getColumnForLocation(loc);
        state.currentDrawContext = createDrawBlock(state.defaults.draw_height_px ?? 160, targetColumn, { pause_on_click_type: "draw" });
      }
      const cmdSafe = { ...cmd, speak: instant ? null : cmd.speak };
      await runDrawCommand(cmdSafe, tokenAtStart, state.currentDrawContext, {
        speed: cmd.draw_speed_sec_per_100 ?? state.defaults.draw_speed_sec_per_100 ?? 1.0,
        animate: instant ? false : (cmd.animate ?? state.defaults.draw_animate ?? true),
        stroke_width: cmd.stroke_width ?? state.defaults.stroke_width ?? 1.0,
        draw_stroke_alpha: cmd.draw_stroke_alpha ?? state.defaults.draw_stroke_alpha ?? 0.85,
      });
    }
  }

  const choices = Array.isArray(question.choices) ? question.choices : [];
  const choiceWrap = document.createElement("div");
  choiceWrap.className = "question-choices";
  block.appendChild(choiceWrap);

  const correctIndices = new Set(
    Array.isArray(question.correct_indices)
      ? question.correct_indices
      : (typeof question.correct_index === "number" ? [question.correct_index] : [])
  );
  if (question.correct_choice && choices.length) {
    const idx = choices.indexOf(question.correct_choice);
    if (idx >= 0) correctIndices.add(idx);
  }
  if (Array.isArray(question.correct_choices)) {
    for (const c of question.correct_choices) {
      const idx = choices.indexOf(c);
      if (idx >= 0) correctIndices.add(idx);
    }
  }

  if (!choices.length) {
    if (question.answer) showAnswer();
    return;
  }

  let resolveAnswer;
  let answered = false;
  const waitForAnswer = new Promise((resolve) => {
    resolveAnswer = resolve;
  });
  const mustBeTrue = question.must_be_true ?? false;

  for (const [idx, choice] of choices.entries()) {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.textContent = choice;
    btn.onclick = () => {
      if (correctIndices.size) {
        for (const [i, el] of [...choiceWrap.children].entries()) {
          if (correctIndices.has(i)) {
            el.style.borderColor = "rgba(34,197,94,.85)";
            el.style.background = "rgba(34,197,94,.15)";
          }
        }
        if (!correctIndices.has(idx)) {
          btn.style.borderColor = "rgba(239,68,68,.9)";
          btn.style.background = "rgba(239,68,68,.15)";
        }
      } else {
        btn.style.borderColor = "rgba(34,197,94,.85)";
        btn.style.background = "rgba(34,197,94,.15)";
      }
      updateAllColumns();
      if (resolveAnswer && !answered) {
        if (!mustBeTrue || !correctIndices.size || correctIndices.has(idx)) {
          answered = true;
          resolveAnswer();
        }
      }
    };
    choiceWrap.appendChild(btn);
  }

  if (instant || !requireAnswer) {
    updateAllColumns();
    return { waitForAnswer };
  }

  // Blocking on the viewer's answer is a deliberate pause, not a stall.
  await awaitUserInput(waitForAnswer);
  return { waitForAnswer };
}

/**
 * Await a promise that is blocked on the viewer, with the stall watchdog held
 * off for its duration. Always balanced, even if the promise rejects.
 */
async function awaitUserInput(promise) {
  beginUserInputWait();
  try {
    return await promise;
  } finally {
    endUserInputWait();
  }
}

function getTargetIds(action) {
  if (action.id) return [action.id];
  if (Array.isArray(action.ids)) return action.ids;
  return [];
}

function applyHighlight(reg, color) {
  if (reg.type === "text" || reg.type === "html") {
    reg.container.style.background = color || "rgba(96,165,250,.2)";
    reg.container.style.borderRadius = "8px";
    return;
  }
  if (reg.type === "svg") {
    reg.el.setAttribute("stroke", color || "var(--accent)");
    reg.el.setAttribute("stroke-width", String(parseFloat(reg.el.getAttribute("stroke-width") || "1.8") + 0.4));
  }
}

function applyUnderline(reg, color) {
  if (reg.type === "text") {
    reg.foreignDiv.style.textDecoration = "underline";
    reg.foreignDiv.style.textDecorationColor = color || "var(--accent)";
    return;
  }
  if (reg.type === "html") {
    reg.container.style.textDecoration = "underline";
    reg.container.style.textDecorationColor = color || "var(--accent)";
    return;
  }
  if (reg.type === "svg") {
    try {
      const bbox = reg.el.getBBox();
      const line = svgEl("line", {
        x1: bbox.x,
        x2: bbox.x + bbox.width,
        y1: 100 - (bbox.y - 1),
        y2: 100 - (bbox.y - 1),
        stroke: color || "var(--accent)",
        "stroke-width": "1.2",
      });
      reg.el.ownerSVGElement?.appendChild(line);
    } catch {}
  }
}

function applyMove(reg, action) {
  const dx = action.dx ?? 0;
  const dy = action.dy ?? 0;
  const x = action.x;
  const y = action.y;
  reg.transform = reg.transform || { x: 0, y: 0, rotate: 0, cx: 0, cy: 0 };
  const prev = { ...reg.transform };
  reg.transform.x = (typeof x === "number") ? x : reg.transform.x + dx;
  reg.transform.y = (typeof y === "number") ? y : reg.transform.y + dy;
  if (reg.type === "text" || reg.type === "html") {
    reg.container.style.transform = `translate(${reg.transform.x}px, ${reg.transform.y}px) rotate(${reg.transform.rotate}deg)`;
    return;
  }
  if (reg.type === "svg") {
    if (action.animate) {
      const anim = svgEl("animateTransform", {
        attributeName: "transform",
        type: "translate",
        from: `${prev.x} ${prev.y}`,
        to: `${reg.transform.x} ${reg.transform.y}`,
        dur: `${action.duration ?? 0.4}s`,
        fill: "freeze",
      });
      reg.el.appendChild(anim);
    }
    reg.el.setAttribute("transform", `translate(${reg.transform.x} ${reg.transform.y}) rotate(${reg.transform.rotate} ${reg.transform.cx} ${reg.transform.cy})`);
  }
}

function applyRotate(reg, action) {
  const deg = action.deg ?? action.rotate ?? 0;
  reg.transform = reg.transform || { x: 0, y: 0, rotate: 0, cx: 0, cy: 0 };
  const prev = { ...reg.transform };
  reg.transform.rotate = deg;
  reg.transform.cx = action.cx ?? reg.transform.cx;
  reg.transform.cy = action.cy ?? reg.transform.cy;
  if (reg.type === "text" || reg.type === "html") {
    reg.container.style.transform = `translate(${reg.transform.x}px, ${reg.transform.y}px) rotate(${reg.transform.rotate}deg)`;
    return;
  }
  if (reg.type === "svg") {
    if (action.animate) {
      const anim = svgEl("animateTransform", {
        attributeName: "transform",
        type: "rotate",
        from: `${prev.rotate} ${reg.transform.cx} ${reg.transform.cy}`,
        to: `${reg.transform.rotate} ${reg.transform.cx} ${reg.transform.cy}`,
        dur: `${action.duration ?? 0.4}s`,
        fill: "freeze",
      });
      reg.el.appendChild(anim);
    }
    reg.el.setAttribute("transform", `translate(${reg.transform.x} ${reg.transform.y}) rotate(${reg.transform.rotate} ${reg.transform.cx} ${reg.transform.cy})`);
  }
}

function applyChange(reg, action) {
  if (reg.type === "text") {
    const markdown = action.markdown ?? action.text;
    if (markdown !== undefined) {
      const fontSize = action.font_size_px ?? contentFontPx("body");
      setTextContent(reg, markdown, fontSize);
    }
    if (action.color) reg.foreignDiv.style.color = action.color;
    return;
  }
  if (reg.type === "html") {
    if (action.html !== undefined) reg.container.innerHTML = action.html;
    if (action.color) reg.container.style.color = action.color;
    updateAllColumns();
    return;
  }
  if (reg.type === "svg") {
    if (action.attrs && typeof action.attrs === "object") {
      for (const [k, v] of Object.entries(action.attrs)) {
        reg.el.setAttribute(k, String(v));
      }
    }
    if (action.stroke) reg.el.setAttribute("stroke", action.stroke);
    if (action.fill) reg.el.setAttribute("fill", action.fill);
  }
}

function applyDelete(regId, reg) {
  try { reg.el?.remove?.(); } catch {}
  try { reg.container?.remove?.(); } catch {}
  state.elements.delete(regId);
  updateAllColumns();
}

function updateFullscreenIcon(isFullscreen) {
  if (!els.fullscreenBtn) return;
  if (isFullscreen) {
    els.fullscreenBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3 H3 V6 M10 3 H13 V6 M13 10 V13 H10 M3 10 V13 H6" stroke="currentColor" stroke-width="1.4" fill="none"></path></svg>';
  } else {
    els.fullscreenBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6 V3 H6 M10 3 H13 V6 M13 10 V13 H10 M6 13 H3 V10" stroke="currentColor" stroke-width="1.4" fill="none"></path></svg>';
  }
}

function sleep(ms, tokenAtStart) {
  // Always resolves. Callers that care about abort re-check the token
  // after awaiting. A promise that silently never resolves would hang
  // Promise.all (e.g. in the write_speak handler) and freeze playback.
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function mathToSpeech(tex) {
  let out = String(tex || "");
  const greek = {
    alpha: "alpha", beta: "beta", gamma: "gamma", delta: "delta",
    epsilon: "epsilon", zeta: "zeta", eta: "eta", theta: "theta",
    iota: "iota", kappa: "kappa", lambda: "lambda", mu: "mu",
    nu: "nu", xi: "xi", omicron: "omicron", pi: "pi",
    rho: "rho", sigma: "sigma", tau: "tau", upsilon: "upsilon",
    phi: "phi", chi: "chi", psi: "psi", omega: "omega",
  };
  out = out.replace(/\\frac\s*\{([^}]+)\}\s*\{([^}]+)\}/g, " fraction $1 over $2 ");
  out = out.replace(/\\sqrt\s*\{([^}]+)\}/g, " square root of $1 ");
  out = out.replace(/\\sum/g, " sum ");
  out = out.replace(/\\int/g, " integral ");
  out = out.replace(/\\infty/g, " infinity ");
  out = out.replace(/\\times/g, " times ");
  out = out.replace(/\\cdot/g, " dot ");
  out = out.replace(/\\pm/g, " plus or minus ");
  out = out.replace(/\\geq|\\ge/g, " greater than or equal to ");
  out = out.replace(/\\leq|\\le/g, " less than or equal to ");
  out = out.replace(/\\neq/g, " not equal to ");
  out = out.replace(/\\approx/g, " approximately ");
  out = out.replace(/\\to/g, " approaches ");
  out = out.replace(/\\left|\\right/g, " ");
  out = out.replace(/\\([a-zA-Z]+)\b/g, (m, name) => ` ${greek[name] || name} `);
  out = out.replace(/\^(\{([^}]+)\}|[^\s]+)/g, (m, g1, g2) => ` to the power of ${g2 || g1.replace(/[{}]/g, "")} `);
  out = out.replace(/_(\{([^}]+)\}|[^\s]+)/g, (m, g1, g2) => ` sub ${g2 || g1.replace(/[{}]/g, "")} `);
  out = out.replace(/[{}]/g, " ");
  out = out.replace(/=/g, " equals ");
  out = out.replace(/\+/g, " plus ");
  out = out.replace(/-/g, " minus ");
  out = out.replace(/\//g, " divided by ");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

function markdownToSpeech(markdown, opts = {}) {
  const source = String(markdown || "");
  if (!source) return "";
  const replaced = source
    .replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => ` ${mathToSpeech(tex)} `)
    .replace(/\$([^$]+)\$/g, (m, tex) => ` ${mathToSpeech(tex)} `)
    .replace(/\\\(([\s\S]+?)\\\)/g, (m, tex) => ` ${mathToSpeech(tex)} `)
    .replace(/\\\[([\s\S]+?)\\\]/g, (m, tex) => ` ${mathToSpeech(tex)} `);
  return markdownToText(replaced);
}

function normalizeSpeechText(text, opts = {}) {
  const raw = String(text || "");
  if (opts.math_to_speech === false) return raw;
  if (opts.speak_markdown) {
    const spoken = markdownToSpeech(raw, opts);
    return spoken || raw;
  }
  if (!raw.includes("$") && !raw.includes("\\")) return raw;
  let out = raw;
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => ` ${mathToSpeech(tex)} `);
  out = out.replace(/\$([^$]+)\$/g, (m, tex) => ` ${mathToSpeech(tex)} `);
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (m, tex) => ` ${mathToSpeech(tex)} `);
  out = out.replace(/\\\[([\s\S]+?)\\\]/g, (m, tex) => ` ${mathToSpeech(tex)} `);
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

function speakText(text, tokenAtStart, opts = {}) {
  return new Promise((resolve) => {
    if (!text || !text.trim()) return resolve();
    // Token already stale? Resolve immediately — never hang.
    if (tokenAtStart !== state.cancelToken) return resolve();

    const spoken = normalizeSpeechText(text, opts);
    updateCaptions(spoken);
    const u = new SpeechSynthesisUtterance(spoken);
    const lang = opts.speech_lang ?? state.defaults.speech_lang ?? "en-US";
    const pref = opts.speech_voice ?? state.defaults.speech_voice;
    u.lang = lang;
    u.rate = (opts.speech_rate ?? state.defaults.speech_rate ?? 1.0) * state.speed;
    const voice = pickVoice(lang, pref);
    if (voice) u.voice = voice;
    if (state.muted) u.volume = 0;

    // Always resolve exactly once, regardless of token state. Callers that
    // need to abort downstream work re-check the token after awaiting.
    let done = false;
    let watchdog = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
      resolve();
    };
    u.onend = finish;
    u.onerror = finish;

    // Chrome watchdog: if the engine silently drops the utterance (known
    // bug on long speeches, tab focus changes, or a wedged internal queue),
    // force-resolve after an estimated max duration + a 6-second safety
    // margin. ~11 chars/sec is a generous upper bound for TTS throughput.
    const rate = u.rate || 1;
    const estSec = Math.max(3, spoken.length / 11 / rate + 6);
    watchdog = setTimeout(() => {
      try { speechSynthesis.cancel(); } catch (_) {}
      finish();
    }, estSec * 1000);

    speechSynthesis.speak(u);
  });
}

async function speakTextPlan(plan, tokenAtStart, baseOpts = {}) {
  if (!Array.isArray(plan) || !plan.length) return;
  for (const part of plan) {
    if (tokenAtStart !== state.cancelToken) return;
    const text = String(part?.text || "");
    if (!text.trim()) continue;
    const segOpts = part?.opts && typeof part.opts === "object" ? part.opts : {};
    await speakText(text, tokenAtStart, { ...baseOpts, ...segOpts });
  }
}

function markdownToText(markdown) {
  const html = getMd().render(markdown || "");
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  return wrap.textContent || "";
}

function resolveExplainCodeMode(action = {}) {
  const raw = action.explain_code ?? state.defaults.explain_code ?? false;
  if (raw === false || raw === null || raw === undefined) return "off";
  if (typeof raw === "string") {
    const mode = raw.trim().toLowerCase();
    if (!mode || mode === "false" || mode === "off" || mode === "none" || mode === "no") return "off";
    if (mode === "all") return "all";
    return "comments";
  }
  if (raw === true) return "comments";
  return raw ? "comments" : "off";
}

function resolveSpeakCodeLanguage(action = {}) {
  const raw = action.speak_code_language ?? state.defaults.speak_code_language ?? "same";
  const val = String(raw ?? "").trim();
  if (!val) return null;
  const mode = val.toLowerCase();
  if (mode === "same" || mode === "default" || mode === "normal" || mode === "current") return null;
  return val;
}

function parseCodeLineForExplain(line, action = {}) {
  const full = String(line ?? "");
  const lang = String(action.type || "").toLowerCase();
  let codePart = full;
  let commentPart = "";
  let commentOnly = false;

  const findHashCommentIndex = (text) => {
    let inSingle = false;
    let inDouble = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\" && (inSingle || inDouble)) {
        escaped = true;
        continue;
      }
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
        continue;
      }
      if (ch === "\"" && !inSingle) {
        inDouble = !inDouble;
        continue;
      }
      if (ch === "#" && !inSingle && !inDouble) {
        return i;
      }
    }
    return -1;
  };

  if (lang === "js") {
    const trimmed = full.trim();
    if (trimmed.startsWith("//")) {
      codePart = "";
      commentPart = trimmed.replace(/^\/\/\s?/, "").trim();
      commentOnly = true;
    } else if (trimmed.startsWith("/*") && trimmed.endsWith("*/")) {
      codePart = "";
      commentPart = trimmed.replace(/^\/\*\s?/, "").replace(/\s?\*\/$/, "").trim();
      commentOnly = true;
    } else {
      const lineCommentIdx = full.indexOf("//");
      if (lineCommentIdx >= 0) {
        codePart = full.slice(0, lineCommentIdx);
        commentPart = full.slice(lineCommentIdx + 2).trim();
      } else {
        const blockMatch = full.match(/^(.*)\/\*\s*([\s\S]*?)\s*\*\/\s*$/);
        if (blockMatch) {
          codePart = blockMatch[1] || "";
          commentPart = (blockMatch[2] || "").trim();
        }
      }
      commentOnly = codePart.trim() === "";
    }
  } else {
    const hashIdx = findHashCommentIndex(full);
    codePart = hashIdx >= 0 ? full.slice(0, hashIdx) : full;
    commentPart = hashIdx >= 0 ? full.slice(hashIdx + 1).trim() : "";
    commentOnly = full.trim().startsWith("#") || codePart.trim() === "";
  }

  const displayPart = commentOnly ? full : codePart;
  return { codePart, commentPart, fullLine: full, commentOnly, displayPart, lang };
}

function parseExplainCommentDirective(parsed) {
  const raw = String(parsed?.commentPart || "").trim();
  if (!raw) return { mode: "none", comment: "" };
  // For # languages the first "#" is consumed in parseCodeLineForExplain,
  // so source "### comment" appears here as "## comment".
  if (raw.startsWith("##")) return { mode: "both_result", comment: raw.replace(/^##+\s*/, "").trim() };
  // For # languages the first "#" is consumed in parseCodeLineForExplain,
  // so source "## comment" appears here as "# comment".
  if (raw.startsWith("#")) return { mode: "both", comment: raw.replace(/^#+\s*/, "").trim() };
  return { mode: "comment", comment: raw };
}

function getExplainLineSpeechPlan(parsed, action = {}, opts = {}) {
  const mode = resolveExplainCodeMode(action);
  const manual = !!opts.manual;
  if (mode === "off" && !manual) return [];
  const commentMeta = parseExplainCommentDirective(parsed);
  const codeSpeak = String(parsed.codePart || "").trim();
  const commentSpeak = commentMeta.comment;
  if (commentMeta.mode === "none") return [];
  if (commentMeta.mode === "comment") {
    return commentSpeak ? [{ text: commentSpeak, opts: {} }] : [];
  }
  if (commentMeta.mode === "both" || commentMeta.mode === "both_result") {
    const out = [];
    const codeLang = resolveSpeakCodeLanguage(action);
    if (codeSpeak) out.push({ text: codeSpeak, opts: codeLang ? { speech_lang: codeLang } : {} });
    if (commentSpeak) out.push({ text: commentSpeak, opts: {} });
    return out;
  }
  return [];
}

function speechPlanToText(plan = []) {
  return plan
    .map((part) => String(part?.text || "").trim())
    .filter(Boolean)
    .join(". ");
}

function getExplainTooltipText(parsed) {
  const commentMeta = parseExplainCommentDirective(parsed);
  return String(commentMeta?.comment || "").trim();
}

function codeRequestsResultSpeech(code, action = {}) {
  const lines = String(code || "").split("\n");
  for (const line of lines) {
    const parsed = parseCodeLineForExplain(line, action);
    const meta = parseExplainCommentDirective(parsed);
    if (meta.mode === "both_result") return true;
  }
  return false;
}

function getRResultSpeechText(result) {
  const out = [];
  if (result?.output?.length) {
    result.output.forEach((o) => {
      if (o?.type === "stderr" || o?.type === "stdout") {
        out.push(String(o?.data ?? "").trim());
      }
    });
  }
  if (result?.error) out.push(String(result.error).trim());
  return out.filter(Boolean).join("\n").trim();
}

function getPyodideResultSpeechText(result) {
  const out = [];
  if (result?.stdout) out.push(String(result.stdout).trim());
  if (result?.stderr) out.push(String(result.stderr).trim());
  if (result?.returned !== undefined && result?.returned !== null && String(result.returned).trim()) {
    out.push(String(result.returned).trim());
  }
  if (result?.error) out.push(String(result.error).trim());
  return out.filter(Boolean).join("\n").trim();
}

async function speakExplainPlan(plan, tokenAtStart, action = {}) {
  for (const part of plan || []) {
    const text = String(part?.text || "").trim();
    if (!text) continue;
    await speakText(text, tokenAtStart, { ...action, speak_markdown: false, ...(part?.opts || {}) });
  }
}

function splitCodeIntoBlocks(code) {
  const lines = (code || "").split("\n");
  const blocks = [];
  let current = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const startsBlock = line.length > 0 && !/^\s/.test(line);
    if (startsBlock && current.length > 0) {
      blocks.push({ code: current.join("\n") });
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push({ code: current.join("\n") });
  return blocks;
}

async function runExplainCode(code, container, endBtn, tokenAtStart, action) {
  const lines = (code || "").split("\n").map((line) => parseCodeLineForExplain(line, action));
  let explainEnded = false;
  endBtn.onclick = () => {
    explainEnded = true;
    speechSynthesis.cancel();
    endBtn.style.display = "none";
  };
  const linesEl = document.createElement("ul");
  linesEl.className = "explain-code-lines";
  container.appendChild(linesEl);
  const showClickTooltip = (anchorEl, text) => {
    if (!text || !anchorEl) return;
    const tip = document.createElement("div");
    tip.className = "explain-code-tooltip";
    tip.textContent = text;
    tip.style.position = "fixed";
    tip.style.zIndex = "1000";
    tip.style.maxWidth = "320px";
    tip.style.padding = "6px 10px";
    tip.style.background = "rgba(15,23,42,.95)";
    tip.style.border = "1px solid rgba(255,255,255,.2)";
    tip.style.borderRadius = "6px";
    tip.style.fontSize = "12px";
    tip.style.color = "var(--chalk)";
    tip.style.boxShadow = "0 4px 12px rgba(0,0,0,.3)";
    tip.style.pointerEvents = "none";
    tip.style.whiteSpace = "pre-wrap";
    tip.style.wordBreak = "break-word";
    document.body.appendChild(tip);
    const rect = anchorEl.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    let left = rect.right + 8;
    if (left + tipRect.width > window.innerWidth - 8) {
      left = rect.left - tipRect.width - 8;
    }
    if (left < 8) left = 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${rect.top}px`;
    setTimeout(() => tip.remove(), 3000);
  };
  for (let i = 0; i < lines.length; i++) {
    if (explainEnded || tokenAtStart !== state.cancelToken) break;
    const parsed = lines[i];
    const { fullLine, displayPart } = parsed;
    const lineEl = document.createElement("li");
    lineEl.className = "explain-code-line";
    lineEl.title = getExplainTooltipText(parsed);
    const textSpan = document.createElement("span");
    textSpan.className = "explain-code-line-text";
    textSpan.textContent = displayPart;
    const speakPlan = getExplainLineSpeechPlan(parsed, action);
    const clickPlan = getExplainLineSpeechPlan(parsed, action, { manual: true });
    const tooltipText = getExplainTooltipText(parsed);
    const doSpeak = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (clickPlan.length) speakExplainPlan(clickPlan, state.cancelToken, action);
      if (tooltipText) showClickTooltip(lineEl, tooltipText);
    };
    lineEl.appendChild(textSpan);
    lineEl.onclick = doSpeak;
    linesEl.appendChild(lineEl);
    lineEl.classList.add("explain-code-line-highlight");
    lineEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (speakPlan.length) await speakExplainPlan(speakPlan, tokenAtStart, action);
    if (explainEnded || tokenAtStart !== state.cancelToken) break;
    lineEl.classList.remove("explain-code-line-highlight");
  }
  if (explainEnded && linesEl.children.length < lines.length) {
    for (let j = linesEl.children.length; j < lines.length; j++) {
      const parsed = lines[j];
      const { fullLine, displayPart } = parsed;
      const lineEl = document.createElement("li");
      lineEl.className = "explain-code-line";
      lineEl.title = getExplainTooltipText(parsed);
      const textSpan = document.createElement("span");
      textSpan.className = "explain-code-line-text";
      textSpan.textContent = displayPart;
      const clickPlan = getExplainLineSpeechPlan(parsed, action, { manual: true });
      const tooltipText = getExplainTooltipText(parsed);
      lineEl.appendChild(textSpan);
      lineEl.onclick = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        if (clickPlan.length) speakExplainPlan(clickPlan, state.cancelToken, action);
        if (tooltipText) showClickTooltip(lineEl, tooltipText);
      };
      linesEl.appendChild(lineEl);
    }
  }
  endBtn.style.display = "none";
}

async function runExplainCodeInBlocks(code, container, endBtn, tokenAtStart, action, runBlock, renderBlockResult) {
  const blocks = splitCodeIntoBlocks(code);
  if (blocks.length === 0) return;
  let explainEnded = false;
  endBtn.onclick = () => {
    explainEnded = true;
    speechSynthesis.cancel();
    endBtn.style.display = "none";
  };
  const linesEl = document.createElement("ul");
  linesEl.className = "explain-code-lines";
  container.appendChild(linesEl);
  const showClickTooltip = (anchorEl, text) => {
    if (!text || !anchorEl) return;
    const tip = document.createElement("div");
    tip.className = "explain-code-tooltip";
    tip.textContent = text;
    tip.style.position = "fixed";
    tip.style.zIndex = "1000";
    tip.style.maxWidth = "320px";
    tip.style.padding = "6px 10px";
    tip.style.background = "rgba(15,23,42,.95)";
    tip.style.border = "1px solid rgba(255,255,255,.2)";
    tip.style.borderRadius = "6px";
    tip.style.fontSize = "12px";
    tip.style.color = "var(--chalk)";
    tip.style.boxShadow = "0 4px 12px rgba(0,0,0,.3)";
    tip.style.pointerEvents = "none";
    tip.style.whiteSpace = "pre-wrap";
    tip.style.wordBreak = "break-word";
    document.body.appendChild(tip);
    const rect = anchorEl.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    let left = rect.right + 8;
    if (left + tipRect.width > window.innerWidth - 8) left = rect.left - tipRect.width - 8;
    if (left < 8) left = 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${rect.top}px`;
    setTimeout(() => tip.remove(), 3000);
  };
  const addLineEl = (linesEl, parsed, action) => {
    const { fullLine, displayPart } = parsed;
    const lineEl = document.createElement("li");
    lineEl.className = "explain-code-line";
    lineEl.title = getExplainTooltipText(parsed);
    const textSpan = document.createElement("span");
    textSpan.className = "explain-code-line-text";
    textSpan.textContent = displayPart;
    const speakPlan = getExplainLineSpeechPlan(parsed, action);
    const clickPlan = getExplainLineSpeechPlan(parsed, action, { manual: true });
    const tooltipText = getExplainTooltipText(parsed);
    lineEl.appendChild(textSpan);
    lineEl.onclick = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (clickPlan.length) speakExplainPlan(clickPlan, state.cancelToken, action);
      if (tooltipText) showClickTooltip(lineEl, tooltipText);
    };
    linesEl.appendChild(lineEl);
    return { lineEl, speakPlan, tooltipText };
  };
  for (const block of blocks) {
    if (explainEnded || tokenAtStart !== state.cancelToken) break;
    const blockLines = (block.code || "").split("\n").map((line) => parseCodeLineForExplain(line, action));
    let lineIndex = 0;
    for (; lineIndex < blockLines.length; lineIndex++) {
      if (explainEnded || tokenAtStart !== state.cancelToken) break;
      const { lineEl, speakPlan } = addLineEl(linesEl, blockLines[lineIndex], action);
      lineEl.classList.add("explain-code-line-highlight");
      lineEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      if (speakPlan.length) await speakExplainPlan(speakPlan, tokenAtStart, action);
      if (explainEnded || tokenAtStart !== state.cancelToken) break;
      lineEl.classList.remove("explain-code-line-highlight");
    }
    if (explainEnded) {
      for (let j = lineIndex; j < blockLines.length; j++) addLineEl(linesEl, blockLines[j], action);
    }
    if (explainEnded || tokenAtStart !== state.cancelToken) break;
    try {
      const result = await runBlock(block.code);
      if (result != null) renderBlockResult(result);
    } catch (err) {
      if (typeof renderBlockResult === "function") renderBlockResult({ error: String(err) });
    }
  }
  endBtn.style.display = "none";
}

function buildExplainCodeView(code, container, action) {
  container.textContent = "";
  const lines = (code || "").split("\n").map((line) => parseCodeLineForExplain(line, action));
  const showClickTooltip = (anchorEl, text) => {
    if (!text || !anchorEl) return;
    const tip = document.createElement("div");
    tip.className = "explain-code-tooltip";
    tip.textContent = text;
    tip.style.position = "fixed";
    tip.style.zIndex = "1000";
    tip.style.maxWidth = "320px";
    tip.style.padding = "6px 10px";
    tip.style.background = "rgba(15,23,42,.95)";
    tip.style.border = "1px solid rgba(255,255,255,.2)";
    tip.style.borderRadius = "6px";
    tip.style.fontSize = "12px";
    tip.style.color = "var(--chalk)";
    tip.style.boxShadow = "0 4px 12px rgba(0,0,0,.3)";
    tip.style.pointerEvents = "none";
    tip.style.whiteSpace = "pre-wrap";
    tip.style.wordBreak = "break-word";
    document.body.appendChild(tip);
    const rect = anchorEl.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    let left = rect.right + 8;
    if (left + tipRect.width > window.innerWidth - 8) {
      left = rect.left - tipRect.width - 8;
    }
    if (left < 8) left = 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${rect.top}px`;
    setTimeout(() => tip.remove(), 3000);
  };
  const linesEl = document.createElement("ul");
  linesEl.className = "explain-code-lines";
  for (let i = 0; i < lines.length; i++) {
    const parsed = lines[i];
    const { fullLine, displayPart } = parsed;
    const lineEl = document.createElement("li");
    lineEl.className = "explain-code-line";
    lineEl.title = getExplainTooltipText(parsed);
    const textSpan = document.createElement("span");
    textSpan.className = "explain-code-line-text";
    textSpan.textContent = displayPart;
    const clickPlan = getExplainLineSpeechPlan(parsed, action, { manual: true });
    const tooltipText = getExplainTooltipText(parsed);
    const doSpeak = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (clickPlan.length) speakExplainPlan(clickPlan, state.cancelToken, action);
      if (tooltipText) showClickTooltip(lineEl, tooltipText);
    };
    lineEl.appendChild(textSpan);
    lineEl.onclick = doSpeak;
    linesEl.appendChild(lineEl);
  }
  container.appendChild(linesEl);
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    el.setAttribute(k, String(v));
  }
  return el;
}

function autoResizeTextarea(textarea, opts = {}) {
  if (!textarea) return;
  const extraLines = Number(opts.extraLines ?? textarea.dataset.extraLines ?? 1);
  const extraPx = Number(opts.extraPx ?? textarea.dataset.extraPx ?? 0);
  const maxLines = Number(opts.maxLines ?? textarea.dataset.maxLines ?? 0);
  const style = window.getComputedStyle(textarea);
  const lineHeight = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 12) * 1.4;
  const padTop = parseFloat(style.paddingTop) || 0;
  const padBottom = parseFloat(style.paddingBottom) || 0;
  const padding = padTop + padBottom;
  const extra = extraPx + Math.max(0, extraLines) * lineHeight;
  const lineCount = Math.max(1, (textarea.value || "").split("\n").length + Math.max(0, extraLines));
  const rowCount = maxLines && maxLines > 0 ? Math.min(maxLines, lineCount) : lineCount;
  textarea.rows = rowCount;
  textarea.style.height = "auto";
  textarea.style.overflowY = "hidden";
  if (maxLines && maxLines > 0) {
    const maxHeight = Math.ceil(maxLines * lineHeight + padding + extra);
    textarea.style.maxHeight = `${maxHeight}px`;
    const desired = Math.ceil(textarea.scrollHeight + extra);
    const height = Math.min(desired, maxHeight);
    if (desired > maxHeight) {
      textarea.style.height = `${height}px`;
      textarea.style.overflowY = "auto";
    } else {
      textarea.style.height = `${height}px`;
    }
    return;
  }
  textarea.style.maxHeight = "";
  textarea.style.height = `${textarea.scrollHeight + extra}px`;
}

function scheduleTextareaResize(textarea, opts = {}) {
  if (!textarea) return;
  autoResizeTextarea(textarea, opts);
  requestAnimationFrame(() => autoResizeTextarea(textarea, opts));
  setTimeout(() => autoResizeTextarea(textarea, opts), 80);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => autoResizeTextarea(textarea, opts));
  }
  try {
    const styles = window.getComputedStyle(textarea);
    console.log("[explainer] textarea resize", {
      lines: (textarea.value || "").split("\n").length,
      rows: textarea.rows,
      scrollHeight: textarea.scrollHeight,
      height: styles.height,
      maxHeight: styles.maxHeight,
    });
  } catch {}
}

function enableTabInTextarea(textarea) {
  if (!textarea || textarea.dataset.tabEnabled) return;
  textarea.dataset.tabEnabled = "1";
  textarea.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const value = textarea.value || "";
    textarea.value = value.slice(0, start) + "\t" + value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = start + 1;
    autoResizeTextarea(textarea);
  });
}

function renderMarkdownBlock(markdown, opts = {}, targetEl = els.textContent) {
  const role = opts.role ?? "body";
  const fontSize = opts.font_size_px ?? opts.font_size ?? contentFontPx(role);
  const text = markdown || opts.text || "";
  const html = getMd().render(text);

  const container = document.createElement("div");
  container.className = "line" + (opts.muted ? " muted" : "");
  if (opts.continued) container.classList.add("continued");
  if (opts.list_item) container.classList.add("list-item");
  if (opts.list_continued) container.classList.add("list-continued");
  container.dataset.contentRole = role;
  container.style.fontSize = fontSize + "px";
  container.style.maxWidth = "100%";
  if (opts.pause_on_click_type || opts.pause_on_click !== undefined) {
    applyPauseOnClick(container, opts.pause_on_click_type, { pause_on_click: opts.pause_on_click });
  }

  const foreignDiv = document.createElement("div");
  foreignDiv.className = "md";
  foreignDiv.style.fontSize = fontSize + "px";
  foreignDiv.innerHTML = html;
  processInlineMarkup(foreignDiv);
  container.appendChild(foreignDiv);
  targetEl.appendChild(container);
  scrollColumnToBottom(targetEl);
  autoDimLatest(container);
  if (opts.list_item) {
    try {
      const styles = window.getComputedStyle(container);
      const rootStyles = window.getComputedStyle(document.documentElement);
      console.log("[explainer] list-item spacing", {
        markdown: String(markdown || "").trim(),
        marginTop: styles.marginTop,
        lineHeight: styles.lineHeight,
        writeGap: rootStyles.getPropertyValue("--write-gap").trim(),
      });
    } catch {}
  }
  if (opts.tooltip) applyTooltip(container, opts.tooltip);
  if (!opts.defer_annotations) applyRoughAnnotations(container);

  if (opts.id) {
    registerElement(opts.id, {
      type: "text",
      container,
      foreignDiv,
    });
  }
  if (opts.css) {
    applyCssFromSpec(container, opts.css);
  }
  requestAnimationFrame(() => {
    updateAllColumns();
    if (!opts.defer_annotations) applyRoughAnnotations(container);
    applyMermaidInContainer(container);
  });

  return { container, plainText: markdownToText(text) };
}


 async function animateWriteReveal(container, plainText, tokenAtStart, opts = {}) {
  const animate = opts.animate ?? state.defaults.write_animate;
  if (!animate) return;
  const reveal = (opts.reveal ?? state.defaults.write_reveal ?? "appear").toLowerCase();
  const cps = opts.write_speed_chars_per_sec ?? state.defaults.write_speed_chars_per_sec ?? 35;
  const steps = Math.min(200, Math.max(1, plainText.length));
  const durSec = Math.max(0.2, plainText.length / Math.max(10, cps)) / state.speed;
  if (reveal === "typewriter") {
    const typeCps = opts.typewriter_cps ?? state.defaults.typewriter_cps ?? cps;
    const minLineMs = opts.typewriter_min_line_ms ?? state.defaults.typewriter_min_line_ms ?? 250;
    const minCapMs = opts.typewriter_min_cap_ms ?? state.defaults.typewriter_min_cap_ms ?? 40;
    const maskPad = opts.typewriter_mask_pad_px ?? state.defaults.typewriter_mask_pad_px ?? 3;
    const listPad = opts.typewriter_list_pad_px ?? state.defaults.typewriter_list_pad_px ?? 0;
    await animateTypewriterLines(container, plainText, tokenAtStart, { cps: typeCps, minLineMs, minCapMs, maskPad, listPad });
    return;
  }
  if (reveal === "left_to_right") {
    container.style.clipPath = "inset(0 100% 0 0)";
    container.style.animationName = "revealX";
    container.style.animationTimingFunction = `steps(${steps})`;
  } else {
    container.style.opacity = "0";
    container.style.animationName = "fadeInText";
    container.style.animationTimingFunction = "ease-out";
    const appearSpeed = opts.write_appear_speed ?? state.defaults.write_appear_speed ?? 0.9;
    const base = Math.max(0.25, plainText.length / Math.max(24, cps));
    const appearDur = base / Math.max(0.2, appearSpeed);
    container.style.animationDuration = appearDur + "s";
    container.style.animationFillMode = "forwards";
    await sleep(appearDur * 1000, tokenAtStart);
    return;
  }
  container.style.animationDuration = durSec + "s";
  container.style.animationFillMode = "forwards";
  await sleep(durSec * 1000, tokenAtStart);
}

/** Group client rects by visual line (same top within ~2px) and merge into one rect per line. */
function mergeRectsByVisualLine(rects, topTolerancePx = 2) {
  if (rects.length <= 1) return rects;
  const byTop = new Map();
  for (const r of rects) {
    const key = Math.round(r.top / topTolerancePx) * topTolerancePx;
    if (!byTop.has(key)) byTop.set(key, []);
    byTop.get(key).push(r);
  }
  return Array.from(byTop.values()).map((group) => {
    const left = Math.min(...group.map((r) => r.left));
    const right = Math.max(...group.map((r) => r.left + r.width));
    const top = Math.min(...group.map((r) => r.top));
    const height = Math.max(...group.map((r) => r.height));
    return { top, left, width: right - left, height };
  });
}

async function animateTypewriterLines(container, plainText, tokenAtStart, opts = {}) {
  if (!container) return;
  const cps = opts.cps ?? 35;
  const minLineMs = opts.minLineMs ?? 250;
  const minCapMs = opts.minCapMs ?? 40;
  const padPx = opts.maskPad ?? 3;
  const listPadPx = opts.listPad ?? 0;
  const totalDuration = Math.max(300, (plainText.length / Math.max(10, cps)) * 1000) / state.speed;

  const overlay = document.createElement("div");
  overlay.className = "typewriter-overlay";
  overlay.style.background = "transparent";

  const rect = container.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(container);
  const rawRects = Array.from(range.getClientRects())
    .filter((r) => r.width > 1 && r.height > 1);
  const rects = mergeRectsByVisualLine(rawRects);

  if (!rects.length) return;
  const prevVisibility = container.style.visibility;
  container.style.position = container.style.position || "relative";
  container.style.visibility = "hidden";
  container.appendChild(overlay);

  const boardEl = els.board;
  const boardStyle = boardEl ? getComputedStyle(boardEl) : null;
  const boardRect = boardEl ? boardEl.getBoundingClientRect() : null;
  const boardBgColor = boardStyle?.backgroundColor || "";
  const boardBgImage = boardStyle?.backgroundImage || "";
  const boardBgSize = boardStyle?.backgroundSize || "";
  const boardBgRepeat = boardStyle?.backgroundRepeat || "";
  const boardBgPosition = boardStyle?.backgroundPosition || "";
  const fallbackBg = getComputedStyle(document.documentElement).getPropertyValue("--board")?.trim()
    || getComputedStyle(container).backgroundColor
    || "#0b1220";
  const perLine = Math.max(minCapMs, totalDuration / rects.length);
  const avgChars = Math.max(6, Math.round(plainText.length / rects.length));
  const steps = Math.min(80, Math.max(6, avgChars));

  const hasList = !!container.querySelector("li");
  const extraLeft = hasList ? listPadPx : 0;
  const lineMasks = rects.map((lineRect) => {
    const line = document.createElement("div");
    line.className = "typewriter-line";
    line.style.top = `${lineRect.top - rect.top}px`;
    line.style.left = `${lineRect.left - rect.left - padPx - extraLeft}px`;
    line.style.height = `${lineRect.height}px`;
    line.style.width = `${lineRect.width + padPx * 2 + extraLeft}px`;
    if (boardBgImage && boardBgImage !== "none" && boardRect) {
      line.style.backgroundColor = boardBgColor;
      line.style.backgroundImage = boardBgImage;
      line.style.backgroundSize = boardBgSize;
      line.style.backgroundRepeat = boardBgRepeat;
      const offsetX = lineRect.left - boardRect.left - padPx - extraLeft;
      const offsetY = lineRect.top - boardRect.top;
      line.style.backgroundPosition = `-${offsetX}px -${offsetY}px`;
    } else {
      line.style.background = (boardBgColor && boardBgColor !== "rgba(0, 0, 0, 0)") ? boardBgColor : fallbackBg;
    }
    line.style.transform = "scaleX(1)";
    line.style.transformOrigin = "right center";
    line.style.transitionProperty = "transform";
    line.style.transitionDuration = `${perLine}ms`;
    line.style.transitionTimingFunction = `steps(${steps})`;
    overlay.appendChild(line);
    return line;
  });

  container.style.visibility = "visible";

  for (const line of lineMasks) {
    if (tokenAtStart !== state.cancelToken) break;
    requestAnimationFrame(() => { line.style.transform = "scaleX(0)"; });
    await sleep(perLine, tokenAtStart);
    line.remove();
  }

  overlay.remove();
  container.style.visibility = prevVisibility;
}


function createDrawBlock(size, targetColumn, meta = {}) {
  const block = document.createElement("div");
  block.className = "draw-block";
  applyPauseOnClick(block, meta.pause_on_click_type || "draw", meta);

  // `size` is the intended drawing area in pixels, interpreted as a square.
  // Accepts a number or a string like "420" or "420px".
  let sizePx = 160;
  if (size != null) {
    const n = typeof size === "number" ? size : parseFloat(String(size));
    if (Number.isFinite(n) && n > 0) sizePx = n;
  }
  block.style.height = `${sizePx}px`;
  block.style.maxWidth = `${sizePx}px`;
  block.style.marginLeft = "auto";
  block.style.marginRight = "auto";

  const svg = svgEl("svg", {
    viewBox: `0 0 ${sizePx} ${sizePx}`,
    preserveAspectRatio: "xMidYMid meet",
    "aria-label": "board canvas",
  });
  svg.style.width = "100%";
  svg.style.height = "100%";

  const defs = svgEl("defs");
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `
    .stroke {
      fill: none;
      stroke: var(--chalk);
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .guide { stroke: rgba(229,231,235,.65); stroke-dasharray: 2.2 1.6; }
    .shade { fill: rgba(96,165,250,.22); stroke: rgba(96,165,250,.85); }
    @keyframes drawStroke { to { stroke-dashoffset: 0; } }
    @keyframes fadeIn { to { opacity: 1; } }
  `;
  defs.appendChild(style);
  svg.appendChild(defs);

  // Single flat drawing layer — no Y flip. Authors use screen coordinates
  // (y increases downward), same as HTML canvas / CSS / every other 2D tool.
  const layerDrawing = svgEl("g");
  const labelLayer = svgEl("g");
  svg.appendChild(layerDrawing);
  svg.appendChild(labelLayer);

  block.appendChild(svg);
  (targetColumn || els.drawContent).appendChild(block);
  scrollColumnToBottom(targetColumn || els.drawContent);
  updateDrawLayout();
  autoDimLatest(block);

  // `plot` is kept as an alias for `layerDrawing` so downstream code that
  // references ctx.plot keeps working. Both point to the same unflipped layer.
  // `sizePx` is published so runDrawCommand can convert cartesian→svg coords
  // with the right constant when coords=cartesian is opted in.
  const ctx = { block, svg, plot: layerDrawing, layerDrawing, labelLayer, sizePx };
  if (meta.id) registerElement(meta.id, { type: "html", container: block });
  return ctx;
}

function applyStrokeDefaults(el, cmd, defaults) {
  const strokeWidth = cmd.stroke_width ?? defaults.stroke_width ?? 1.0;
  el.setAttribute("stroke-width", String(strokeWidth));
  if (!el.getAttribute("stroke")) el.setAttribute("stroke", cmd.stroke ?? "var(--chalk)");
  if (!el.getAttribute("fill")) el.setAttribute("fill", cmd.fill ?? "none");
  const strokeAlpha = cmd.opacity ?? defaults.draw_stroke_alpha ?? state.defaults.draw_stroke_alpha ?? 0.85;
  el.setAttribute("opacity", String(strokeAlpha));
  if (cmd.dash) el.setAttribute("stroke-dasharray", cmd.dash);
}

async function animateDraw(el, tokenAtStart, drawSpeed, explicitDurSec) {
  let L = 0;
  try { L = el.getTotalLength(); } catch { L = 80; }
  const dur = explicitDurSec ?? Math.max(0.12, (L / 100) * (drawSpeed || 1.0)) / state.speed;

  el.style.strokeDasharray = String(L);
  el.style.strokeDashoffset = String(L);
  el.style.animationName = "drawStroke";
  el.style.animationDuration = dur + "s";
  el.style.animationTimingFunction = "linear";
  el.style.animationFillMode = "forwards";

  await new Promise((resolve) => {
    const done = () => {
      el.removeEventListener("animationend", done);
      resolve();
    };
    el.addEventListener("animationend", done);
    // Always resolve: animationend does not fire for zero-length paths or for
    // elements detached mid-animation, and a token bump must not strand the
    // await either (the caller re-checks the token afterwards).
    setTimeout(done, (dur + 0.05) * 1000);
  });
}

async function animateFadeIn(el, tokenAtStart, durSec = 0.4) {
  const dur = durSec / state.speed;
  el.style.opacity = "0";
  el.style.animationName = "fadeIn";
  el.style.animationDuration = dur + "s";
  el.style.animationTimingFunction = "ease-out";
  el.style.animationFillMode = "forwards";
  await new Promise((resolve) => {
    const done = () => {
      el.removeEventListener("animationend", done);
      resolve();
    };
    el.addEventListener("animationend", done);
    // See animateDraw: the fallback timer must resolve unconditionally.
    setTimeout(done, (dur + 0.05) * 1000);
  });
}

function addLabel(drawContext, element, cmd) {
  if (!cmd.label || !drawContext.labelLayer) return;
  const offset = cmd.label_offset ?? 3;
  let x;
  let y;
  let anchor = "middle";
  if (cmd.cmd === "line" && cmd.x1 !== undefined) {
    const dx = (cmd.x2 ?? 0) - (cmd.x1 ?? 0);
    const dy = (cmd.y2 ?? 0) - (cmd.y1 ?? 0);
    const t = cmd.label_t ?? 1.1;
    x = (cmd.x1 ?? 0) + dx * t;
    y = (cmd.y1 ?? 0) + dy * t;
    if (Math.abs(dx) > 0.1) {
      x += Math.sign(dx) * offset;
      anchor = dx > 0 ? "start" : "end";
    }
    if (Math.abs(dy) > 0.1) {
      y += Math.sign(dy) * offset;
    }
  } else {
    let bbox;
    try {
      bbox = element.getBBox();
    } catch {
      return;
    }
    x = bbox.x + bbox.width / 2;
    y = bbox.y + bbox.height / 2;
    const loc = (cmd.label_location || "above").toLowerCase();
    if (loc === "above") y = bbox.y + bbox.height + offset;
    if (loc === "under") y = bbox.y - offset;
    if (loc === "right") { x = bbox.x + bbox.width + offset; anchor = "start"; }
    if (loc === "left") { x = bbox.x - offset; anchor = "end"; }
    if (loc === "center") { x = bbox.x + bbox.width / 2; y = bbox.y + bbox.height / 2; }
  }

  const xSvg = x;
  const ySvg = (cmd.cmd === "line" && cmd.x1 !== undefined) ? (100 - y) : y;
  const text = svgEl("text", {
    x: String(xSvg),
    y: String(ySvg),
    fill: cmd.label_color || "var(--chalk)",
    "text-anchor": anchor,
    "dominant-baseline": "middle",
    "font-size": String((cmd.label_size ?? state.defaults.svg_text_font_size ?? 12) * getScale()),
  });
  text.textContent = cmd.label;
  if (cmd.label_rotation) {
    text.setAttribute("transform", `rotate(${cmd.label_rotation} ${xSvg} ${ySvg})`);
  }
  drawContext.labelLayer.appendChild(text);
  if (cmd.label_id) {
    registerElement(cmd.label_id, { type: "svg", el: text });
  } else if (cmd.id) {
    registerElement(`${cmd.id}:label`, { type: "svg", el: text });
  }
}

async function runDrawCommand(cmd, tokenAtStart, drawContext, drawOpts) {
  // Coordinate system:
  //   "svg" (default)  — screen coordinates, y increases downward. Matches
  //                       HTML canvas, CSS, and every 2D authoring tool. This
  //                       is what LLM authors naturally write and what every
  //                       existing example in examples/ uses.
  //   "cartesian"      — math-style, y increases upward. Authors opt in per
  //                       block or per command via `coords=cartesian`.
  //
  // In cartesian mode, every Y-bearing field is flipped using the actual
  // viewBox size (viewBoxSize - y), so a point with y=0 lands at the bottom
  // of the canvas and y=sizePx at the top — exactly the math-graph convention.
  const viewBoxSize = (drawContext && drawContext.sizePx) || 100;
  const normalizeCoords = (raw) => {
    const mode = String(raw.coords || drawOpts.coords || state.defaults.draw_coords || "svg").toLowerCase();
    if (mode !== "cartesian") return raw;
    const flipY = (y) => (typeof y === "number" ? viewBoxSize - y : y);
    const norm = { ...raw };
    if (norm.y !== undefined) norm.y = flipY(norm.y);
    if (norm.cy !== undefined) norm.cy = flipY(norm.cy);
    if (norm.y1 !== undefined) norm.y1 = flipY(norm.y1);
    if (norm.y2 !== undefined) norm.y2 = flipY(norm.y2);
    if (Array.isArray(norm.points)) {
      norm.points = norm.points.map(([x, y]) => [x, flipY(y)]);
    }
    return norm;
  };
  const cmdNorm = normalizeCoords(cmd);
  const layer = drawContext.layerDrawing;
  const animateDefault = drawOpts.animate;
  const cmdAnimate = animateDefault ? (cmdNorm.animate ?? animateDefault) : false;
  const drawSpeed = drawOpts.speed;
  const speakPromise = cmdNorm.speak ? speakText(cmdNorm.speak, tokenAtStart, cmdNorm) : null;

  if (cmdNorm.cmd === "line") {
    const d = `M ${cmdNorm.x1} ${cmdNorm.y1} L ${cmdNorm.x2} ${cmdNorm.y2}`;
    const el = svgEl("path", { d, class: cmdNorm.class || "stroke" });
    if (cmdNorm.id) el.setAttribute("id", cmdNorm.id);
    applyStrokeDefaults(el, cmdNorm, drawOpts);
    layer.appendChild(el);
    if (cmdNorm.id) registerElement(cmdNorm.id, { type: "svg", el });
    if (cmdNorm.tooltip) applyTooltip(el, cmdNorm.tooltip);

    addLabel(drawContext, el, cmdNorm);
    const drawPromise = (!cmdAnimate)
      ? Promise.resolve()
      : (cmdAnimate === "draw" || cmdAnimate === true)
        ? animateDraw(el, tokenAtStart, drawSpeed, typeof cmdNorm.dur === "number" ? cmdNorm.dur : undefined)
        : Promise.resolve();
    if (speakPromise) await Promise.all([drawPromise, speakPromise]);
    else await drawPromise;
    return;
  }

  if (cmdNorm.cmd === "path") {
    const el = svgEl("path", { d: cmdNorm.d, class: cmdNorm.class || "stroke" });
    if (cmdNorm.id) el.setAttribute("id", cmdNorm.id);
    applyStrokeDefaults(el, cmdNorm, drawOpts);
    layer.appendChild(el);
    if (cmdNorm.id) registerElement(cmdNorm.id, { type: "svg", el });
    if (cmdNorm.tooltip) applyTooltip(el, cmdNorm.tooltip);

    addLabel(drawContext, el, cmdNorm);
    const drawPromise = (!cmdAnimate)
      ? Promise.resolve()
      : (cmdAnimate === "draw" || cmdAnimate === true)
        ? animateDraw(el, tokenAtStart, drawSpeed)
        : Promise.resolve();
    if (speakPromise) await Promise.all([drawPromise, speakPromise]);
    else await drawPromise;
    return;
  }

  if (cmdNorm.cmd === "circle") {
    const cx = cmdNorm.cx ?? 50;
    const cy = cmdNorm.cy ?? 50;
    const r = cmdNorm.r ?? 10;
    const el = svgEl("circle", { cx: String(cx), cy: String(cy), r: String(r), class: cmdNorm.class || "stroke" });
    if (cmdNorm.id) el.setAttribute("id", cmdNorm.id);
    applyStrokeDefaults(el, cmdNorm, drawOpts);
    if (cmdNorm.fill) el.setAttribute("fill", cmdNorm.fill);
    layer.appendChild(el);
    if (cmdNorm.id) registerElement(cmdNorm.id, { type: "svg", el });
    if (cmdNorm.tooltip) applyTooltip(el, cmdNorm.tooltip);
    addLabel(drawContext, el, cmdNorm);
    const drawPromise = (!cmdAnimate)
      ? Promise.resolve()
      : (cmdAnimate === "draw" || cmdAnimate === true)
        ? animateDraw(el, tokenAtStart, drawSpeed)
        : Promise.resolve();
    if (speakPromise) await Promise.all([drawPromise, speakPromise]);
    else await drawPromise;
    return;
  }

  if (cmdNorm.cmd === "rect") {
    const x = cmdNorm.x ?? 0;
    const y = cmdNorm.y ?? 0;
    const w = cmdNorm.width ?? 20;
    const h = cmdNorm.height ?? 20;
    const el = svgEl("rect", { x: String(x), y: String(y), width: String(w), height: String(h), class: cmdNorm.class || "stroke" });
    if (cmdNorm.id) el.setAttribute("id", cmdNorm.id);
    if (cmdNorm.rx != null) el.setAttribute("rx", String(cmdNorm.rx));
    if (cmdNorm.ry != null) el.setAttribute("ry", String(cmdNorm.ry));
    applyStrokeDefaults(el, cmdNorm, drawOpts);
    if (cmdNorm.fill) el.setAttribute("fill", cmdNorm.fill);
    layer.appendChild(el);
    if (cmdNorm.id) registerElement(cmdNorm.id, { type: "svg", el });
    if (cmdNorm.tooltip) applyTooltip(el, cmdNorm.tooltip);
    addLabel(drawContext, el, cmdNorm);
    const drawPromise = (!cmdAnimate)
      ? Promise.resolve()
      : (cmdAnimate === "fade") ? animateFadeIn(el, tokenAtStart, 0.35)
      : (cmdAnimate === "draw" || cmdAnimate === true)
        ? animateDraw(el, tokenAtStart, drawSpeed)
        : Promise.resolve();
    if (speakPromise) await Promise.all([drawPromise, speakPromise]);
    else await drawPromise;
    return;
  }

  if (cmdNorm.cmd === "ellipse") {
    const cx = cmdNorm.cx ?? 50;
    const cy = cmdNorm.cy ?? 50;
    const rx = cmdNorm.rx ?? 15;
    const ry = cmdNorm.ry ?? 10;
    const el = svgEl("ellipse", { cx: String(cx), cy: String(cy), rx: String(rx), ry: String(ry), class: cmdNorm.class || "stroke" });
    if (cmdNorm.id) el.setAttribute("id", cmdNorm.id);
    applyStrokeDefaults(el, cmdNorm, drawOpts);
    if (cmdNorm.fill) el.setAttribute("fill", cmdNorm.fill);
    layer.appendChild(el);
    if (cmdNorm.id) registerElement(cmdNorm.id, { type: "svg", el });
    if (cmdNorm.tooltip) applyTooltip(el, cmdNorm.tooltip);
    addLabel(drawContext, el, cmdNorm);
    const drawPromise = (!cmdAnimate)
      ? Promise.resolve()
      : (cmdAnimate === "draw" || cmdAnimate === true)
        ? animateDraw(el, tokenAtStart, drawSpeed)
        : Promise.resolve();
    if (speakPromise) await Promise.all([drawPromise, speakPromise]);
    else await drawPromise;
    return;
  }

  if (cmdNorm.cmd === "polygon") {
    const pts = (cmdNorm.points || []).map(([x, y]) => `${x},${y}`).join(" ");
    const el = svgEl("polygon", { points: pts, class: cmdNorm.class || "" });
    if (cmdNorm.id) el.setAttribute("id", cmdNorm.id);
    el.setAttribute("stroke-width", String(cmdNorm.stroke_width ?? drawOpts.stroke_width ?? 1.0));
    if (cmdNorm.stroke) el.setAttribute("stroke", cmdNorm.stroke);
    if (cmdNorm.fill) el.setAttribute("fill", cmdNorm.fill);
    layer.appendChild(el);
    if (cmdNorm.id) registerElement(cmdNorm.id, { type: "svg", el });
    if (cmdNorm.tooltip) applyTooltip(el, cmdNorm.tooltip);
    addLabel(drawContext, el, cmdNorm);
    const drawPromise = (cmdAnimate === "fade") ? animateFadeIn(el, tokenAtStart, 0.35) : Promise.resolve();
    if (speakPromise) await Promise.all([drawPromise, speakPromise]);
    else await drawPromise;
    return;
  }

  if (cmdNorm.cmd === "text") {
    const xSvg = cmdNorm.x ?? 50;
    const ySvg = cmdNorm.y ?? 50;
    const text = svgEl("text", {
      x: String(xSvg),
      y: String(ySvg),
      fill: cmdNorm.color || "var(--chalk)",
      "text-anchor": cmdNorm.anchor || "middle",
      "dominant-baseline": "middle",
    "font-size": String((cmdNorm.font_size ?? state.defaults.svg_text_font_size ?? 12) * getScale()),
    });
    text.textContent = cmdNorm.text || "";
    if (cmdNorm.rotation) text.setAttribute("transform", `rotate(${cmdNorm.rotation} ${xSvg} ${ySvg})`);
    drawContext.labelLayer.appendChild(text);
    if (cmdNorm.id) registerElement(cmdNorm.id, { type: "svg", el: text });
    if (cmdNorm.tooltip) applyTooltip(text, cmdNorm.tooltip);
    if (speakPromise) await speakPromise;
    return;
  }

  throw new Error("Unknown draw cmd: " + cmdNorm.cmd);
}

function extractDefaults(action) {
  const payload = action.set || action.defaults || action.changes || {};
  const inline = { ...action };
  delete inline.type;
  delete inline.set;
  delete inline.defaults;
  delete inline.changes;
  return { ...payload, ...inline };
}

function normalizeLectureData(data) {
  if (!data) return null;
  if (Array.isArray(data)) {
    let defaults = {};
    let commands = data.slice();
    const first = commands[0];
    if (first && (first.type === "defaults" || first.type === "default")) {
      defaults = extractDefaults(first);
      commands = commands.slice(1);
    }
    return { defaults, commands };
  }
  if (data && typeof data === "object") {
    if (Array.isArray(data.commands)) {
      return { defaults: data.defaults || {}, commands: data.commands };
    }
  }
  return null;
}

function hasLecture() {
  return lecture && Array.isArray(lecture.commands);
}

/** Prepend synthetic title/image/html commands from start_title, start_image, start_html defaults. */
function prependStartCommands(lecture) {
  if (!lecture || !Array.isArray(lecture.commands)) return;
  const merged = { ...baseDefaults, ...(lecture.defaults || {}) };
  const prefix = [];
  const st = merged.start_title;
  if (st != null && String(st).trim() !== "") prefix.push({ type: "title", title: String(st).trim() });
  const si = merged.start_image;
  if (si != null && String(si).trim() !== "") prefix.push({ type: "image", src: String(si).trim(), startImage: true });
  const sh = merged.start_html;
  if (sh != null && String(sh).trim() !== "") prefix.push({ type: "html", html: String(sh).trim() });
  lecture.prependedStartCount = prefix.length;
  if (prefix.length) lecture.commands = prefix.concat(lecture.commands);
}

async function resetForLecture(nextLecture) {
  state.pyodideDefaultPackagesPromise = null;
  state.webrDefaultPackagesPromise = null;
  state.webrShelter = null;
  state.jsRequirementsPromise = null;
  state.jsModules = null;
  state.webComponentBodyAttrDefaults = {};
  lecture = nextLecture;
  lectureDefaults = lecture?.defaults ? structuredClone(lecture.defaults) : {};
  initialDefaults = { ...baseDefaults, ...lectureDefaults };
  state.defaults = applySkinDefaults(structuredClone(initialDefaults));
  state.dimEnabled = !!state.defaults.dim;
  state.lectureDefaults = lectureDefaults;
  state.commandIndex = 0;
  state.lastExecutedIndex = -1;
  state.pageIndex = 0;
  state.playing = false;
  state.paused = false;
  // Phase A.3: math lazy-load decision. state.defaults now reflects the
  // lecture's :::defaults block, so isLazy("math") is meaningful. Three paths:
  //   1. lazy=math off → no-op; katex+texmath were eagerly loaded, md has them.
  //   2. lazy=math on + no math in lecture → rebuild md WITHOUT texmath and
  //      skip the fetch entirely. Boot speed win: ~80-150 ms on cold cache.
  //   3. lazy=math on + math in lecture → rebuild md, await ensureMath() so
  //      downstream sync md.render() call sites never see an un-math'd md.
  if (isLazy("math")) {
    if (lectureNeedsMath(lecture)) {
      await ensureMath();
    } else {
      md = buildMd(false);
      mdMathEnabled = false;
    }
  }
  cancelAll();
  clearBoard();
  state.pages = buildPages();
  applyWebDefaults(lecture.commands);
  updatePageForIndex(0);
  updateProgressUI();
  applyThemeDefaults(state.defaults);
  if (state.dimEnabled) autoDimLatest();
  applyLayout();
  startBackgroundRequirements();
  if (state.defaults.autostart) {
    const waitIdx = lecture.commands.findIndex((c) => c && c.type === "wait");
    const target = waitIdx >= 0 ? waitIdx + 1 : lecture.commands.length;
    await fastForwardTo(target, 0);
    state.commandIndex = target;
    state.lastExecutedIndex = Math.min(lecture.commands.length - 1, Math.max(-1, target - 1));
    updateProgressUI();
  }
  showCenterPlay(() => restartPlaybackFromStart());
}

async function runAction(action, tokenAtStart, opts = {}) {
  try {
    console.log("[explainer] runAction", action);
  } catch {}
  // Registry dispatch: if a handler has been registered for this action type in
  // Xplainer.actions (see src/player/core.js), run it first and short-circuit.
  // This is purely additive — if no handler exists or the handler returns false,
  // the legacy if-chain below runs unchanged.
  if (typeof window !== "undefined" && window.Xplainer && window.Xplainer.actions) {
    try {
      const consumed = await window.Xplainer.actions.maybeRun(action, tokenAtStart, opts);
      if (consumed) return;
    } catch (err) {
      console.error("[Xplainer] registered action handler threw for '" + action.type + "':", err);
      // Fall through to legacy dispatch as a safety net.
    }
  }
  // defaults, default, web_defaults, new_page, title, wait: moved to
  // src/player/handlers/structure.js (Phase B.1).

  // dim, no_dim: moved to src/player/handlers/annotation.js (Phase B.4).

  // speak, write, write_speak: moved to src/player/handlers/text.js (Phase B.2).

  // underline, move, rotate, change, delete: moved to src/player/handlers/annotation.js (Phase B.4).

  // new_drawing, draw: moved to src/player/handlers/annotation.js (Phase B.4).

  if (action.type === "question") {
    if (Array.isArray(action.choices) && action.choices.length) {
      const requireAnswer = action.require_answer ?? state.defaults.question_wait_for_answer ?? state.defaults.question_require_answer;
      const mustBeTrue = action.must_be_true ?? false;
      const loc = action.location || "left";
      state.currentDrawContext = null;
      const baseLocation = action.draw_location || action.location || state.defaults.draw_location || "right";
      const { waitForAnswer } = await renderQuestion(action, requireAnswer || mustBeTrue, opts.instant, tokenAtStart, loc, baseLocation) || {};
      const latest = pickLatestElement([".question-block"]);
      if (latest) autoDimLatest(latest);
      if (!opts.instant) {
        const waitSeconds = action.wait_seconds ?? action.wait_after ?? state.defaults.question_wait_seconds ?? 0.5;
        if (waitSeconds > 0) await sleep(waitSeconds * 1000, tokenAtStart);
        if (action.click) {
          await Promise.race([
            waitForAnswer || Promise.resolve(),
            waitForClick(action.wait_label || action.label, action.location || "right", tokenAtStart),
          ]);
        } else if (requireAnswer || mustBeTrue) {
          if (waitForAnswer) await awaitUserInput(waitForAnswer);
        }
      }
      return;
    }
    const loc = resolveLocation(action.location, "left");
    const target = getColumnForLocation(loc);
    const singleLine = action.single_line ?? state.defaults.question_single_line ?? true;
    const center = singleLine ? false : (action.center ?? action.centered ?? true);
    const block = document.createElement("div");
    block.className = "question-block question-block-short" + (singleLine ? " question-block-single-line" : "");
    block.style.textAlign = center ? "center" : "left";
    if (!singleLine) {
      const label = document.createElement("div");
      label.className = "label";
      label.textContent = action.label || "Question";
      block.appendChild(label);
    }
    target.appendChild(block);
    scrollColumnToBottom(target);

    const requireAnswer = action.require_answer ?? state.defaults.question_wait_for_answer ?? state.defaults.question_require_answer ?? false;
    const questionText = action.question || action.text || action.markdown || "";
    const answerRaw = action.answer ?? action.answer_text ?? "";
    const answerText = Array.isArray(answerRaw) ? answerRaw.join(",") : String(answerRaw || "");
    const acceptedAnswers = Array.isArray(answerRaw)
      ? answerRaw.map((a) => String(a).trim().toLowerCase()).filter(Boolean)
      : answerText.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

    let resolveContinue = null;
    const waitForContinue = new Promise((r) => { resolveContinue = r; });
    const waitAfterAnswer = action.wait_after_answer ?? state.defaults.question_wait_after_answer ?? false;
    const showAnswer = action.show_answer ?? action.show_answer_button ?? state.defaults.question_show_answer ?? true;

    const actionRow = document.createElement("div");
    actionRow.className = "question-choices question-choices-short";
    actionRow.style.justifyContent = center ? "center" : "flex-start";
    actionRow.style.textAlign = center ? "center" : "left";

    if (singleLine) {
      const row = document.createElement("div");
      row.className = "question-single-line-row";
      if (questionText) {
        renderMarkdownBlock(
          questionText,
          { font_size_px: action.font_size_px, muted: false, pause_on_click_type: "question", pause_on_click: action.pause_on_click },
          row
        );
      }
      if (acceptedAnswers.length) {
        const textInput = document.createElement("input");
        textInput.type = "text";
        textInput.placeholder = action.input_placeholder || "Type your answer...";
        textInput.className = "editor-input";
        const feedbackEl = document.createElement("span");
        feedbackEl.className = "question-feedback question-feedback-inline";
        const normalizeAnswer = (s) => String(s).trim().toLowerCase();
        const check = () => {
          const userNorm = normalizeAnswer(textInput.value);
          if (!userNorm) return;
          const correct = acceptedAnswers.includes(userNorm);
          if (correct) {
            feedbackEl.textContent = action.correct_label || "Correct!";
            feedbackEl.style.color = "rgba(34,197,94,.9)";
            textInput.disabled = true;
            if (!requireAnswer) {
              if (waitAfterAnswer && resolveContinue) {
                const continueBtn = document.createElement("button");
                continueBtn.className = "choice-btn";
                continueBtn.textContent = action.wait_label || action.label || "Continue";
                continueBtn.onclick = () => { if (resolveContinue) resolveContinue(); continueBtn.disabled = true; };
                row.appendChild(continueBtn);
              } else if (resolveContinue) resolveContinue();
            }
          } else {
            feedbackEl.textContent = action.incorrect_label || "Incorrect. Try again.";
            feedbackEl.style.color = "rgba(239,68,68,.9)";
          }
          feedbackEl.style.display = "inline";
          if (requireAnswer && resolveContinue) resolveContinue();
          updateAllColumns();
        };
        textInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") check();
        });
        row.appendChild(textInput);
        row.appendChild(feedbackEl);
      }
      if (showAnswer && answerText) {
        const displayAnswer = Array.isArray(answerRaw) ? answerRaw[0] : answerText;
        const answerBtn = document.createElement("button");
        answerBtn.className = "choice-btn";
        answerBtn.textContent = action.answer_label || "Show answer";
        answerBtn.onclick = () => {
          answerBtn.textContent = displayAnswer;
          answerBtn.disabled = true;
          answerBtn.style.color = "var(--muted)";
          updateAllColumns();
        };
        row.appendChild(answerBtn);
      }
      block.appendChild(row);
      if ((acceptedAnswers.length === 0 || !requireAnswer) && resolveContinue) {
        resolveContinue();
      }
    } else {
      if (questionText) {
        renderMarkdownBlock(
          questionText,
          { font_size_px: action.font_size_px, muted: false, pause_on_click_type: "question", pause_on_click: action.pause_on_click },
          block
        );
      }
      block.appendChild(actionRow);

      if (acceptedAnswers.length) {
        const inputRow = document.createElement("div");
        inputRow.className = "question-input-row";
        const textInput = document.createElement("input");
        textInput.type = "text";
        textInput.placeholder = action.input_placeholder || "Type your answer...";
        textInput.className = "editor-input";
        const checkBtn = document.createElement("button");
        checkBtn.className = "choice-btn";
        checkBtn.textContent = action.check_label || "Check";
        const feedbackEl = document.createElement("div");
        feedbackEl.className = "question-feedback";
        const normalizeAnswer = (s) => String(s).trim().toLowerCase();
        const check = () => {
          const userNorm = normalizeAnswer(textInput.value);
          if (!userNorm) return;
          const correct = acceptedAnswers.includes(userNorm);
          if (correct) {
            feedbackEl.textContent = action.correct_label || "Correct!";
            feedbackEl.style.color = "rgba(34,197,94,.9)";
            textInput.disabled = true;
            checkBtn.disabled = true;
            if (!requireAnswer) {
              if (waitAfterAnswer && resolveContinue) {
                const continueBtn = document.createElement("button");
                continueBtn.className = "choice-btn";
                continueBtn.textContent = action.wait_label || action.label || "Continue";
                continueBtn.style.marginTop = "8px";
                continueBtn.onclick = () => { if (resolveContinue) resolveContinue(); continueBtn.disabled = true; };
                actionRow.appendChild(continueBtn);
                updateAllColumns();
              } else if (resolveContinue) resolveContinue();
            }
          } else {
            feedbackEl.textContent = action.incorrect_label || "Incorrect. Try again.";
            feedbackEl.style.color = "rgba(239,68,68,.9)";
          }
          feedbackEl.style.display = "block";
          if (requireAnswer && resolveContinue) resolveContinue();
          updateAllColumns();
        };
        checkBtn.onclick = check;
        textInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") check();
        });
        inputRow.appendChild(textInput);
        inputRow.appendChild(checkBtn);
        actionRow.appendChild(inputRow);
        block.appendChild(feedbackEl);
      } else if (resolveContinue) {
        resolveContinue();
      }

      const hintText = action.hint || action.hint_text || "";
      if (hintText) {
        const hintWrap = document.createElement("div");
        hintWrap.style.display = "none";
        const hintBlock = renderMarkdownBlock(
          hintText,
          { font_size_px: 13, muted: true, pause_on_click_type: "question", pause_on_click: action.pause_on_click },
          hintWrap
        );
        hintBlock.container.classList.add("figure-footnote");
        block.appendChild(hintWrap);

        const hintBtn = document.createElement("button");
        hintBtn.className = "choice-btn";
        hintBtn.textContent = action.hint_label || "Show hint";
        hintBtn.onclick = () => {
          hintWrap.style.display = "block";
          hintBtn.disabled = true;
          updateAllColumns();
        };
        actionRow.appendChild(hintBtn);
      }

      if (showAnswer && answerText) {
        const answerWrap = document.createElement("div");
        answerWrap.style.display = "none";
        const displayAnswer = Array.isArray(answerRaw) ? answerRaw[0] : answerText;
        const ansBlock = renderMarkdownBlock(
          displayAnswer,
          { role: "subtitle", muted: false, pause_on_click_type: "question", pause_on_click: action.pause_on_click },
          answerWrap
        );
        ansBlock.container.classList.add("figure-title");
        block.appendChild(answerWrap);

        if (action.gif) {
          const gifSrc = action.gif_src || action.gif_url;
          if (gifSrc) {
            const gif = createHtmlElement({
              tag: "img",
              attrs: { src: gifSrc, alt: "GIF" },
              styles: { maxWidth: "100%", borderRadius: "6px", marginTop: "4px" },
            });
            answerWrap.appendChild(gif);
          }
        }

        const answerBtn = document.createElement("button");
        answerBtn.className = "choice-btn";
        answerBtn.textContent = action.answer_label || "Show answer";
        answerBtn.onclick = () => {
          answerWrap.style.display = "block";
          answerBtn.disabled = true;
          updateAllColumns();
        };
        actionRow.appendChild(answerBtn);
      }
    }

    if (action.speak) await speakText(action.speak, tokenAtStart, action);
    if (!opts.instant) {
      const waitSeconds = action.wait_seconds ?? action.wait_after ?? state.defaults.question_wait_seconds ?? 0.5;
      if (waitSeconds > 0) await sleep(waitSeconds * 1000, tokenAtStart);
      if (requireAnswer && acceptedAnswers.length) {
        await waitForContinue;
      } else if (resolveContinue) {
        resolveContinue();
      }
      if (action.click) {
        await waitForClick(action.wait_label || action.label, action.location || "right", tokenAtStart);
      }
    }
    autoDimLatest(block);
    return;
  }

  if (action.type === "math") {
    const loc = resolveLocation(action.location, "left");
    const target = getColumnForLocation(loc);
    const mathText = action.text || action.markdown || "";
    const block = renderMarkdownBlock(
      `$$\n${mathText}\n$$`,
      { ...action, pause_on_click_type: "math" },
      target
    );
    if (opts.instant) return;
    await animateWriteReveal(block.container, block.plainText, tokenAtStart, action);
    if (action.speak) await speakText(action.speak, tokenAtStart, action);
    return;
  }

  function stripInlineCommentsPreserveCommentLines(code) {
    const lines = String(code || "").split("\n");
    return lines
      .map((line) => {
        const trimmedStart = line.trimStart();
        // Keep pure comment lines (first non-space is #) untouched.
        if (trimmedStart.startsWith("#")) return line;
        const hashIdx = line.indexOf("#");
        if (hashIdx === -1) return line;
        // Strip inline comment, keep code part and trim trailing whitespace.
        return line.slice(0, hashIdx).replace(/\s+$/g, "");
      })
      .join("\n");
  }

  async function renderWebRCodeQuestion(action, opts, tokenAtStart) {
    const code = action.code ?? "";
    const loc = resolveLocation(action.location ?? state.defaults.webr_location, "left");
    const column = getColumnForLocation(loc);
    const silent = action.silent ?? state.defaults.code_silent ?? false;
    if (silent || opts.instant) {
      // Fallback to normal rendering for silent/instant; no question UI.
      return;
    }

    const block = document.createElement("div");
    block.className = "question-block question-block-code";
    applyPauseOnClick(block, "webr", action);

    if (action.question) {
      renderMarkdownBlock(
        action.question,
        { font_size_px: action.font_size_px, muted: false, pause_on_click_type: "question", pause_on_click: action.pause_on_click },
        block
      );
    }

    const layout = document.createElement("div");
    layout.className = "code-question-layout";
    const userCol = document.createElement("div");
    userCol.className = "code-question-col user";
    const answerCol = document.createElement("div");
    answerCol.className = "code-question-col answer";
    layout.appendChild(userCol);
    layout.appendChild(answerCol);
    block.appendChild(layout);

    const userCell = document.createElement("div");
    userCell.className = "webr-cell";
    const userWrap = document.createElement("div");
    userWrap.className = "code-input-wrap";
    const userCode = document.createElement("textarea");
    userCode.className = "webr-code code-question-code";
    userCode.value = "";
    userCode.dataset.extraLines = "1";
    const maxLines = action.max_lines ?? state.defaults.code_max_lines ?? 100;
    enableTabInTextarea(userCode);
    if (action.initial_text) {
      userCode.placeholder = action.initial_text;
    }
    userWrap.appendChild(userCode);

    const toolbar = document.createElement("div");
    toolbar.className = "webr-toolbar";

    const runBtn = document.createElement("button");
    runBtn.type = "button";
    runBtn.textContent = "Run";
    toolbar.appendChild(runBtn);

    const feedback = document.createElement("span");
    feedback.className = "question-feedback";
    toolbar.appendChild(feedback);

    userCell.appendChild(userWrap);
    userCell.appendChild(toolbar);
    userCol.appendChild(userCell);

    const userOutput = document.createElement("div");
    userOutput.className = outputClass("webr-output", action);
    userCol.appendChild(userOutput);

    const answerCell = document.createElement("div");
    answerCell.className = "webr-cell";
    const answerWrap = document.createElement("div");
    answerWrap.className = "code-input-wrap";
    const answerCode = document.createElement("textarea");
    answerCode.className = "webr-code code-question-code";
    const explainEnabled = action.explain !== false;
    const rawAnswerCode = code || "";
    const displayAnswerCode = explainEnabled
      ? stripInlineCommentsPreserveCommentLines(rawAnswerCode)
      : rawAnswerCode;
    answerCode.value = displayAnswerCode;
    answerCode.readOnly = true;
    answerWrap.appendChild(answerCode);

    const explainContainer = document.createElement("div");
    explainContainer.className = "explain-code-container";
    explainContainer.style.display = "none";

    const answerCodeSlot = document.createElement("div");
    answerCodeSlot.className = "code-question-answer-slot";
    answerCodeSlot.appendChild(answerWrap);
    answerCodeSlot.appendChild(explainContainer);
    answerCell.appendChild(answerCodeSlot);

    const answerToolbar = document.createElement("div");
    answerToolbar.className = "webr-toolbar";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "Close";
    closeBtn.className = "choice-btn";
    closeBtn.onclick = () => {
      answerCol.classList.remove("visible");
    };
    answerToolbar.appendChild(closeBtn);

    const explainBtn = document.createElement("button");
    explainBtn.type = "button";
    explainBtn.className = "choice-btn";
    explainBtn.title = "Explain answer code (audio)";
    explainBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" style="margin-right:4px;vertical-align:middle;"><path d="M3 6 H6 L9 3 V13 L6 10 H3 Z" fill="currentColor"></path></svg>Explain`;
    answerToolbar.appendChild(explainBtn);

    answerCell.appendChild(answerToolbar);
    answerCol.appendChild(answerCell);

    const answerOutput = document.createElement("div");
    answerOutput.className = outputClass("webr-output", action);
    answerCol.appendChild(answerOutput);

    const normalizeOutput = (text) => {
      return String(text || "")
        .replace(/\r\n/g, "\n")
        .trim();
    };

    let lastUserOutput = "";
    let lastAnswerOutput = "";
    const updateFeedback = () => {
      if (!lastUserOutput || !lastAnswerOutput) return;
      if (lastUserOutput === lastAnswerOutput) {
        feedback.textContent = action.correct_label || "Correct!";
        feedback.style.color = "rgba(34,197,94,.9)";
      } else {
        feedback.textContent = action.incorrect_label || "Not quite, compare with the answer.";
        feedback.style.color = "rgba(239,68,68,.9)";
      }
    };

    const ensureAnswer = async () => {
      if (!code || !code.trim()) return;
      answerCol.classList.add("visible");
      answerOutput.textContent = "Running...";
      try {
        const res = await enqueueWebRTask(() => runRCode(code));
        renderRResult(res, answerOutput);
      } catch (err) {
        answerOutput.textContent = String(err);
      }
      lastAnswerOutput = normalizeOutput(answerOutput.textContent || "");
      updateFeedback();
      scrollColumnToBottom(column);
    };

    if (explainEnabled) {
      const runExplainAgain = async () => {
        if (explainContainer.style.display === "block") return;
        answerWrap.style.display = "none";
        explainContainer.style.display = "block";
        explainContainer.textContent = "";
        explainBtn.textContent = "Skip";
        explainBtn.style.display = "";
        try {
          await runExplainCode(rawAnswerCode, explainContainer, explainBtn, tokenAtStart, action);
        } finally {
          explainContainer.style.display = "none";
          answerWrap.style.display = "";
          explainBtn.style.display = "";
          explainBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" style="margin-right:4px;vertical-align:middle;"><path d="M3 6 H6 L9 3 V13 L6 10 H3 Z" fill="currentColor"></path></svg>Explain`;
          explainBtn.onclick = runExplainAgain;
        }
      };
      explainBtn.onclick = runExplainAgain;
    } else {
      explainBtn.style.display = "none";
    }

    const requireRun = action.require_run ?? state.defaults.code_question_require_run ?? false;
    let resolveRunWait = null;
    const runWaitPromise = new Promise((r) => { resolveRunWait = r; });

    runBtn.onclick = () => {
      const userCodeText = userCode.value || "";
      if (!userCodeText.trim()) {
        userOutput.textContent = "";
        lastUserOutput = "";
        feedback.textContent = "";
        return;
      }
      if (requireRun && resolveRunWait) {
        resolveRunWait();
        resolveRunWait = null;
      }
      userOutput.textContent = "Running...";
      const p = enqueueWebRTask(() => runRCode(userCodeText));
      p.then((res) => {
        renderRResult(res, userOutput);
        lastUserOutput = normalizeOutput(userOutput.textContent || "");
        updateFeedback();
        scrollColumnToBottom(column);
      }).catch((err) => {
        userOutput.textContent = String(err);
        lastUserOutput = normalizeOutput(userOutput.textContent || "");
        updateFeedback();
      });
      ensureAnswer();
    };

    column.appendChild(block);
    scrollColumnToBottom(column);

    requestAnimationFrame(() => {
      if (userCode && typeof userCode.focus === "function") userCode.focus();
    });

    if (!opts.instant) {
      if (requireRun) {
        await runWaitPromise;
      } else {
        await waitForClick(action.wait_label || action.label || "Continue", action.wait_location || "right", tokenAtStart);
      }
    }
  }

  if (action.type === "webr") {
    const code = action.code ?? "";
    const silent = action.silent ?? state.defaults.code_silent ?? false;
    const showCode = !silent && (action.show_code ?? state.defaults.webr_show_code ?? true);
    const editable = action.editable ?? state.defaults.webr_editable ?? true;
    const autoRunRaw = action.auto_run ?? state.defaults.webr_auto_run ?? "before";
    const autoRun = autoRunRaw === true || autoRunRaw === "true" ? "after" : (autoRunRaw === false || autoRunRaw === "false" ? false : autoRunRaw);
    const runBefore = (autoRun === "before");
    const runAfter = (autoRun === "after");
    const runBlock = (autoRun === "block");
    const shouldAutoRun = (silent && code) ? true : (runBefore || runAfter || runBlock);
    const explainCodeMode = resolveExplainCodeMode(action);
    const explainClickWhenOff = action.explain_click_when_off ?? state.defaults.explain_click_when_off ?? true;
    const explainCode = code.trim() ? (explainCodeMode !== "off" || explainClickWhenOff) : false;
    const initialText = action.initial_text ?? "";
    const loc = resolveLocation(action.location ?? state.defaults.webr_location, "left");
    const resultLoc = resolveResultLocation(action.result_location ?? state.defaults.webr_result_location, "right");
    const resultInside = resultLoc === "inside";
    if (action.question && !silent && !opts.instant) {
      await renderWebRCodeQuestion(action, opts, tokenAtStart);
      return;
    }
    const codeColumn = getColumnForLocation(loc);
    const resultColumn = getColumnForLocation(showCode ? (resultInside ? loc : resultLoc) : loc);
    const maxLines = action.max_lines ?? state.defaults.code_max_lines ?? 100;
    const clearPage = action.new_page ?? action.clear_page ?? action.code_new_page
      ?? state.defaults.code_new_page ?? state.defaults.webr_clear_page ?? false;
    if (clearPage) clearBoard();
    if (opts.instant) {
      const cell = document.createElement("div");
      cell.className = "webr-cell";
      const output = document.createElement("div");
      output.className = outputClass("webr-output", action);
      const resCol = getColumnForLocation(showCode ? (resultInside ? loc : resultLoc) : loc);
      resCol.appendChild(cell);
      cell.appendChild(output);
      if (code && String(code).trim()) {
        enqueueWebRTask(() => runRCode(code))
          .then((res) => { renderRResult(res, output); })
          .catch((err) => { output.textContent = String(err); });
        await state.webrQueue;
      }
      return;
    }

    const cell = document.createElement("div");
    cell.className = "webr-cell";
    applyPauseOnClick(cell, "webr", action);
    const cellHeight = action.height ?? state.defaults.webr_height;
    if (cellHeight && String(cellHeight).toLowerCase() !== "auto") {
      cell.style.minHeight = cellHeight;
    } else {
      cell.style.minHeight = "";
    }
    const output = document.createElement("div");
    output.className = outputClass("webr-output", action);

    const titleText = action.title;
    const subtitleText = action.subtitle;
    const footnoteText = action.footnote;
    if (!silent && titleText) {
      const t = renderMarkdownBlock(
        titleText,
        { role: "title", pause_on_click_type: "webr", pause_on_click: action.pause_on_click },
        showCode ? codeColumn : resultColumn
      );
      t.container.classList.add("figure-title");
    }
    if (!silent && subtitleText) {
      const s = renderMarkdownBlock(
        subtitleText,
        { role: "subtitle", muted: true, pause_on_click_type: "webr", pause_on_click: action.pause_on_click },
        showCode ? codeColumn : resultColumn
      );
      s.container.classList.add("figure-subtitle");
    }

    let lastRunPromise = null;
    let codeHost = codeColumn;
    let outputHost = resultColumn;
    if (showCode && resultInside && !silent) {
      const inside = document.createElement("div");
      inside.className = "code-inside";
      const codePane = document.createElement("div");
      codePane.className = "code-pane";
      const outputPane = document.createElement("div");
      outputPane.className = "output-pane";
      inside.appendChild(codePane);
      inside.appendChild(outputPane);
      codeColumn.appendChild(inside);
      codeHost = codePane;
      outputHost = outputPane;
    }
    if (showCode) {
      let codeEl = null;
      const toolbar = document.createElement("div");
      toolbar.className = "webr-toolbar";
      const runBtn = document.createElement("button");
      runBtn.textContent = "Run";
      runBtn.disabled = !editable && !shouldAutoRun;
      const runtimeUi = createRuntimeStatusControls(toolbar, "webR");
      let activeRunId = 0;
      let cancelCurrentRun = null;
      runtimeUi.onCancel(() => {
        if (typeof cancelCurrentRun === "function") {
          cancelCurrentRun();
        }
      });

      const executeWebR = (codeToRun, { append = false } = {}) => {
        const runId = ++activeRunId;
        let cancelFlag = false;
        const shouldSpeakResult = codeRequestsResultSpeech(codeToRun, action);
        runBtn.disabled = true;
        runtimeUi.setBusy(true);
        runtimeUi.setState("loading", "webR: Loading...");
        cancelCurrentRun = async () => {
          cancelFlag = true;
          activeRunId++;
          runtimeUi.setState("cancelled", "webR: Cancelled");
          runtimeUi.setBusy(false);
          runBtn.disabled = !editable && !shouldAutoRun;
          try {
            if (state.webr && typeof state.webr.interrupt === "function") {
              await state.webr.interrupt();
            }
          } catch {}
        };
        output.textContent = "Running...";
        const promise = enqueueWebRTask(() => runRCode(codeToRun, {
          onStatus: (kind, text) => {
            if (runId !== activeRunId) return;
            runtimeUi.setState(kind, text || "webR: Running...");
          },
          cancelRequested: () => cancelFlag || runId !== activeRunId,
        }))
          .then(async (res) => {
            if (runId !== activeRunId) return res;
            renderRResult(res, output, append);
            scrollColumnToBottom(resultColumn);
            if (shouldSpeakResult) {
              const resultText = getRResultSpeechText(res);
              if (resultText) {
                await speakText(resultText, state.cancelToken, { ...action, speak_markdown: false });
              }
            }
            runtimeUi.setState("ready", "webR: Ready");
            return res;
          })
          .catch((err) => {
            if (runId !== activeRunId) return;
            if (err && err.__explainerCancelled) {
              output.textContent = "Cancelled.";
              runtimeUi.setState("cancelled", "webR: Cancelled");
              return;
            }
            output.textContent = String(err);
            runtimeUi.setState("error", "webR: Error");
          })
          .finally(() => {
            if (runId !== activeRunId) return;
            runtimeUi.setBusy(false);
            runBtn.disabled = !editable && !shouldAutoRun;
            cancelCurrentRun = null;
          });
        lastRunPromise = promise;
        return promise;
      };

      if (explainCode && code.trim()) {
        const explainContainer = document.createElement("div");
        explainContainer.className = "explain-code-container";
        const endExplainBtn = document.createElement("button");
        endExplainBtn.textContent = "Skip";
        endExplainBtn.type = "button";
        const editExplainBtn = document.createElement("button");
        editExplainBtn.type = "button";
        editExplainBtn.textContent = "Edit";
        toolbar.appendChild(endExplainBtn);
        toolbar.appendChild(editExplainBtn);
        toolbar.appendChild(runBtn);
        const wrap = document.createElement("div");
        wrap.className = "code-input-wrap";
        wrap.appendChild(explainContainer);
        cell.appendChild(wrap);
        cell.appendChild(toolbar);
        codeHost.appendChild(cell);
        scrollColumnToBottom(codeColumn);
        const entry = registerCodeCell(cell, explainContainer);
        if (entry) entry.wrap = wrap;
        autoDimLatest(cell);
        let currentCode = code;
        let isExplainMode = true;
        let editTextarea = null;
        runBtn.onclick = () => {
          const codeToRun = isExplainMode ? currentCode : (editTextarea ? editTextarea.value : currentCode);
          executeWebR(codeToRun);
        };
        const switchToEdit = () => {
          if (!editTextarea) {
            editTextarea = document.createElement("textarea");
            editTextarea.className = "webr-code";
            editTextarea.dataset.extraLines = "1";
            scheduleTextareaResize(editTextarea, { maxLines, extraLines: 1 });
            editTextarea.addEventListener("input", () => autoResizeTextarea(editTextarea, { maxLines, extraLines: 1 }));
            enableTabInTextarea(editTextarea);
          }
          editTextarea.value = currentCode;
          wrap.textContent = "";
          wrap.appendChild(editTextarea);
          scheduleTextareaResize(editTextarea, { maxLines, extraLines: 1 });
          isExplainMode = false;
          editExplainBtn.textContent = "Explain code";
        };
        const switchToExplain = () => {
          if (editTextarea) currentCode = editTextarea.value;
          buildExplainCodeView(currentCode, explainContainer, action);
          wrap.textContent = "";
          wrap.appendChild(explainContainer);
          isExplainMode = true;
          editExplainBtn.textContent = "Edit";
        };
        editExplainBtn.onclick = () => {
          if (isExplainMode) switchToEdit();
          else switchToExplain();
        };
        if (runBlock && code.trim()) {
          await runExplainCodeInBlocks(code, explainContainer, endExplainBtn, tokenAtStart, action,
            (blockCode) => executeWebR(blockCode, { append: true }),
            () => {}
          );
        } else if (runBefore && code.trim()) {
          lastRunPromise = executeWebR(code);
          await lastRunPromise;
          await runExplainCode(code, explainContainer, endExplainBtn, tokenAtStart, action);
        } else if (runAfter && code.trim()) {
          await runExplainCode(code, explainContainer, endExplainBtn, tokenAtStart, action);
          runBtn.click();
        } else {
          await runExplainCode(code, explainContainer, endExplainBtn, tokenAtStart, action);
        }
      } else {
        if (editable) {
          const textarea = document.createElement("textarea");
          textarea.className = "webr-code";
          textarea.value = code || "";
          if (!code && initialText) textarea.placeholder = initialText;
          textarea.dataset.extraLines = "1";
          scheduleTextareaResize(textarea, { maxLines, extraLines: 1 });
          textarea.addEventListener("input", () => autoResizeTextarea(textarea, { maxLines, extraLines: 1 }));
          enableTabInTextarea(textarea);
          codeEl = textarea;
        } else {
          const pre = document.createElement("pre");
          pre.className = "code-pre";
          pre.textContent = code || initialText || "";
          codeEl = pre;
        }
        const wrap = document.createElement("div");
        wrap.className = "code-input-wrap";
        wrap.appendChild(codeEl);
        cell.appendChild(wrap);
        toolbar.appendChild(runBtn);
        cell.appendChild(toolbar);
        codeHost.appendChild(cell);
        if (editable && codeEl && codeEl.tagName === "TEXTAREA") {
          scheduleTextareaResize(codeEl, { maxLines, extraLines: 1 });
        }
        scrollColumnToBottom(codeColumn);
        const entry = registerCodeCell(cell, codeEl);
        if (entry) entry.wrap = wrap;
        autoDimLatest(cell);
        runBtn.onclick = () => {
          const currentCode = editable ? codeEl.value : (code || "");
          executeWebR(currentCode);
        };
        if (shouldAutoRun && code) {
          runBtn.click();
        }
      }
    }

    if (!showCode && !silent) {
      if (initialText) {
        const pre = document.createElement("pre");
        pre.textContent = initialText;
        cell.appendChild(pre);
      }
      resultColumn.appendChild(cell);
      cell.appendChild(output);
      if (shouldAutoRun && code) {
        output.textContent = "Running...";
        const specs = (action.micropip ?? []).concat(parseMicropipSpecs(code));
        const autoInstall = action.auto_install ?? state.defaults.pyodide_auto_install ?? true;
        lastRunPromise = state.pyodideQueue = state.pyodideQueue.then(() => runPyodideCode(code, autoInstall, specs))
          .then((res) => {
            renderPyodideResult(res, output);
            scrollColumnToBottom(resultColumn);
          })
          .catch((err) => { output.textContent = String(err); });
      }
    }

    if (showCode && !silent) {
      let outputTarget = outputHost;
      if (!resultInside && outputHost === resultColumn && resultColumn === codeColumn) {
        outputTarget = cell;
      }
      outputTarget.appendChild(output);
    }
    if (!silent && footnoteText) {
      const f = renderMarkdownBlock(
        footnoteText,
        { role: "footnote", muted: true, pause_on_click_type: "webr", pause_on_click: action.pause_on_click },
        showCode ? codeColumn : resultColumn
      );
      f.container.classList.add("figure-footnote");
    }
    if (!silent) scrollColumnToBottom(resultColumn);

    if (silent && code && shouldAutoRun) {
      lastRunPromise = enqueueWebRTask(() => runRCode(code)).catch((err) => {
        console.error("[webr] Silent block failed:", err);
        throw err;
      });
    }

    const waitAfter = action.wait_after ?? state.defaults.webr_wait_after ?? true;
    const clearAfter = action.clear_after ?? action.new_page ?? action.clear_page ?? action.code_new_page
      ?? state.defaults.code_new_page ?? state.defaults.webr_clear_page ?? false;
    if (waitAfter && !opts.instant) {
      if (lastRunPromise) {
        await lastRunPromise;
      }
      if (isMovieMode()) {
        const sec = action.movie_seconds ?? state.defaults.movie_wait_seconds ?? 2;
        await sleep(sec * 1000, tokenAtStart);
      } else {
        await waitForClick(action.wait_label, action.wait_location || "right", tokenAtStart);
      }
      if (clearAfter) clearBoard();
    }
    return;
  }

  if (action.type === "brython") {
    const silent = action.silent ?? state.defaults.code_silent ?? false;
    const showCode = !silent && (action.show_code ?? state.defaults.brython_show_code ?? true);
    const editable = action.editable ?? state.defaults.brython_editable ?? true;
    const autoRunRaw = action.auto_run ?? state.defaults.brython_auto_run ?? "before";
    const autoRun = autoRunRaw === true || autoRunRaw === "true"
      ? "after"
      : (autoRunRaw === false || autoRunRaw === "false" ? false : autoRunRaw);
    const runBefore = (autoRun === "before");
    const runAfter = (autoRun === "after");
    const runBlock = (autoRun === "block");
    const explainCodeMode = resolveExplainCodeMode(action);
    const explainClickWhenOff = action.explain_click_when_off ?? state.defaults.explain_click_when_off ?? true;
    const code = action.code ?? "";
    const initialText = action.initial_text ?? "";
    const loc = resolveLocation(action.location ?? state.defaults.brython_location, "left");
    const resultLoc = resolveResultLocation(action.result_location ?? state.defaults.brython_result_location, "right");
    const resultInside = resultLoc === "inside";
    const codeColumn = getColumnForLocation(loc);
    const resultColumn = getColumnForLocation(showCode ? (resultInside ? loc : resultLoc) : loc);
    const maxLines = action.max_lines ?? state.defaults.code_max_lines ?? 100;
    const clearPage = action.new_page ?? action.clear_page ?? action.code_new_page
      ?? state.defaults.code_new_page ?? state.defaults.brython_clear_page ?? false;
    const waitAfter = action.wait_after ?? state.defaults.brython_wait_after ?? true;
    const clearAfter = action.clear_after ?? action.new_page ?? action.clear_page ?? action.code_new_page
      ?? state.defaults.code_new_page ?? state.defaults.brython_clear_page ?? false;
    if (clearPage) clearBoard();
    if (opts.instant) {
      const cell = document.createElement("div");
      cell.className = "brython-cell";
      const output = document.createElement("div");
      output.className = outputClass("brython-output", action);
      const resCol = getColumnForLocation(showCode ? (resultInside ? loc : resultLoc) : resultLoc);
      resCol.appendChild(cell);
      cell.appendChild(output);
      if (code && String(code).trim()) {
        state.brythonQueue = state.brythonQueue.then(() => runBrythonCode(code))
          .then((res) => { renderBrythonResult(res, output); })
          .catch((err) => { output.textContent = String(err); });
        await state.brythonQueue;
      }
      return;
    }

    const cell = document.createElement("div");
    cell.className = "brython-cell";
    applyPauseOnClick(cell, "brython", action);
    const cellHeight = action.height ?? state.defaults.brython_height;
    if (cellHeight && String(cellHeight).toLowerCase() !== "auto") {
      cell.style.minHeight = cellHeight;
    } else {
      cell.style.minHeight = "";
    }
    const output = document.createElement("div");
    output.className = outputClass("brython-output", action);

    const titleText = action.title;
    const subtitleText = action.subtitle;
    const footnoteText = action.footnote;
    if (!silent && titleText) {
      const t = renderMarkdownBlock(
        titleText,
        { role: "title", pause_on_click_type: "brython", pause_on_click: action.pause_on_click },
        showCode ? codeColumn : resultColumn
      );
      t.container.classList.add("figure-title");
    }
    if (!silent && subtitleText) {
      const s = renderMarkdownBlock(
        subtitleText,
        { role: "subtitle", muted: true, pause_on_click_type: "brython", pause_on_click: action.pause_on_click },
        showCode ? codeColumn : resultColumn
      );
      s.container.classList.add("figure-subtitle");
    }

    let lastRunPromise = null;
    const shouldAutoRun = (silent && code) ? true : (runBefore || runAfter || runBlock || autoRun === true);
    let codeHost = codeColumn;
    let outputHost = resultColumn;
    if (showCode && resultInside && !silent) {
      const inside = document.createElement("div");
      inside.className = "code-inside";
      const codePane = document.createElement("div");
      codePane.className = "code-pane";
      const outputPane = document.createElement("div");
      outputPane.className = "output-pane";
      inside.appendChild(codePane);
      inside.appendChild(outputPane);
      codeColumn.appendChild(inside);
      codeHost = codePane;
      outputHost = outputPane;
    }

    if (showCode) {
      let codeEl = null;
      const toolbar = document.createElement("div");
      toolbar.className = "brython-toolbar";
      const runBtn = document.createElement("button");
      runBtn.textContent = "Run";
      runBtn.disabled = !editable && !shouldAutoRun;

      const executeBrython = (codeToRun, { append = false } = {}) => {
        output.textContent = "Running...";
        const promise = state.brythonQueue = state.brythonQueue.then(() => runBrythonCode(codeToRun))
          .then((res) => {
            if (!append) output.innerHTML = "";
            renderBrythonResult(res, output);
            scrollColumnToBottom(resultColumn);
            return res;
          })
          .catch((err) => {
            output.textContent = String(err);
          });
        lastRunPromise = promise;
        return promise;
      };

      const explainCode = code.trim()
        ? (explainCodeMode !== "off" || explainClickWhenOff)
        : false;

      if (explainCode && code.trim()) {
        const explainContainer = document.createElement("div");
        explainContainer.className = "explain-code-container";
        const endExplainBtn = document.createElement("button");
        endExplainBtn.textContent = "Skip";
        endExplainBtn.type = "button";
        const editExplainBtn = document.createElement("button");
        editExplainBtn.type = "button";
        editExplainBtn.textContent = "Edit";
        toolbar.appendChild(endExplainBtn);
        toolbar.appendChild(editExplainBtn);
        toolbar.appendChild(runBtn);
        const wrap = document.createElement("div");
        wrap.className = "code-input-wrap";
        wrap.appendChild(explainContainer);
        cell.appendChild(wrap);
        cell.appendChild(toolbar);
        codeHost.appendChild(cell);
        scrollColumnToBottom(codeColumn);
        const entry = registerCodeCell(cell, explainContainer);
        if (entry) entry.wrap = wrap;
        autoDimLatest(cell);
        let currentCode = code;
        let isExplainMode = true;
        let editTextarea = null;
        runBtn.onclick = () => {
          const codeToRun = isExplainMode ? currentCode : (editTextarea ? editTextarea.value : currentCode);
          executeBrython(codeToRun);
        };
        const switchToEdit = () => {
          if (!editTextarea) {
            editTextarea = document.createElement("textarea");
            editTextarea.className = "brython-code";
            editTextarea.dataset.extraLines = "1";
            scheduleTextareaResize(editTextarea, { maxLines, extraLines: 1 });
            editTextarea.addEventListener("input", () => autoResizeTextarea(editTextarea, { maxLines, extraLines: 1 }));
            enableTabInTextarea(editTextarea);
          }
          editTextarea.value = currentCode;
          wrap.textContent = "";
          wrap.appendChild(editTextarea);
          scheduleTextareaResize(editTextarea, { maxLines, extraLines: 1 });
          isExplainMode = false;
          editExplainBtn.textContent = "Explain code";
        };
        const switchToExplain = () => {
          if (editTextarea) currentCode = editTextarea.value;
          buildExplainCodeView(currentCode, explainContainer, action);
          wrap.textContent = "";
          wrap.appendChild(explainContainer);
          isExplainMode = true;
          editExplainBtn.textContent = "Edit";
        };
        editExplainBtn.onclick = () => {
          if (isExplainMode) switchToEdit();
          else switchToExplain();
        };
        if (runBlock && code.trim()) {
          await runExplainCodeInBlocks(code, explainContainer, endExplainBtn, tokenAtStart, action,
            (blockCode) => executeBrython(blockCode, { append: true }),
            () => {}
          );
        } else if (runBefore && code.trim()) {
          lastRunPromise = executeBrython(code);
          await lastRunPromise;
          await runExplainCode(code, explainContainer, endExplainBtn, tokenAtStart, action);
        } else if (runAfter && code.trim()) {
          await runExplainCode(code, explainContainer, endExplainBtn, tokenAtStart, action);
          runBtn.click();
        } else {
          await runExplainCode(code, explainContainer, endExplainBtn, tokenAtStart, action);
        }
      } else {
        if (editable) {
          const textarea = document.createElement("textarea");
          textarea.className = "brython-code";
          textarea.value = code || "";
          if (!code && initialText) textarea.placeholder = initialText;
          textarea.dataset.extraLines = "1";
          scheduleTextareaResize(textarea, { maxLines, extraLines: 1 });
          textarea.addEventListener("input", () => autoResizeTextarea(textarea, { maxLines, extraLines: 1 }));
          enableTabInTextarea(textarea);
          codeEl = textarea;
        } else {
          const pre = document.createElement("pre");
          pre.className = "code-pre";
          pre.textContent = code || initialText || "";
          codeEl = pre;
        }

        toolbar.appendChild(runBtn);
        const wrap = document.createElement("div");
        wrap.className = "code-input-wrap";
        wrap.appendChild(codeEl);
        cell.appendChild(wrap);
        cell.appendChild(toolbar);
        codeHost.appendChild(cell);
        if (editable && codeEl && codeEl.tagName === "TEXTAREA") {
          scheduleTextareaResize(codeEl, { maxLines, extraLines: 1 });
        }
        scrollColumnToBottom(codeColumn);
        const entry = registerCodeCell(cell, codeEl);
        if (entry) entry.wrap = wrap;
        autoDimLatest(cell);

        runBtn.onclick = () => {
          const currentCode = editable ? codeEl.value : (code || "");
          executeBrython(currentCode);
        };

        if (shouldAutoRun && code) {
          runBtn.click();
        }
      }
    }

    if (!showCode && !silent) {
      if (initialText) {
        const pre = document.createElement("pre");
        pre.textContent = initialText;
        cell.appendChild(pre);
      }
      resultColumn.appendChild(cell);
      cell.appendChild(output);
      if (shouldAutoRun && code) {
        output.textContent = "Running...";
        lastRunPromise = state.brythonQueue = state.brythonQueue.then(() => runBrythonCode(code))
          .then((res) => {
            renderBrythonResult(res, output);
            scrollColumnToBottom(resultColumn);
          })
          .catch((err) => { output.textContent = String(err); });
      }
    }

    if (showCode && !silent) {
      let outputTarget = outputHost;
      if (!resultInside && outputHost === resultColumn && resultColumn === codeColumn) {
        outputTarget = cell;
      }
      outputTarget.appendChild(output);
    }
    if (!silent && footnoteText) {
      const f = renderMarkdownBlock(
        footnoteText,
        { role: "footnote", muted: true, pause_on_click_type: "brython", pause_on_click: action.pause_on_click },
        showCode ? codeColumn : resultColumn
      );
      f.container.classList.add("figure-footnote");
    }
    if (!silent) scrollColumnToBottom(resultColumn);

    if (silent && code && shouldAutoRun) {
      lastRunPromise = state.brythonQueue = state.brythonQueue.then(() => runBrythonCode(code)).catch(() => {});
    }

    if (waitAfter && !opts.instant) {
      if (lastRunPromise) {
        await lastRunPromise;
      }
      if (isMovieMode()) {
        const sec = action.movie_seconds ?? state.defaults.movie_wait_seconds ?? 2;
        await sleep(sec * 1000, tokenAtStart);
      } else {
        await waitForClick(action.wait_label, action.wait_location || "right", tokenAtStart);
      }
      if (clearAfter) clearBoard();
    }
    return;
  }

  if (action.type === "js") {
    const silent = action.silent ?? state.defaults.code_silent ?? false;
    const showCode = !silent && (action.show_code ?? state.defaults.js_show_code ?? false);
    const editable = action.editable ?? state.defaults.js_editable ?? true;
    const autoRun = action.auto_run ?? state.defaults.js_auto_run ?? true;
    const code = action.code ?? "";
    const initialText = action.initial_text ?? "";
    const loc = resolveLocation(action.location ?? state.defaults.js_location, "left");
    const resultLoc = resolveResultLocation(action.result_location ?? state.defaults.js_result_location, "right");
    const resultInside = resultLoc === "inside";
    const codeColumn = getColumnForLocation(loc);
    const resultColumn = getColumnForLocation(showCode ? (resultInside ? loc : resultLoc) : loc);
    const maxLines = action.max_lines ?? state.defaults.code_max_lines ?? 100;
    const clearPage = action.new_page ?? action.clear_page ?? action.code_new_page
      ?? state.defaults.code_new_page ?? state.defaults.js_clear_page ?? false;
    const waitAfter = action.wait_after ?? state.defaults.js_wait_after ?? true;
    const clearAfter = action.clear_after ?? action.new_page ?? action.clear_page ?? action.code_new_page
      ?? state.defaults.code_new_page ?? state.defaults.js_clear_page ?? false;
    if (clearPage) clearBoard();
    if (opts.instant) {
      const cell = document.createElement("div");
      cell.className = "js-cell";
      const output = document.createElement("div");
      output.className = outputClass("js-output", action);
      const resCol = getColumnForLocation(showCode ? (resultInside ? loc : resultLoc) : resultLoc);
      resCol.appendChild(cell);
      cell.appendChild(output);
      if (code && String(code).trim()) {
        state.jsQueue = state.jsQueue.then(() => runJsCode(code))
          .then((res) => { renderJsResult(res, output); })
          .catch((err) => { output.textContent = String(err); });
        await state.jsQueue;
      }
      return;
    }

    const cell = document.createElement("div");
    cell.className = "js-cell";
    applyPauseOnClick(cell, "js", action);
    const cellHeight = action.height ?? state.defaults.js_height;
    if (cellHeight && String(cellHeight).toLowerCase() !== "auto") {
      cell.style.minHeight = cellHeight;
    } else {
      cell.style.minHeight = "";
    }
    const output = document.createElement("div");
    output.className = outputClass("js-output", action);

    const titleText = action.title;
    const subtitleText = action.subtitle;
    const footnoteText = action.footnote;
    if (!silent && titleText) {
      const t = renderMarkdownBlock(
        titleText,
        { role: "title", pause_on_click_type: "js", pause_on_click: action.pause_on_click },
        showCode ? codeColumn : resultColumn
      );
      t.container.classList.add("figure-title");
    }
    if (!silent && subtitleText) {
      const s = renderMarkdownBlock(
        subtitleText,
        { role: "subtitle", muted: true, pause_on_click_type: "js", pause_on_click: action.pause_on_click },
        showCode ? codeColumn : resultColumn
      );
      s.container.classList.add("figure-subtitle");
    }

    let lastRunPromise = null;
    const shouldAutoRun = silent && code ? true : autoRun;
    let codeHost = codeColumn;
    let outputHost = resultColumn;
    if (showCode && resultInside && !silent) {
      const inside = document.createElement("div");
      inside.className = "code-inside";
      const codePane = document.createElement("div");
      codePane.className = "code-pane";
      const outputPane = document.createElement("div");
      outputPane.className = "output-pane";
      inside.appendChild(codePane);
      inside.appendChild(outputPane);
      codeColumn.appendChild(inside);
      codeHost = codePane;
      outputHost = outputPane;
    }

    if (showCode) {
      let codeEl = null;
      if (editable) {
        const textarea = document.createElement("textarea");
        textarea.className = "js-code";
        textarea.value = code || "";
        if (!code && initialText) textarea.placeholder = initialText;
        textarea.dataset.extraLines = "1";
        scheduleTextareaResize(textarea, { maxLines, extraLines: 1 });
        textarea.addEventListener("input", () => autoResizeTextarea(textarea, { maxLines, extraLines: 1 }));
        enableTabInTextarea(textarea);
        codeEl = textarea;
      } else {
        const pre = document.createElement("pre");
        pre.className = "code-pre";
        pre.textContent = code || initialText || "";
        codeEl = pre;
      }

      const toolbar = document.createElement("div");
      toolbar.className = "js-toolbar";
      const runBtn = document.createElement("button");
      runBtn.textContent = "Run";
      runBtn.disabled = !editable && !autoRun;
      toolbar.appendChild(runBtn);

      const wrap = document.createElement("div");
      wrap.className = "code-input-wrap";
      wrap.appendChild(codeEl);
      cell.appendChild(wrap);
      cell.appendChild(toolbar);
      codeHost.appendChild(cell);
      if (editable && codeEl && codeEl.tagName === "TEXTAREA") {
        scheduleTextareaResize(codeEl, { maxLines, extraLines: 1 });
      }
      scrollColumnToBottom(codeColumn);
      const entry = registerCodeCell(cell, codeEl);
      if (entry) entry.wrap = wrap;
      autoDimLatest(cell);

      runBtn.onclick = () => {
        const currentCode = editable ? codeEl.value : (code || "");
        output.textContent = "Running...";
        lastRunPromise = state.jsQueue = state.jsQueue.then(() => runJsCode(currentCode))
          .then((res) => {
            renderJsResult(res, output);
            scrollColumnToBottom(resultColumn);
          })
          .catch((err) => { output.textContent = String(err); });
      };

      if (shouldAutoRun && code) {
        runBtn.click();
      }
    }

    if (!showCode && !silent) {
      if (initialText) {
        const pre = document.createElement("pre");
        pre.textContent = initialText;
        cell.appendChild(pre);
      }
      resultColumn.appendChild(cell);
      cell.appendChild(output);
      if (shouldAutoRun && code) {
        output.textContent = "Running...";
        lastRunPromise = state.jsQueue = state.jsQueue.then(() => runJsCode(code))
          .then((res) => {
            renderJsResult(res, output);
            scrollColumnToBottom(resultColumn);
          })
          .catch((err) => { output.textContent = String(err); });
      }
    }

    if (showCode && !silent) {
      let outputTarget = outputHost;
      if (!resultInside && outputHost === resultColumn && resultColumn === codeColumn) {
        outputTarget = cell;
      }
      outputTarget.appendChild(output);
    }
    if (!silent && footnoteText) {
      const f = renderMarkdownBlock(
        footnoteText,
        { role: "footnote", muted: true, pause_on_click_type: "js", pause_on_click: action.pause_on_click },
        showCode ? codeColumn : resultColumn
      );
      f.container.classList.add("figure-footnote");
    }
    if (!silent) scrollColumnToBottom(resultColumn);

    if (silent && code && shouldAutoRun) {
      lastRunPromise = state.jsQueue = state.jsQueue.then(() => runJsCode(code)).catch(() => {});
    }

    if (waitAfter && !opts.instant) {
      if (lastRunPromise) {
        await lastRunPromise;
      }
      if (isMovieMode()) {
        const sec = action.movie_seconds ?? state.defaults.movie_wait_seconds ?? 2;
        await sleep(sec * 1000, tokenAtStart);
      } else {
        await waitForClick(action.wait_label, action.wait_location || "right", tokenAtStart);
      }
      if (clearAfter) clearBoard();
    }
    return;
  }

  // html: moved to src/player/handlers/media.js (Phase B.3).

  // component, webcomponent: moved to src/player/handlers/interactive.js (Phase B.6).

  // comp, web: moved to src/player/handlers/interactive.js (Phase B.6).

  // image, img, table: moved to src/player/handlers/media.js (Phase B.3).

  // svg, pdf, video, youtube: moved to src/player/handlers/media.js (Phase B.3).

  // link, accordion, xplainer_link, tutorial_link: moved to src/player/handlers/interactive.js (Phase B.6).

  // mermaid, p5, p5js, p5_control: moved to src/player/handlers/diagrams.js (Phase B.5).

  // mark, mark_image, annotate: moved to src/player/handlers/annotation.js (Phase B.4).

  // message: moved to src/player/handlers/text.js (Phase B.2).

  // pyodide_preload: moved to src/player/handlers/engine_meta.js (Phase B.7).

  if (action.type === "pyodide") {
    const silent = action.silent ?? state.defaults.code_silent ?? false;
    const showCode = !silent && (action.show_code ?? state.defaults.pyodide_show_code ?? true);
    const editable = action.editable ?? state.defaults.pyodide_editable ?? true;
    const code = action.code ?? "";
    const autoRunRaw = action.auto_run ?? state.defaults.pyodide_auto_run ?? "before";
    const autoRun = autoRunRaw === true || autoRunRaw === "true" ? "after" : (autoRunRaw === false || autoRunRaw === "false" ? false : autoRunRaw);
    const runBefore = (autoRun === "before");
    const runAfter = (autoRun === "after");
    const runBlock = (autoRun === "block");
    const shouldAutoRun = (silent && code) ? true : (runBefore || runAfter || runBlock);
    const explainCodeMode = resolveExplainCodeMode(action);
    const explainClickWhenOff = action.explain_click_when_off ?? state.defaults.explain_click_when_off ?? true;
    const explainCode = code.trim() ? (explainCodeMode !== "off" || explainClickWhenOff) : false;
    const initialText = action.initial_text ?? "";
    const loc = resolveLocation(action.location ?? state.defaults.pyodide_location, "left");
    const resultLoc = resolveResultLocation(action.result_location ?? state.defaults.pyodide_result_location, "right");
    const resultInside = resultLoc === "inside";
    const codeColumn = getColumnForLocation(loc);
    const resultColumn = getColumnForLocation(showCode ? (resultInside ? loc : resultLoc) : loc);
    const maxLines = action.max_lines ?? state.defaults.code_max_lines ?? 100;
    const clearPage = action.new_page ?? action.clear_page ?? action.code_new_page
      ?? state.defaults.code_new_page ?? state.defaults.pyodide_clear_page ?? false;
    const waitAfter = action.wait_after ?? state.defaults.pyodide_wait_after ?? true;
    const clearAfter = action.clear_after ?? action.new_page ?? action.clear_page ?? action.code_new_page
      ?? state.defaults.code_new_page ?? state.defaults.pyodide_clear_page ?? false;
    if (clearPage) clearBoard();
    if (opts.instant) {
      const cell = document.createElement("div");
      cell.className = "pyodide-cell";
      const output = document.createElement("div");
      output.className = outputClass("pyodide-output", action);
      const resCol = getColumnForLocation(showCode ? (resultInside ? loc : resultLoc) : loc);
      resCol.appendChild(cell);
      cell.appendChild(output);
      if (code && String(code).trim()) {
        const autoInstall = action.auto_install ?? state.defaults.pyodide_auto_install ?? true;
        const specs = (action.micropip ?? []).concat(parseMicropipSpecs(code));
        state.pyodideQueue = state.pyodideQueue.then(() => runPyodideCode(code, autoInstall, specs))
          .then((res) => { renderPyodideResult(res, output); })
          .catch((err) => { output.textContent = String(err); });
        await state.pyodideQueue;
      }
      return;
    }

    const cell = document.createElement("div");
    cell.className = "pyodide-cell";
    applyPauseOnClick(cell, "pyodide", action);
    const cellHeight = action.height ?? state.defaults.pyodide_height;
    if (cellHeight && String(cellHeight).toLowerCase() !== "auto") {
      cell.style.minHeight = cellHeight;
    } else {
      cell.style.minHeight = "";
    }
    const output = document.createElement("div");
    output.className = outputClass("pyodide-output", action);

    if (!silent && action.title) {
      const t = renderMarkdownBlock(
        action.title,
        { role: "title", pause_on_click_type: "pyodide", pause_on_click: action.pause_on_click },
        showCode ? codeColumn : resultColumn
      );
      t.container.classList.add("figure-title");
    }
    if (!silent && action.subtitle) {
      const s = renderMarkdownBlock(
        action.subtitle,
        { role: "subtitle", muted: true, pause_on_click_type: "pyodide", pause_on_click: action.pause_on_click },
        showCode ? codeColumn : resultColumn
      );
      s.container.classList.add("figure-subtitle");
    }

    let lastRunPromise = null;
    let codeHost = codeColumn;
    let outputHost = resultColumn;
    if (showCode && resultInside && !silent) {
      const inside = document.createElement("div");
      inside.className = "code-inside";
      const codePane = document.createElement("div");
      codePane.className = "code-pane";
      const outputPane = document.createElement("div");
      outputPane.className = "output-pane";
      inside.appendChild(codePane);
      inside.appendChild(outputPane);
      codeColumn.appendChild(inside);
      codeHost = codePane;
      outputHost = outputPane;
    }

    if (showCode) {
      let codeEl = null;
      const toolbar = document.createElement("div");
      toolbar.className = "pyodide-toolbar";
      const runBtn = document.createElement("button");
      runBtn.textContent = "Run";
      runBtn.disabled = !editable && !shouldAutoRun;
      const runtimeUi = createRuntimeStatusControls(toolbar, "Pyodide");
      let activeRunId = 0;
      let cancelCurrentRun = null;
      runtimeUi.onCancel(() => {
        if (typeof cancelCurrentRun === "function") {
          cancelCurrentRun();
        }
      });

      const executePyodide = (codeToRun, autoInstall, { append = false } = {}) => {
        const runId = ++activeRunId;
        let cancelFlag = false;
        const shouldSpeakResult = codeRequestsResultSpeech(codeToRun, action);
        runBtn.disabled = true;
        runtimeUi.setBusy(true);
        runtimeUi.setState("loading", "Pyodide: Loading...");
        cancelCurrentRun = async () => {
          cancelFlag = true;
          activeRunId++;
          runtimeUi.setState("cancelled", "Pyodide: Cancelled");
          runtimeUi.setBusy(false);
          runBtn.disabled = !editable && !shouldAutoRun;
          try {
            if (state.pyodide && typeof state.pyodide.interruptExecution === "function") {
              await state.pyodide.interruptExecution();
            }
          } catch {}
        };
        output.textContent = "Running...";
        const specs = (action.micropip ?? []).concat(parseMicropipSpecs(codeToRun));
        const promise = state.pyodideQueue = state.pyodideQueue.then(() => runPyodideCode(codeToRun, autoInstall, specs, {
          onStatus: (kind, text) => {
            if (runId !== activeRunId) return;
            runtimeUi.setState(kind, text || "Pyodide: Running...");
          },
          cancelRequested: () => cancelFlag || runId !== activeRunId,
        }))
          .then(async (res) => {
            if (runId !== activeRunId) return res;
            renderPyodideResult(res, output, append);
            scrollColumnToBottom(resultColumn);
            if (shouldSpeakResult) {
              const resultText = getPyodideResultSpeechText(res);
              if (resultText) {
                await speakText(resultText, state.cancelToken, { ...action, speak_markdown: false });
              }
            }
            runtimeUi.setState("ready", "Pyodide: Ready");
            return res;
          })
          .catch((err) => {
            if (runId !== activeRunId) return;
            if (err && err.__explainerCancelled) {
              output.textContent = "Cancelled.";
              runtimeUi.setState("cancelled", "Pyodide: Cancelled");
              return;
            }
            output.textContent = String(err);
            runtimeUi.setState("error", "Pyodide: Error");
          })
          .finally(() => {
            if (runId !== activeRunId) return;
            runtimeUi.setBusy(false);
            runBtn.disabled = !editable && !shouldAutoRun;
            cancelCurrentRun = null;
          });
        lastRunPromise = promise;
        return promise;
      };

      if (explainCode && code.trim()) {
        const explainContainer = document.createElement("div");
        explainContainer.className = "explain-code-container";
        const endExplainBtn = document.createElement("button");
        endExplainBtn.textContent = "Skip";
        endExplainBtn.type = "button";
        const editExplainBtn = document.createElement("button");
        editExplainBtn.type = "button";
        editExplainBtn.textContent = "Edit";
        toolbar.appendChild(endExplainBtn);
        toolbar.appendChild(editExplainBtn);
        toolbar.appendChild(runBtn);
        const wrap = document.createElement("div");
        wrap.className = "code-input-wrap";
        wrap.appendChild(explainContainer);
        cell.appendChild(wrap);
        cell.appendChild(toolbar);
        codeHost.appendChild(cell);
        scrollColumnToBottom(codeColumn);
        const entry = registerCodeCell(cell, explainContainer);
        if (entry) entry.wrap = wrap;
        autoDimLatest(cell);
        let currentCode = code;
        let isExplainMode = true;
        let editTextarea = null;
        const autoInstall = action.auto_install ?? state.defaults.pyodide_auto_install ?? true;
        runBtn.onclick = () => {
          const codeToRun = isExplainMode ? currentCode : (editTextarea ? editTextarea.value : currentCode);
          executePyodide(codeToRun, autoInstall);
        };
        const switchToEdit = () => {
          if (!editTextarea) {
            editTextarea = document.createElement("textarea");
            editTextarea.className = "pyodide-code";
            editTextarea.dataset.extraLines = "1";
            scheduleTextareaResize(editTextarea, { maxLines, extraLines: 1 });
            editTextarea.addEventListener("input", () => autoResizeTextarea(editTextarea, { maxLines, extraLines: 1 }));
            enableTabInTextarea(editTextarea);
          }
          editTextarea.value = currentCode;
          wrap.textContent = "";
          wrap.appendChild(editTextarea);
          scheduleTextareaResize(editTextarea, { maxLines, extraLines: 1 });
          isExplainMode = false;
          editExplainBtn.textContent = "Explain code";
        };
        const switchToExplain = () => {
          if (editTextarea) currentCode = editTextarea.value;
          buildExplainCodeView(currentCode, explainContainer, action);
          wrap.textContent = "";
          wrap.appendChild(explainContainer);
          isExplainMode = true;
          editExplainBtn.textContent = "Edit";
        };
        editExplainBtn.onclick = () => {
          if (isExplainMode) switchToEdit();
          else switchToExplain();
        };
        if (runBlock && code.trim()) {
          await runExplainCodeInBlocks(code, explainContainer, endExplainBtn, tokenAtStart, action,
            (blockCode) => executePyodide(blockCode, autoInstall, { append: true }),
            () => {}
          );
        } else if (runBefore && code.trim()) {
          lastRunPromise = executePyodide(code, autoInstall);
          await lastRunPromise;
          await runExplainCode(code, explainContainer, endExplainBtn, tokenAtStart, action);
        } else if (runAfter && code.trim()) {
          await runExplainCode(code, explainContainer, endExplainBtn, tokenAtStart, action);
          runBtn.click();
        } else {
          await runExplainCode(code, explainContainer, endExplainBtn, tokenAtStart, action);
        }
      } else {
        if (editable) {
          const textarea = document.createElement("textarea");
          textarea.className = "pyodide-code";
          textarea.value = code || "";
          if (!code && initialText) textarea.placeholder = initialText;
          textarea.dataset.extraLines = "1";
          scheduleTextareaResize(textarea, { maxLines, extraLines: 1 });
          textarea.addEventListener("input", () => autoResizeTextarea(textarea, { maxLines, extraLines: 1 }));
          enableTabInTextarea(textarea);
          codeEl = textarea;
        } else {
          const pre = document.createElement("pre");
          pre.className = "code-pre";
          pre.textContent = code || initialText || "";
          codeEl = pre;
        }
        const wrap = document.createElement("div");
        wrap.className = "code-input-wrap";
        wrap.appendChild(codeEl);
        cell.appendChild(wrap);
        toolbar.appendChild(runBtn);
        cell.appendChild(toolbar);
        codeHost.appendChild(cell);
        scrollColumnToBottom(codeColumn);
        const entry = registerCodeCell(cell, codeEl);
        if (entry) entry.wrap = wrap;
        autoDimLatest(cell);
        runBtn.onclick = () => {
          const currentCode = editable ? codeEl.value : (code || "");
          const autoInstall = action.auto_install ?? state.defaults.pyodide_auto_install ?? true;
          executePyodide(currentCode, autoInstall);
        };
        if (shouldAutoRun && code) {
          runBtn.click();
        }
      }
    }

    if (!showCode && !silent) {
      if (initialText) {
        const pre = document.createElement("pre");
        pre.textContent = initialText;
        cell.appendChild(pre);
      }
      resultColumn.appendChild(cell);
      cell.appendChild(output);
      if (shouldAutoRun && code) {
        output.textContent = "Running...";
        lastRunPromise = enqueueWebRTask(() => runRCode(code))
          .then((res) => {
            renderRResult(res, output);
            scrollColumnToBottom(resultColumn);
          })
          .catch((err) => { output.textContent = String(err); });
      }
    }

    if (showCode && !silent) {
      let outputTarget = outputHost;
      if (!resultInside && outputHost === resultColumn && resultColumn === codeColumn) {
        outputTarget = cell;
      }
      outputTarget.appendChild(output);
    }
    if (!silent && action.footnote) {
      const f = renderMarkdownBlock(
        action.footnote,
        { role: "footnote", muted: true, pause_on_click_type: "pyodide", pause_on_click: action.pause_on_click },
        showCode ? codeColumn : resultColumn
      );
      f.container.classList.add("figure-footnote");
    }
    if (!silent) scrollColumnToBottom(resultColumn);

    if (silent && code && shouldAutoRun) {
      const specs = (action.micropip ?? []).concat(parseMicropipSpecs(code));
      const autoInstall = action.auto_install ?? state.defaults.pyodide_auto_install ?? true;
      lastRunPromise = state.pyodideQueue = state.pyodideQueue
        .then(() => runPyodideCode(code, autoInstall, specs))
        .catch(() => {});
    }

    if (waitAfter && !opts.instant) {
      if (lastRunPromise) {
        await lastRunPromise;
      }
      if (isMovieMode()) {
        const sec = action.movie_seconds ?? state.defaults.movie_wait_seconds ?? 2;
        await sleep(sec * 1000, tokenAtStart);
      } else {
        await waitForClick(action.wait_label, action.wait_location || "right", tokenAtStart);
      }
      if (clearAfter) clearBoard();
    }
    return;
  }

  throw new Error("Unknown command type: " + action.type);
}

function buildPages() {
  if (!hasLecture()) return [{ index: 0, title: "" }];
  const pages = [];
  let pageIndex = -1;
  lecture.commands.forEach((cmd, i) => {
    if (cmd.type === "new_page") {
      pageIndex += 1;
      pages.push({ index: i, title: cmd.title || `Page ${pageIndex + 1}` });
    }
  });
  if (!pages.length) pages.push({ index: 0, title: "" });
  return pages;
}

function updatePageForIndex(idx) {
  let pageIdx = 0;
  for (let i = 0; i < state.pages.length; i++) {
    if (state.pages[i].index <= idx) pageIdx = i;
  }
  state.pageIndex = pageIdx;
  setPageTitle(state.pages[pageIdx]?.title || "");
}

function updateProgressUI() {
  if (!hasLecture()) {
    els.progress.max = "0";
    els.progress.value = "0";
    els.timeText.textContent = "0 / 0";
    return;
  }
  const prepended = typeof lecture.prependedStartCount === "number" ? lecture.prependedStartCount : 0;
  const totalCommands = lecture.commands.length;
  if (prepended > 0) {
    const realTotal = Math.max(1, totalCommands - prepended);
    const realIndex = Math.max(0, Math.min(state.commandIndex - prepended, realTotal - 1));
    els.progress.max = String(realTotal - 1);
    els.progress.value = String(realIndex);
    const current = state.commandIndex < prepended ? 1 : realIndex + 1;
    els.timeText.textContent = `${current} / ${realTotal}`;
  } else {
    const maxIndex = Math.max(0, totalCommands - 1);
    els.progress.max = String(maxIndex);
    els.progress.value = String(Math.min(maxIndex, state.commandIndex));
    const total = Math.max(1, totalCommands);
    const current = Math.min(total, state.commandIndex + 1);
    els.timeText.textContent = `${current} / ${total}`;
  }
}

async function fastForwardTo(index, startIndex = 0) {
  if (!hasLecture()) return;
  const tokenAtStart = state.cancelToken;
  for (let i = startIndex; i < index; i++) {
    if (tokenAtStart !== state.cancelToken) return;
    const cmd = lecture.commands[i];
    if (!cmd) continue;
    if (cmd.type === "new_page") updatePageForIndex(i);
    try {
      await runAction(cmd, tokenAtStart, { instant: true, silent: true });
    } catch (err) {
      console.warn("Fast-forward command failed, skipping:", cmd, err);
    }
  }
}

function getPageStartIndex(index) {
  let start = 0;
  for (const p of state.pages) {
    if (p.index <= index) start = p.index;
  }
  return start;
}

function startPlayback() {
  hideCenterPlay();
  if (els.bottomBar) els.bottomBar.classList.add("hidden");
  els.playPauseBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="3" width="3" height="10" fill="currentColor"></rect><rect x="9" y="3" width="3" height="10" fill="currentColor"></rect></svg>';
  playFromHere();
}

async function restartPlaybackFromStart() {
  const prepended = lecture && typeof lecture.prependedStartCount === "number" && lecture.prependedStartCount > 0;
  if (prepended) {
    cancelAll();
    state.playing = false;
    state.paused = false;
    clearBoard();
    state.commandIndex = lecture.prependedStartCount;
    state.lastExecutedIndex = lecture.prependedStartCount - 1;
    updatePageForIndex(state.commandIndex);
    updateProgressUI();
    startPlayback();
  } else {
    await seekTo(0);
    startPlayback();
  }
}

/**
 * Show / hide the "this step is stuck" banner on the board.
 *
 * Playback used to be able to freeze with nothing at all on screen: any step
 * whose promise never settled would leave the loop parked forever, with the
 * play button still showing "playing" and the bottom bar hidden. The viewer got
 * no error, no console message and no way to continue. This banner is the
 * feedback half of that fix — the skip button is the recovery half.
 */
function showStallNotice(action, index, onSkip) {
  hideStallNotice();
  if (!els.board) return;
  const wrap = document.createElement("div");
  wrap.className = "msg warn stall-notice";
  wrap.style.cssText = "position:absolute;left:50%;transform:translateX(-50%);bottom:calc(var(--space-2) + 40px);z-index:11;max-width:80%;";
  const icon = document.createElement("span");
  icon.className = "icon";
  icon.textContent = "⚠️";
  const text = document.createElement("span");
  text.textContent = `Step ${index + 1} (:::${action && action.type}) is taking unusually long.`;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Skip step";
  btn.style.cssText = "margin-left:8px;border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:2px 10px;";
  btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onSkip(); };
  wrap.append(icon, text, btn);
  els.board.appendChild(wrap);
  state.stallNotice = wrap;
}

function hideStallNotice() {
  if (state.stallNotice && state.stallNotice.parentNode) state.stallNotice.remove();
  state.stallNotice = null;
}

const SLOW_RUNTIME_TYPES = new Set(["webr", "pyodide", "brython", "js", "p5", "comp", "component", "webcomponent"]);

/**
 * Run one action, but never let it park playback silently.
 *
 * After `stall_warn_seconds` of no progress the banner above appears; the
 * viewer can skip the step, and the loop moves on. Time spent deliberately
 * waiting on the viewer (continue button, unanswered question) does not count —
 * state.awaitingUserInput pushes the deadline forward while it is open.
 */
async function runActionWatched(action, index, tokenAtStart) {
  const base = Number(state.defaults.stall_warn_seconds ?? 45);
  // Code cells pay for a one-time runtime download (webR/Pyodide are tens of
  // MB), so they get a much longer leash than a narration beat.
  const warnSec = SLOW_RUNTIME_TYPES.has(action && action.type) ? base * 4 : base;
  if (!(base > 0)) return runAction(action, tokenAtStart);

  let skipped = false;
  let poll = null;
  const skip = () => {
    if (skipped) return;
    skipped = true;
    hideStallNotice();
    console.warn(`[xplainer] step ${index + 1} (:::${action && action.type}) skipped after stalling`, action);
  };
  const stalled = new Promise((resolve) => {
    let deadline = Date.now() + warnSec * 1000;
    let warned = false;
    poll = setInterval(() => {
      if (state.awaitingUserInput > 0 || tokenAtStart !== state.cancelToken) {
        deadline = Date.now() + warnSec * 1000;
        if (warned) { warned = false; hideStallNotice(); }
        return;
      }
      if (Date.now() < deadline) return;
      if (!warned) {
        warned = true;
        console.warn(`[xplainer] step ${index + 1} (:::${action && action.type}) has not finished after ${warnSec}s`, action);
        showStallNotice(action, index, () => { skip(); resolve(); });
      }
    }, 500);
  });

  try {
    await Promise.race([runAction(action, tokenAtStart), stalled]);
  } finally {
    if (poll) clearInterval(poll);
    if (!skipped) hideStallNotice();
  }
}

async function playFromHere() {
  if (!hasLecture()) return;
  state.playing = true;
  state.paused = false;
  const tokenAtStart = state.cancelToken;

  updatePageForIndex(state.commandIndex);
  for (; state.commandIndex < lecture.commands.length;) {
    if (tokenAtStart !== state.cancelToken) return;
    if (!state.playing) return;
    const actionIndex = state.commandIndex;
    const action = lecture.commands[actionIndex];
    state.commandIndex += 1;
    if (action.type === "new_page") updatePageForIndex(actionIndex);
    try {
      await runActionWatched(action, actionIndex, tokenAtStart);
    } catch (err) {
      console.warn("Command failed, skipping:", action, err);
    }
    state.lastExecutedIndex = actionIndex;
    if (tokenAtStart !== state.cancelToken) return;
    const gapSec = Number(state.defaults.element_gap_seconds) || 0;
    if (gapSec > 0) await sleep(gapSec * 1000, tokenAtStart);
    if (tokenAtStart !== state.cancelToken) return;
    if (action.type !== "wait") {
      const waitVal = action.wait;
      const waitForClickNow = waitVal === true || String(waitVal).toLowerCase() === "true";
      const waitSeconds = typeof waitVal === "number" && Number.isFinite(waitVal) ? waitVal : (typeof waitVal === "string" && /^\d+(\.\d+)?$/.test(waitVal) ? Number(waitVal) : 0);
      if (waitForClickNow) {
        await waitForClick(action.wait_label || action.label || "Continue", action.location || "right", tokenAtStart);
      } else if (waitSeconds > 0) {
        await sleep(waitSeconds * 1000, tokenAtStart);
      }
    }
    updateProgressUI();
  }

  state.playing = false;
  els.playPauseBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3 L12 8 L4 13 Z" fill="currentColor"></path></svg>';
  hideCenterPlay();
  showBottomBar();
}

async function seekTo(index) {
  if (!hasLecture()) return;
  cancelAll();
  state.playing = false;
  state.paused = false;
  const startIndex = getPageStartIndex(index);
  state.commandIndex = startIndex;
  state.defaults = structuredClone({ ...state.baseDefaults, ...state.lectureDefaults });
  clearBoard();
  updatePageForIndex(startIndex);
  const prepended = typeof lecture.prependedStartCount === "number" && lecture.prependedStartCount > 0;
  if (index === 0 && prepended) {
    await fastForwardTo(lecture.prependedStartCount, 0);
    state.commandIndex = lecture.prependedStartCount;
    state.lastExecutedIndex = lecture.prependedStartCount - 1;
  } else {
    await fastForwardTo(index, startIndex);
    state.commandIndex = index;
    state.lastExecutedIndex = Math.min(lecture.commands.length - 1, Math.max(-1, index - 1));
  }
  updateProgressUI();
  els.playPauseBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3 L12 8 L4 13 Z" fill="currentColor"></path></svg>';
  if (index === 0 && prepended) {
    if (els.bottomBar) els.bottomBar.classList.add("hidden");
    showCenterPlay(() => startPlayback());
  } else {
    showBottomBar();
    showBottomBar();
  }
}

function goToPage(idx) {
  idx = Math.max(0, Math.min(state.pages.length - 1, idx));
  const startIndex = state.pages[idx]?.index ?? 0;
  seekTo(startIndex);
}

function rewindPage() {
  const pageStart = state.pages[state.pageIndex]?.index ?? 0;
  const prepended = lecture && typeof lecture.prependedStartCount === "number" && lecture.prependedStartCount > 0;
  if (state.pageIndex === 0 && prepended) {
    seekTo(0);
  } else {
    seekTo(pageStart);
  }
}

function setSourceStatus(text, isError = false) {
  if (!els.sourceStatus) return;
  els.sourceStatus.textContent = text || "";
  els.sourceStatus.style.color = isError ? "#fca5a5" : "var(--muted)";
}

function setEditorStatus(text, isError = false) {
  if (!els.editorStatus) return;
  els.editorStatus.textContent = text || "";
  els.editorStatus.style.color = isError ? "#fca5a5" : "var(--muted)";
}

function syncEditorToggle() {
  if (!els.editorToggleBtn) return;
  if (state.editorOpen) {
    els.editorToggleBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 6 L4 12 L10 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="M4 12 H20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      </svg>
    `;
    els.editorToggleBtn.title = "Show presentation";
    els.editorToggleBtn.setAttribute("aria-label", "Show presentation");
  } else {
    els.editorToggleBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 16.5 V20 H7.5 L18.3 9.2 L14.8 5.7 Z" fill="currentColor"></path>
        <path d="M19.7 7.8 L17.2 5.3 L18.6 3.9 A1.2 1.2 0 0 1 20.3 3.9 L21.1 4.7 A1.2 1.2 0 0 1 21.1 6.4 Z" fill="currentColor"></path>
      </svg>
    `;
    els.editorToggleBtn.title = "Edit presentation";
    els.editorToggleBtn.setAttribute("aria-label", "Edit presentation");
  }
}

async function loadLectureFromText(text, name = "") {
  const raw = text || "";
  state.sourceText = raw;
  // Track the source URL (if any) so xplainer_link and other relative
  // resources can resolve bare filenames against the current lecture's path.
  // Always stored in absolute form; null when the lecture came from the
  // editor, embedded script, or some other non-URL origin.
  try {
    state.currentSourceUrl = name ? new URL(name, document.baseURI).href : null;
  } catch (_) {
    state.currentSourceUrl = null;
  }
  let parsed = null;
  const trimmed = raw.trim();
  if (trimmed) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = null;
    }
  }
  let normalized = null;
  if (parsed !== null) {
    normalized = normalizeLectureData(parsed);
  }
  if (!normalized && window.parseLectureText) {
    normalized = window.parseLectureText(raw);
  }
  if (!normalized || !Array.isArray(normalized.commands)) {
    throw new Error("Could not parse lecture");
  }
  Object.keys(webComponentRegistry).forEach((k) => { delete webComponentRegistry[k]; });
  await runWebComponentDefinitions(normalized.commands);
  prependStartCommands(normalized);
  await resetForLecture(normalized);
  setSourceStatus(name ? `Loaded: ${name}` : "Loaded");
}

async function loadLectureFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load (${res.status})`);
  }
  const text = await res.text();
  await loadLectureFromText(text, url);
}

function loadLectureFromScript(url) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-lecture-script]");
    if (existing) existing.remove();
    window.lecture = null;
    window.lectureText = null;
    const script = document.createElement("script");
    script.src = url;
    script.dataset.lectureScript = "1";
    script.onload = async () => {
      const normalized = normalizeLectureData(window.lecture)
        || (window.lectureText && window.parseLectureText ? window.parseLectureText(window.lectureText) : null);
      if (!normalized || !Array.isArray(normalized.commands)) {
        reject(new Error("Script did not define a lecture"));
        return;
      }
      if (window.lectureText) state.sourceText = window.lectureText;
      Object.keys(webComponentRegistry).forEach((k) => { delete webComponentRegistry[k]; });
      await runWebComponentDefinitions(normalized.commands);
      prependStartCommands(normalized);
      await resetForLecture(normalized);
      setSourceStatus(`Loaded: ${url}`);
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load script"));
    document.head.appendChild(script);
  });
}

const DEFAULT_TUTORIALS = {
  owner: "explainify",
  repo: "tutorials",
  branch: "main",
};
const DEFAULT_TUTORIALS_INDEX_URL = `https://raw.githubusercontent.com/${DEFAULT_TUTORIALS.owner}/${DEFAULT_TUTORIALS.repo}/${DEFAULT_TUTORIALS.branch}/index.json`;
const EXAMPLES_LIST_URL = "examples/index.json";

function getHashTutorialName() {
  const raw = (window.location.hash || "").replace(/^#/, "").trim();
  if (!raw) return null;
  const decoded = tryDecodeURIComponent(raw);
  if (!decoded) return null;
  if (!/^[\w.-]+$/.test(decoded)) return null;
  return decoded;
}

function tryDecodeURIComponent(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function getHashTutorialUrl() {
  const name = getHashTutorialName();
  if (!name) return null;
  return buildRawGithubUrl(DEFAULT_TUTORIALS.owner, DEFAULT_TUTORIALS.repo, DEFAULT_TUTORIALS.branch, name + ".txt");
}

/** Returns { type: "github"|"gdoc"|"url", text: string } or null if no prefix. */
function getHashSource() {
  const raw = (window.location.hash || "").replace(/^#/, "").trim();
  if (!raw) return null;
  const decoded = tryDecodeURIComponent(raw);
  if (!decoded) return null;
  const lower = decoded.toLowerCase();
  if (lower.startsWith("github-")) {
    const text = decoded.slice(7).trim();
    return text ? { type: "github", text } : null;
  }
  if (lower.startsWith("gdoc-")) {
    const text = decoded.slice(5).trim();
    return text ? { type: "gdoc", text } : null;
  }
  if (lower.startsWith("url-")) {
    const text = decoded.slice(4).trim();
    return text ? { type: "url", text } : null;
  }
  return null;
}

function extractGdocId(urlOrId) {
  const s = String(urlOrId || "").trim();
  if (!s) return null;
  const m = s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]+$/.test(s)) return s;
  return null;
}

/** Resolve hash source to a fetchable URL, or null if invalid. */
function resolveHashSourceToUrl(type, text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (type === "github") {
    if (/^https?:\/\//i.test(t)) return normalizeGithubToRaw(t);
    const resolved = resolveGithubShorthand(t);
    return resolved || buildRawGithubUrl(DEFAULT_TUTORIALS.owner, DEFAULT_TUTORIALS.repo, DEFAULT_TUTORIALS.branch, t);
  }
  if (type === "gdoc") {
    const docId = extractGdocId(t);
    if (!docId) return null;
    return `https://docs.google.com/document/d/${docId}/export?format=txt`;
  }
  if (type === "url") {
    let url = t;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    try {
      new URL(url);
      return url;
    } catch {
      return null;
    }
  }
  return null;
}

async function tryFetchHashTutorialFromLocal(name) {
  const fileName = name + ".txt";
  for (const folder of LOCAL_EXAMPLE_FOLDERS) {
    const url = folder + "/" + fileName;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const text = await res.text();
        return { text, url };
      }
    } catch {}
  }
  return null;
}

async function resolveXplainerIdToLecture(id) {
  const rawId = String(id || "").trim();
  if (!rawId) return null;
  const hasExt = /\.[a-z0-9]+$/i.test(rawId);
  const baseName = hasExt ? rawId.replace(/\.[a-z0-9]+$/i, "") : rawId;
  const fileName = hasExt ? rawId : baseName + ".txt";

  // 1) Try local relative file (same host as player)
  try {
    const localUrl = fileName;
    const res = await fetch(localUrl, { cache: "no-store" });
    if (res.ok) {
      const text = await res.text();
      return { text, url: localUrl };
    }
  } catch {}

  // 2) Try default GitHub tutorials repo
  try {
    const githubUrl = buildRawGithubUrl(DEFAULT_TUTORIALS.owner, DEFAULT_TUTORIALS.repo, DEFAULT_TUTORIALS.branch, fileName);
    const res = await fetch(githubUrl, { cache: "no-store" });
    if (res.ok) {
      const text = await res.text();
      return { text, url: githubUrl };
    }
  } catch {}

  // 3) Try local examples folders
  try {
    const local = await tryFetchHashTutorialFromLocal(baseName);
    if (local) return local;
  } catch {}

  return null;
}

const EDITOR_LIST_CACHE_TTL_MS = 10 * 60 * 1000;

function buildRawGithubUrl(owner, repo, branch, filePath) {
  const safePath = String(filePath || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${safePath}`;
}

function extractEmbeddedUrl(input) {
  const match = String(input || "").match(/https?:\/\/[^\s]+/i);
  if (!match) return "";
  return match[0].replace(/[)\],.]+$/g, "");
}

function normalizeGithubToRaw(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "raw.githubusercontent.com") return parsed.toString();
    if (host === "github.com" || host === "www.github.com") {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length >= 5 && (parts[2] === "blob" || parts[2] === "tree" || parts[2] === "raw")) {
        const [owner, repo, , branch, ...rest] = parts;
        if (!rest.length) return parsed.toString();
        return buildRawGithubUrl(owner, repo, branch, rest.join("/"));
      }
      return parsed.toString();
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function resolveGithubShorthand(input) {
  const parts = String(input || "").split("/").filter(Boolean);
  if (parts.length < 3) return null;
  const [owner, repo, ...rest] = parts;
  if (rest[0] === "blob" || rest[0] === "tree" || rest[0] === "raw") {
    if (rest.length < 3) return null;
    const [, branch, ...pathParts] = rest;
    if (!pathParts.length) return null;
    return buildRawGithubUrl(owner, repo, branch, pathParts.join("/"));
  }
  return buildRawGithubUrl(owner, repo, DEFAULT_TUTORIALS.branch, rest.join("/"));
}

function resolveEditorInputToUrl(value) {
  const input = String(value || "").trim();
  if (!input) return null;
  const embedded = extractEmbeddedUrl(input);
  if (embedded) return normalizeGithubToRaw(embedded);
  if (sourceMap[input]) return sourceMap[input];
  if (/^https?:\/\//i.test(input)) return normalizeGithubToRaw(input);
  if (/^github\.com\//i.test(input)) return normalizeGithubToRaw(`https://${input}`);
  if (/^raw\.githubusercontent\.com\//i.test(input)) return `https://${input}`;
  if (/^\.{0,2}\//.test(input)) return input;
  if (/^examples\//.test(input)) return input;
  if (/^example\//.test(input)) return input;
  if (/^[\w.-]+\/[\w.-]+\/.+/.test(input)) {
    return resolveGithubShorthand(input) || input;
  }
  return buildRawGithubUrl(DEFAULT_TUTORIALS.owner, DEFAULT_TUTORIALS.repo, DEFAULT_TUTORIALS.branch, input);
}

async function loadLectureFromReference(rawValue) {
  const input = String(rawValue || "").trim();
  if (!input) throw new Error("Missing source");

  // Prefer explicit mappings first.
  if (sourceMap[input]) {
    const urlFromMap = resolveEditorInputToUrl(input) || sourceMap[input];
    if (/\.js(\?|#|$)/i.test(urlFromMap)) {
      await loadLectureFromScript(urlFromMap);
    } else {
      await loadLectureFromUrl(urlFromMap);
    }
    return;
  }

  // Relative-to-current-lecture resolution. If the input looks like a bare
  // filename (ends in .txt / .md / .json / .js) and isn't already absolute,
  // resolve against the currently-loaded lecture's URL if we have one,
  // otherwise fall back to the app's base URL. This makes
  // xplainer_link(url="03_demand.txt") work as a sibling-file reference.
  // Only triggers on file-like inputs so bare CDN ids (e.g. "metformin")
  // still flow to resolveXplainerIdToLecture below.
  const isAbsolute = /^https?:\/\//i.test(input)
    || /^github\.com\//i.test(input)
    || /^raw\.githubusercontent\.com\//i.test(input)
    || /^\//.test(input);
  const isFileLike = /\.(txt|md|json|js)(\?|#|$)/i.test(input);
  if (isFileLike && !isAbsolute) {
    const base = state.currentSourceUrl || document.baseURI;
    try {
      const resolved = new URL(input, base).href;
      console.info("[xplainer] resolving relative source:", { input, base, resolved });
      if (/\.js(\?|#|$)/i.test(resolved)) {
        await loadLectureFromScript(resolved);
      } else {
        await loadLectureFromUrl(resolved);
      }
      return;
    } catch (err) {
      console.warn("[xplainer] relative source resolution failed:", err);
      // Fall through to the standard resolution chain below.
    }
  }

  const looksLikeUrlish =
    /^https?:\/\//i.test(input) ||
    /^github\.com\//i.test(input) ||
    /^raw\.githubusercontent\.com\//i.test(input) ||
    /^\.{0,2}\//.test(input) ||
    /^examples\//.test(input) ||
    /^example\//.test(input) ||
    /[\/]/.test(input);

  // Bare id: try extended explainer resolution first.
  if (!looksLikeUrlish) {
    const resolved = await resolveXplainerIdToLecture(input);
    if (resolved) {
      await loadLectureFromText(resolved.text, resolved.url);
      return;
    }
  }

  // Fallback to generic URL resolution (editor/source semantics).
  const url = resolveEditorInputToUrl(input);
  if (!url) {
    throw new Error("Unknown source id");
  }
  if (/\.js(\?|#|$)/i.test(url)) {
    await loadLectureFromScript(url);
  } else {
    await loadLectureFromUrl(url);
  }
}

function populateEditorUrlList(items) {
  if (!els.editorListSelect) return;
  els.editorListSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select example";
  els.editorListSelect.appendChild(placeholder);
  items.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = item.title && item.title !== item.id
      ? `${item.id} — ${item.title}`
      : item.id;
    els.editorListSelect.appendChild(opt);
  });
}

function editorListIsLoaded() {
  if (!els.editorListSelect) return false;
  return els.editorListSelect.options.length > 1;
}

function normalizeTutorialIndex(data) {
  const items = [];
  const pushItem = (entry) => {
    if (!entry) return;
    if (typeof entry === "string") {
      items.push({ id: entry, title: "" });
      return;
    }
    if (typeof entry === "object") {
      const id = entry.id || entry.name || entry.slug || entry.file;
      if (!id) return;
      const title = entry.title || entry.label || entry.name || entry.id || "";
      items.push({ id, title });
    }
  };
  if (Array.isArray(data)) {
    data.forEach(pushItem);
    return items;
  }
  if (data && Array.isArray(data.tutorials)) {
    data.tutorials.forEach(pushItem);
    return items;
  }
  if (data && Array.isArray(data.items)) {
    data.items.forEach(pushItem);
  }
  return items;
}

const LOCAL_EXAMPLE_FOLDERS = ["examples", "example"];
const LOCAL_EXAMPLE_EXT = /\.(txt|json|js)$/i;

function parseDirectoryListingHtml(html, folder) {
  const items = [];
  const prefix = folder + "/";
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
  const seen = new Set();
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    const raw = match[1].trim();
    const decoded = raw.replace(/&amp;/g, "&");
    const basename = decoded.split("/").pop().split("?")[0];
    if (!basename || !LOCAL_EXAMPLE_EXT.test(basename)) continue;
    const id = decoded.startsWith(folder + "/") && !decoded.startsWith(folder + "//") ? decoded : prefix + basename;
    const normalized = id.startsWith(folder + "/") ? id : prefix + id;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    items.push({ id: normalized, title: basename });
  }
  return items;
}

async function fetchLocalExamplesFromFolder(folder) {
  try {
    const res = await fetch(folder + "/", { cache: "no-store" });
    if (!res.ok) return [];
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html")) return [];
    const html = await res.text();
    return parseDirectoryListingHtml(html, folder);
  } catch {
    return [];
  }
}

async function fetchLocalExamplesList() {
  const items = [];
  try {
    const res = await fetch(EXAMPLES_LIST_URL, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      items.push(...normalizeTutorialIndex(data));
    }
  } catch {}
  for (const folder of LOCAL_EXAMPLE_FOLDERS) {
    try {
      const dirItems = await fetchLocalExamplesFromFolder(folder);
      dirItems.forEach((item) => {
        if (!items.some((i) => i.id === item.id)) items.push(item);
      });
    } catch {}
  }
  return items;
}

async function loadEditorTutorialList(forceRefresh = false) {
  if (!forceRefresh && state.editorTutorialListCache && (Date.now() - state.editorTutorialListCache.fetchedAt) < EDITOR_LIST_CACHE_TTL_MS) {
    populateEditorUrlList(state.editorTutorialListCache.items);
    setEditorStatus(`Loaded list (${state.editorTutorialListCache.items.length}) from cache`);
    return;
  }

  setEditorStatus("Loading tutorial list...");
  const allItems = [];
  const seen = new Set();

  try {
    const res = await fetch(DEFAULT_TUTORIALS_INDEX_URL, { cache: forceRefresh ? "no-store" : "default" });
    if (!res.ok) throw new Error(`Index not found (${res.status})`);
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      const items = normalizeTutorialIndex(data);
      items.forEach((item) => {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          allItems.push(item);
        }
      });
    } catch {
      text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((id) => {
        if (!seen.has(id)) {
          seen.add(id);
          allItems.push({ id, title: "" });
        }
      });
    }
  } catch {
    try {
      const apiUrl = `https://api.github.com/repos/${DEFAULT_TUTORIALS.owner}/${DEFAULT_TUTORIALS.repo}/contents?ref=${DEFAULT_TUTORIALS.branch}`;
      const res = await fetch(apiUrl);
      if (res.ok) {
        const data = await res.json();
        const items = Array.isArray(data)
          ? data
            .filter((entry) => entry.type === "file" && entry.name && !entry.name.startsWith("."))
            .map((entry) => ({ id: entry.name, title: "" }))
          : [];
        items.forEach((item) => {
          if (!seen.has(item.id)) {
            seen.add(item.id);
            allItems.push(item);
          }
        });
      }
    } catch {}
  }

  const localItems = await fetchLocalExamplesList();
  localItems.forEach((item) => {
    const id = (item.id.startsWith("examples/") || item.id.startsWith("example/")) ? item.id : `examples/${item.id}`;
    if (!seen.has(id)) {
      seen.add(id);
      allItems.push({ id, title: item.title || "" });
    }
  });

  allItems.sort((a, b) => a.id.localeCompare(b.id));
  state.editorTutorialListCache = { items: allItems, fetchedAt: Date.now() };
  populateEditorUrlList(allItems);
  setEditorStatus(`Loaded list (${allItems.length}) from GitHub and examples`);
}

/* ---------------- UI wiring ---------------- */

async function loadEditorFromUrl(value) {
  const url = resolveEditorInputToUrl(value);
  if (!url) {
    setEditorStatus("Unknown id or URL", true);
    return;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load (${res.status})`);
    const text = await res.text();
    if (els.editorTextarea) {
      els.editorTextarea.value = text;
      state.editorText = text;
    }
    state.editorLoadedUrl = url;
    if (els.editorUrlInput) els.editorUrlInput.value = url;
    setEditorStatus(`Loaded into editor: ${url}`);
    await applyEditorContent({ play: false });
  } catch (err) {
    setEditorStatus(String(err), true);
  }
}

async function applyEditorContent({ play = false } = {}) {
  if (state.editorApplying) return false;
  state.editorApplying = true;
  const text = els.editorTextarea ? els.editorTextarea.value : "";
  state.editorText = text;
  state.sourceText = text;
  try {
    if (text === state.editorLastAppliedText) {
      setEditorStatus("No changes to apply");
      state.editorApplying = false;
      if (play) startPlayback();
      return true;
    }
    await loadLectureFromText(text, "editor");
    state.editorLastAppliedText = text;
    setEditorStatus("Loaded from editor");
    if (play) startPlayback();
    state.editorApplying = false;
    return true;
  } catch (err) {
    setEditorStatus(String(err), true);
    state.editorApplying = false;
    return false;
  }
}

function scheduleEditorAutoApply() {
  if (state.editorAutoApplyTimer) clearTimeout(state.editorAutoApplyTimer);
  state.editorAutoApplyTimer = setTimeout(() => {
    state.editorAutoApplyTimer = null;
    applyEditorContent({ play: false });
  }, 300);
}

async function setEditorOpen(open, opts = {}) {
  if (!els.editorPane || !els.board) return;
  if (open) {
    if (state.editorClosing || state.editorOpen) return;
    state.editorOpen = true;
    cancelAll();
    state.playing = false;
    state.paused = true;
    state.waitingForClick = null;
    hideCenterPlay();
    els.editorPane.classList.add("visible");
    if (els.playerWrap) els.playerWrap.style.display = "none";
    els.board.style.display = "none";
    if (els.editorTextarea) {
      els.editorTextarea.value = state.editorText || state.sourceText || "";
      els.editorTextarea.focus();
    }
    if (els.editorUrlInput && state.editorLoadedUrl) els.editorUrlInput.value = state.editorLoadedUrl;
    syncEditorToggle();
    showBottomBar();
    return;
  }
  if (state.editorClosing) return;
  state.editorClosing = true;
  const shouldApply = opts.apply ?? true;
  const shouldPlay = opts.play ?? false;
  let ok = true;
  if (shouldApply) {
    ok = await applyEditorContent({ play: false });
  }
  if (!ok) {
    state.editorClosing = false;
    return;
  }
  state.editorOpen = false;
  els.editorPane.classList.remove("visible");
  if (els.playerWrap) els.playerWrap.style.display = "";
  els.board.style.display = "";
  state.editorClosing = false;
  syncEditorToggle();
  if (shouldPlay) setTimeout(() => startPlayback(), 0);
}

async function applyEditorAndPlay() {
  if (state.editorApplying || state.editorClosing) return;
  state.editorClosing = true;
  state.editorOpen = false;
  if (els.editorPane) els.editorPane.classList.remove("visible");
  if (els.playerWrap) els.playerWrap.style.display = "";
  if (els.board) els.board.style.display = "";
  syncEditorToggle();
  state.editorClosing = false;
  const ok = await applyEditorContent({ play: false });
  if (ok) setTimeout(() => startPlayback(), 0);
}

const sourceMap = window.explainSourceMap || {};

function setSourcePanelOpen(open) {
  if (!els.sourcePanel || !els.sourceMenuBtn) return;
  els.sourcePanel.classList.toggle("hidden", !open);
  els.sourceMenuBtn.setAttribute("aria-expanded", open ? "true" : "false");
}

if (els.sourceMenuBtn && els.sourcePanel) {
  els.sourceMenuBtn.onclick = () => {
    const isHidden = els.sourcePanel.classList.contains("hidden");
    setSourcePanelOpen(isHidden);
    if (isHidden && els.sourceInput) {
      els.sourceInput.focus();
    }
  };
  document.addEventListener("click", (event) => {
    if (els.sourcePanel.classList.contains("hidden")) return;
    const target = event.target;
    if (els.sourcePanel.contains(target) || els.sourceMenuBtn.contains(target)) return;
    setSourcePanelOpen(false);
  });
  els.sourcePanel.addEventListener("focusout", (event) => {
    if (els.sourcePanel.classList.contains("hidden")) return;
    const next = event.relatedTarget;
    if (next && (els.sourcePanel.contains(next) || els.sourceMenuBtn.contains(next))) return;
    setSourcePanelOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!els.sourcePanel.classList.contains("hidden")) setSourcePanelOpen(false);
  });
}

// --- Global keyboard shortcuts for player mode ---

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

let blackoutOverlay = null;
function showBlackout() {
  if (!blackoutOverlay) {
    blackoutOverlay = document.createElement("div");
    blackoutOverlay.style.cssText = "position:fixed;inset:0;background:#000;z-index:99999;cursor:pointer;";
  }
  document.body.appendChild(blackoutOverlay);
  if (state.playing) {
    cancelAll();
    state.playing = false;
    state.paused = true;
    els.playPauseBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3 L12 8 L4 13 Z" fill="currentColor"></path></svg>';
  }
  const dismiss = () => { if (blackoutOverlay.parentNode) blackoutOverlay.remove(); };
  blackoutOverlay.addEventListener("keydown", dismiss, { once: true });
  blackoutOverlay.addEventListener("click", dismiss, { once: true });
  blackoutOverlay.tabIndex = 0;
  blackoutOverlay.focus();
}

document.addEventListener("keydown", (event) => {
  if (isTypingTarget(document.activeElement)) return;
  if (state.editorOpen) return;

  if (event.key === "ArrowRight") {
    if (state.waitingForClick) {
      state.waitingForClick();
    } else if (hasLecture()) {
      const anchor = getStepAnchorIndex();
      const target = Math.min(lecture.commands.length, anchor + 2);
      seekTo(target);
      startPlayback();
    }
    return;
  }

  if (event.key === " ") {
    event.preventDefault();
    if (state.waitingForClick) {
      state.waitingForClick();
    } else if (state.playing) {
      cancelAll();
      state.playing = false;
      state.paused = true;
      els.playPauseBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3 L12 8 L4 13 Z" fill="currentColor"></path></svg>';
      showBottomBar();
    } else {
      startPlayback();
    }
    return;
  }

  if (event.key === ".") {
    event.preventDefault();
    showBlackout();
    return;
  }
});

async function handleSourceLoad(value) {
  const input = (value || "").trim();
  if (!input) return;
  setSourceStatus("Loading...");
  try {
    await loadLectureFromReference(input);
    setSourcePanelOpen(false);
  } catch (err) {
    setSourceStatus(String(err && err.message ? err.message : err), true);
  }
}

if (els.sourceLoadBtn && els.sourceInput) {
  els.sourceLoadBtn.onclick = () => handleSourceLoad(els.sourceInput.value);
  els.sourceInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSourceLoad(els.sourceInput.value);
  });
}

if (els.sourceFileBtn && els.sourceFileInput) {
  els.sourceFileBtn.onclick = () => els.sourceFileInput.click();
  els.sourceFileInput.addEventListener("change", async () => {
    const file = els.sourceFileInput.files?.[0];
    if (!file) return;
    setSourceStatus("Loading...");
    try {
      const text = await file.text();
      await loadLectureFromText(text, file.name);
      if (els.sourceInput) els.sourceInput.value = file.name;
      setSourcePanelOpen(false);
    } catch (err) {
      setSourceStatus(String(err), true);
    }
  });
}

if (els.editorToggleBtn) {
  els.editorToggleBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (state.editorOpen) {
      setEditorOpen(false, { apply: false, play: false });
    } else {
      setEditorOpen(true);
    }
  };
}
if (els.editorHelpBtn) {
  els.editorHelpBtn.onclick = () => {
    const docUrl = new URL("explainer_documentation.html", window.location.href).href;
    window.open(docUrl, "_blank");
  };
}
if (els.editorCloseBtn) {
  els.editorCloseBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setEditorOpen(false, { apply: true, play: false });
  };
}
if (els.editorApplyBtn) {
  els.editorApplyBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    applyEditorAndPlay();
  };
}
function buildSaveAsAppHtml(editorText, opts) {
  const baseUrl = (opts && opts.baseUrl) || window.explainAppBaseUrl || "https://cdn.jsdelivr.net/gh/explainify/app@main";
  const title = (opts && opts.title) || "Presentation";
  const styleEl = document.querySelector("style");
  const styleContent = styleEl ? styleEl.textContent : "";
  const escaped = String(editorText || "").replace(/<\/script/gi, "<\\/script");
  const bodyHtml = `<div class="player" id="player">
  <div class="topbar">
    <div class="title" id="pageTitle"></div>
  </div>
<div class="wrap" id="playerWrap">
  <div class="board" id="board">
      <div class="columns">
        <div class="column text">
          <div class="column-viewport" id="textViewport">
            <div class="column-content" id="textContent"></div>
          </div>
  </div>
        <div class="column draw">
          <div class="column-viewport" id="drawViewport">
            <div class="column-content" id="drawContent"></div>
    </div>
        </div>
      </div>
      <div class="center-play" id="centerPlay">
        <button id="centerPlayBtn" title="Play">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5 L18 12 L8 19 Z" fill="currentColor"></path></svg>
        </button>
      </div>
    <div class="captions" id="captions"></div>
  </div>
</div>
  <div class="editor-pane" id="editorPane" style="display:none">
    <div class="editor-toolbar"></div>
    <textarea id="editorTextarea" class="editor-textarea" spellcheck="false"></textarea>
    <div class="editor-status" id="editorStatus"></div>
  </div>
  <div class="bottom-bar hidden" id="bottomBar">
  <button id="playPauseBtn" title="Play/Pause" aria-label="Play/Pause">
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3 L12 8 L4 13 Z" fill="currentColor"></path></svg>
  </button>
  <button id="rewindBtn" title="Rewind" aria-label="Rewind">
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4 L2 8 L8 12 Z M14 4 L8 8 L14 12 Z" fill="currentColor"></path></svg>
  </button>
  <button id="prevPageBtn" title="Prev page" aria-label="Prev page">
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M11 3 L5 8 L11 13 Z" fill="currentColor"></path></svg>
  </button>
  <button id="nextPageBtn" title="Next page" aria-label="Next page">
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3 L11 8 L5 13 Z" fill="currentColor"></path></svg>
  </button>
  <div class="progress-wrap">
    <input type="range" id="progress" min="0" max="1000" value="0">
    <div class="mono" id="timeText">0:00 / 0:00</div>
  </div>
  <select id="speedSel" title="Playback speed">
    <option value="0.75">0.75x</option>
    <option value="1" selected>1x</option>
    <option value="1.25">1.25x</option>
    <option value="1.5">1.5x</option>
    <option value="2">2x</option>
  </select>
  <button id="ccBtn" title="Captions" aria-label="Captions">CC</button>
  <button id="muteBtn" title="Mute" aria-label="Mute">
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6 H6 L9 3 V13 L6 10 H3 Z" fill="currentColor"></path></svg>
  </button>
  <button id="fontDecreaseBtn" title="Decrease font size" aria-label="Decrease font size">
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8 h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg>
  </button>
  <button id="fontIncreaseBtn" title="Increase font size" aria-label="Increase font size">
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3 v10 M4 7 h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
  </button>
  <button id="fullscreenBtn" title="Fullscreen" aria-label="Fullscreen">
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6 V3 H6 M10 3 H13 V6 M13 10 V13 H10 M6 13 H3 V10" stroke="currentColor" stroke-width="1.4" fill="none"></path></svg>
  </button>
  <button id="editorToggleBtn" title="Edit" aria-label="Edit" style="display:none">
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16.5 V20 H7.5 L18.3 9.2 L14.8 5.7 Z" fill="currentColor"></path><path d="M19.7 7.8 L17.2 5.3 L18.6 3.9 A1.2 1.2 0 0 1 20.3 3.9 L21.1 4.7 A1.2 1.2 0 0 1 21.1 6.4 Z" fill="currentColor"></path></svg>
  </button>
  </div>
</div>`;
  const scripts = [
    '<script src="https://cdn.jsdelivr.net/npm/markdown-it@13.0.2/dist/markdown-it.min.js"><\/script>',
    '<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"><\/script>',
    '<script src="https://cdn.jsdelivr.net/npm/markdown-it-texmath@1.0.0/texmath.min.js"><\/script>',
    '<script src="https://unpkg.com/rough-notation/lib/rough-notation.iife.js"><\/script>',
    '<script src="' + baseUrl + "/explain_parser.js\"><\/script>",
    '<script src="' + baseUrl + "/explain_defaults.js\"><\/script>",
    '<script type="text/plain" id="explain-embedded">' + escaped + '</script>',
    '<script>window.lectureText = document.getElementById("explain-embedded").textContent; window.explainAutoSource = null; window.explainSourceMap = {};<\/script>',
    '<script src="' + baseUrl + "/explain_player.js\"><\/script>",
  ].join("\n");
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "<meta charset=\"utf-8\" />",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    "<title>" + title.replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</title>",
    "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\" />",
    "<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin />",
    "<link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family=Comic+Neue:ital,wght@0,400;0,700;1,400;1,700&family=Patrick+Hand&family=Kalam:wght@300;400;700&family=Fira+Code:wght@400;500;600;700&family=JetBrains+Mono:ital,wght@0,400;0,700;1,400&display=swap\" />",
    "<style>" + styleContent + "</style>",
    "<link rel=\"stylesheet\" href=\"https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css\">",
    "</head>",
    "<body>",
    bodyHtml,
    scripts,
    "</body>",
    "</html>",
  ].join("\n");
}

if (els.editorDownloadBtn) {
  els.editorDownloadBtn.onclick = () => {
    const text = els.editorTextarea ? els.editorTextarea.value : "";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "explain_presentation.txt";
    a.click();
    URL.revokeObjectURL(url);
  };
}
if (els.editorSaveAsAppBtn) {
  els.editorSaveAsAppBtn.onclick = () => {
    const text = els.editorTextarea ? els.editorTextarea.value : "";
    if (!text.trim()) {
      setEditorStatus("No content to save", true);
      return;
    }
    const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) || "";
    const title = firstLine.startsWith("#") ? firstLine.replace(/^#+\s*/, "").trim() || "Presentation" : "Presentation";
    const html = buildSaveAsAppHtml(text, { title });
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "explain_app.html";
    a.click();
    URL.revokeObjectURL(url);
    setEditorStatus("Saved as app (explain_app.html)");
  };
}
if (els.editorUploadBtn && els.editorFileInput) {
  els.editorUploadBtn.onclick = () => els.editorFileInput.click();
  els.editorFileInput.addEventListener("change", async () => {
    const file = els.editorFileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (els.editorTextarea) {
        els.editorTextarea.value = text;
        state.editorText = text;
      }
      state.editorLoadedUrl = file.name;
      if (els.editorUrlInput) els.editorUrlInput.value = file.name;
      setEditorStatus(`Loaded into editor: ${file.name}`);
      scheduleEditorAutoApply();
    } catch (err) {
      setEditorStatus(String(err), true);
    }
  });
}
if (els.editorLoadBtn && els.editorUrlInput) {
  els.editorLoadBtn.onclick = () => loadEditorFromUrl(els.editorUrlInput.value);
  els.editorUrlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadEditorFromUrl(els.editorUrlInput.value);
  });
}
if (els.editorListSelect && els.editorUrlInput) {
  const openAndPopulate = async () => {
    if (!editorListIsLoaded()) {
      await loadEditorTutorialList();
    }
    els.editorListSelect.value = "";
    els.editorListSelect.focus();
    els.editorListSelect.click();
  };
  els.editorListSelect.addEventListener("mousedown", (e) => {
    if (editorListIsLoaded()) return;
    e.preventDefault();
    openAndPopulate();
  });
  els.editorListSelect.addEventListener("focus", () => {
    if (!editorListIsLoaded()) openAndPopulate();
  });
  els.editorListSelect.addEventListener("change", () => {
    const value = els.editorListSelect.value;
    if (!value) return;
    loadEditorFromUrl(value);
  });
  if (els.editorListRefreshBtn) {
    els.editorListRefreshBtn.addEventListener("click", () => {
      state.editorTutorialListCache = null;
      loadEditorTutorialList(true);
    });
  }
  if (!editorListIsLoaded()) {
    els.editorListSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select example";
    els.editorListSelect.appendChild(placeholder);
  }
}

if (els.editorTextarea) {
  els.editorTextarea.addEventListener("input", () => {
    scheduleEditorAutoApply();
  });
  els.editorTextarea.addEventListener("wheel", (e) => {
    e.stopPropagation();
  }, { passive: true });
}

els.playPauseBtn.onclick = () => {
  if (state.editorOpen) {
    applyEditorAndPlay();
    return;
  }
  if (state.waitingForClick) {
    state.waitingForClick();
    return;
  }
  if (state.playing) {
  cancelAll();
  state.playing = false;
  state.paused = true;
    els.playPauseBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3 L12 8 L4 13 Z" fill="currentColor"></path></svg>';
    showBottomBar();
    return;
  }
  startPlayback();
};

els.rewindBtn.onclick = () => rewindPage();
function getStepAnchorIndex() {
  if (!hasLecture()) return -1;
  if (Number.isFinite(state.lastExecutedIndex)) {
    return Math.max(-1, Math.min(lecture.commands.length - 1, state.lastExecutedIndex));
  }
  return Math.max(-1, Math.min(lecture.commands.length - 1, state.commandIndex - 1));
}

els.prevPageBtn.onclick = () => {
  if (!hasLecture()) return;
  const anchor = getStepAnchorIndex();
  const target = Math.max(0, anchor);
  seekTo(target);
};
els.nextPageBtn.onclick = () => {
  if (!hasLecture()) return;
  const anchor = getStepAnchorIndex();
  const target = Math.min(lecture.commands.length, anchor + 2);
  seekTo(target);
};

els.fullscreenBtn.onclick = async () => {
  if (!document.fullscreenElement) {
    await els.player.requestFullscreen();
  } else {
    await document.exitFullscreen();
  }
};

function applyFontScaleDelta(delta) {
  const scale = state.defaults.font_scale ?? 1.0;
  const next = Math.max(0.5, Math.min(2, scale * delta));
  state.defaults.font_scale = next;
  applyThemeDefaults(state.defaults);
  updateContentFontSizes();
}

if (els.fontIncreaseBtn) {
  els.fontIncreaseBtn.onclick = () => applyFontScaleDelta(1.15);
  els.fontIncreaseBtn.title = "Increase font size";
  els.fontIncreaseBtn.setAttribute("aria-label", "Increase font size");
}
if (els.fontDecreaseBtn) {
  els.fontDecreaseBtn.onclick = () => applyFontScaleDelta(1 / 1.15);
  els.fontDecreaseBtn.title = "Decrease font size";
  els.fontDecreaseBtn.setAttribute("aria-label", "Decrease font size");
}

if (els.player) {
  els.player.addEventListener("mousemove", () => {
    showBottomBar();
  });
  els.player.addEventListener("click", () => {
    showBottomBar();
  });
}

els.board.addEventListener("click", (e) => {
  const interactive = e.target.closest("button, a, input, textarea, select");
  if (interactive) return;
  const noPause = e.target.closest('[data-pause-on-click="false"]');
  if (noPause) return;
  if (state.waitingForClick) {
    state.waitingForClick();
    return;
  }
  if (state.playing) {
    cancelAll();
    state.playing = false;
    state.paused = true;
    els.playPauseBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3 L12 8 L4 13 Z" fill="currentColor"></path></svg>';
    showBottomBar();
    return;
  }
});

els.progress.addEventListener("input", () => {
  const target = Number(els.progress.value || 0);
  const prepended = hasLecture() && typeof lecture.prependedStartCount === "number" ? lecture.prependedStartCount : 0;
  seekTo(prepended + target);
});

els.speedSel.addEventListener("change", () => {
  state.speed = Number(els.speedSel.value || 1);
  updateProgressUI();
  showBottomBar();
});

els.ccBtn.onclick = () => {
  state.captionsOn = !state.captionsOn;
  setToggleState(els.ccBtn, state.captionsOn);
  updateCaptions("");
};

els.muteBtn.onclick = () => {
  state.muted = !state.muted;
  setToggleState(els.muteBtn, state.muted);
  updateMuteIcon();
  updateCaptions("");
};

window.addEventListener("resize", () => {
  updateAllColumns();
  applyLayout();
});

document.addEventListener("fullscreenchange", () => {
  const isFs = !!document.fullscreenElement;
  els.player.classList.toggle("fullscreen", isFs);
  updateFullscreenIcon(isFs);
  updateAllColumns();
});

// Bind the player API for src/player/core.js so registered action handlers
// can call into the player (speakText, sleep, clearBoard, etc.) without
// reaching into this file's internal scope. See src/player/core.js for the
// contract and src/player/handlers/*.js for consumers.
if (typeof window !== "undefined" && window.Xplainer && window.Xplainer.playerApi) {
  // The api surface is split into two tiers:
  //   1. Curated top-level methods (speak, sleep, renderMarkdown, etc.) — the
  //      stable API that extracted handlers should prefer where it exists.
  //   2. api.internal.* — a live bag of every module-scoped helper an extracted
  //      handler might need. Intentionally broad so the Phase B extraction is
  //      mechanical. Future cleanup can curate this into focused submodules.
  //
  // CRITICAL: `state` and `webComponentRegistry` are exposed as live references,
  // not snapshots — extracted handlers must NOT destructure them (`const { foo } =
  // api.state` is a trap). Property reads and writes through api.state.foo are
  // visible to the rest of this file, which is how web component auto-registration
  // and draw-context mutation stay consistent between monolith and handlers.
  window.Xplainer.playerApi.bind({
    els,
    state,
    speak: (text, token, speakOpts) => speakText(text, token ?? state.cancelToken, speakOpts || {}),
    sleep: (ms, token) => sleep(ms, token ?? state.cancelToken),
    clearBoard,
    setPageTitle,
    renderMarkdown: (text, targetOrOpts, maybeTarget) => {
      // Two call shapes: renderMarkdown(text, targetEl) or renderMarkdown(text, opts, targetEl).
      if (targetOrOpts && targetOrOpts.nodeType === 1) return renderMarkdownBlock(text, {}, targetOrOpts);
      return renderMarkdownBlock(text, targetOrOpts || {}, maybeTarget || els.textContent);
    },
    appendToLocation: (el, location) => appendToLocation(el, location),
    getCurrentToken: () => state.cancelToken,
    internal: {
      // Mutable live references (NEVER destructure):
      webComponentRegistry,
      libraryComponentsBase: EXPLAINER_LIBRARY_COMPONENTS_BASE,
      // Structure / defaults / layout helpers
      autoDimLatest, clearDimAll, applySkinDefaults, extractDefaults,
      applyThemeDefaults, applyLayout, preloadPyodide, startBackgroundRequirements,
      applyWebDefaults, fastForwardTo, cancelAll, waitForClick,
      // Text / speech / markdown helpers
      speakText, speakTextPlan, parseWriteSpeakChunk, splitWriteText,
      renderMarkdownBlock, resolveLocation, getColumnForLocation,
      resolveWriteSpeakMode, extractMarkdownHeadlines, markdownToText,
      applyRoughAnnotations, ensureRoughNotation, animateWriteReveal,
      scrollColumnToBottom, processInlineMarkup, getTargetIds, getMd,
      // Media helpers
      ensureImageReady, resolveImageTarget, mountSvgString, animateSvgDraw,
      renderTableBlock, createHtmlElement, applyCssFromSpec, applyPauseOnClick,
      registerElement, getElement, applyTooltip, buildRoughConfig,
      updateAllColumns,
      // Annotation helpers
      applyHighlight, applyUnderline, applyMove, applyRotate, applyChange,
      applyDelete, getMarkableElements, resolveMarkTarget, resolveMarkColor,
      runWholeElementMark, runCodeHighlight, runTableAnnotate, runTextAnnotate,
      runImageMark, wrapFirstTextMatch, getFocusableElements, parseIndexSpec,
      setDimForIndices, undimIndices, createDrawBlock, runDrawCommand,
      resolveCodeCell, pickElementByLocation, pickLatestElement, getAnnotateText,
      // Web component / interactive helpers
      loadWebComponentScript, loadExplainComponents, runWebComponentDefine,
      showWaitClickScreen, loadLectureFromReference, startPlayback,
      // Diagram / sketch helpers
      applyMermaidInContainer, createP5FromAction, initP5,
      renderMermaidDiagram, removeP5Instance, isMovieMode,
      // Math lazy-load
      ensureMath, isLazy,
    },
    // Engines surfaced via src/player/engines/base.js — those call these low-level fns.
    _runPyodideCode: (code, autoInstall, micropipSpecs) => runPyodideCode(code, autoInstall, micropipSpecs),
    _runRCode: (code) => runRCode(code),
    _runJsCode: (code) => runJsCode(code),
    _renderPyodideResult: (result, outputEl, append) => renderPyodideResult(result, outputEl, append),
    _renderRResult: (result, outputEl, append) => renderRResult(result, outputEl, append),
    _renderJsResult: (result, outputEl) => renderJsResult(result, outputEl),
  });
}

// Phase A.5: boot timing. Cold-cache numbers can be compared before/after the
// lazy-load work by reading this line out of the console.
try {
  const bootMs = Math.round(((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - __xplainerBootStart);
  console.info("[xplainer] boot", bootMs, "ms");
} catch {}

state.pages = buildPages();
state.speed = Number(els.speedSel.value || 1);

updateFullscreenIcon(false);
applyLayout();
applyThemeDefaults(state.defaults);
if (els.bottomBar) els.bottomBar.classList.add("hidden");
setToggleState(els.ccBtn, state.captionsOn);
setToggleState(els.muteBtn, state.muted);
updateMuteIcon();

const initialLecture = normalizeLectureData(window.lecture)
  || (window.lectureText && window.parseLectureText ? window.parseLectureText(window.lectureText) : null);
if (initialLecture) {
  (async () => {
    await runWebComponentDefinitions(initialLecture.commands);
    prependStartCommands(initialLecture);
    await resetForLecture(initialLecture);
  })();
} else {
  const hashSource = getHashSource();
  if (hashSource) {
    (async () => {
      setSourceStatus("Loading...");
      const url = resolveHashSourceToUrl(hashSource.type, hashSource.text);
      if (!url) {
        setSourceStatus("Invalid hash: missing or invalid source", true);
        return;
      }
      try {
        if (els.sourceInput && !els.sourceInput.value) els.sourceInput.value = url;
        await loadLectureFromReference(url);
        setSourcePanelOpen(false);
      } catch (err) {
        setSourceStatus(String(err && err.message ? err.message : err), true);
      }
    })();
  } else {
    const hashName = getHashTutorialName();
    if (hashName) {
      (async () => {
        setSourceStatus("Loading...");
        const local = await tryFetchHashTutorialFromLocal(hashName);
        if (local) {
          if (els.sourceInput && !els.sourceInput.value) els.sourceInput.value = local.url;
          await loadLectureFromText(local.text, local.url);
          setSourcePanelOpen(false);
        } else {
          const hashUrl = getHashTutorialUrl();
          if (els.sourceInput && !els.sourceInput.value) els.sourceInput.value = hashUrl;
          await handleSourceLoad(hashUrl);
        }
      })();
    } else {
      const autoSource = window.explainAutoSource;
      const preferredSource = autoSource;
      if (preferredSource) {
        if (els.sourceInput && !els.sourceInput.value) {
          els.sourceInput.value = preferredSource;
        }
        handleSourceLoad(preferredSource);
      } else {
        updatePageForIndex(0);
        updateProgressUI();
        setSourceStatus("No lecture loaded");
        hideCenterPlay();
      }
    }
  }
}
