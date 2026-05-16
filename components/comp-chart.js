/**
 * Web component wrapper for Chart.js (https://www.chartjs.org/docs/latest/).
 * Use with ::: comp comp-chart (or ::: component comp-chart) and block body = JSON config (type, data, options).
 * Set web_defaults: comp-chart=config so body maps to the config attribute.
 * Uses Shadow DOM for style isolation.
 *
 * Chart.js is loaded from CDN on first use. Config = full Chart.js config object.
 *
 * Size defaults (set before first use): window.explainCompChartMaxHeight (e.g. "45vh"),
 * window.explainCompChartMaxWidth (e.g. "100%"), or window.explainCompChartDefaults = { maxHeight, maxWidth }.
 * With maintainAspectRatio (default true), Chart.js scales to fit the container; max-height is the main constraint.
 */
(function () {
  const tagName = "comp-chart";
  if (typeof customElements !== "undefined" && customElements.get(tagName)) return;

  const CHART_JS_URL = "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js";

  function getChartSizeDefault(key) {
    if (typeof window === "undefined") return key === "maxHeight" ? "45vh" : "100%";
    const d = window.explainCompChartDefaults;
    if (d && d[key] != null) return d[key];
    if (key === "maxHeight") return window.explainCompChartMaxHeight || "45vh";
    if (key === "maxWidth") return window.explainCompChartMaxWidth || "100%";
    return key === "maxHeight" ? "45vh" : "100%";
  }

  function loadChartJs() {
    if (window.Chart) return Promise.resolve(window.Chart);
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = CHART_JS_URL;
      script.onload = () => resolve(window.Chart);
      script.onerror = () => reject(new Error("Failed to load Chart.js"));
      document.head.appendChild(script);
    });
  }

  class CompChart extends HTMLElement {
    static get observedAttributes() {
      return ["config"];
    }

    constructor() {
      super();
      this._chart = null;
      this._config = null;
      this.attachShadow({ mode: "open" });
    }

    get _root() {
      return this.shadowRoot;
    }

    connectedCallback() {
      this._render();
    }

    attributeChangedCallback(name, _oldVal, newVal) {
      if (name === "config") this._render();
    }

    async _render() {
      const root = this._root;
      if (!root) return;

      let config = null;
      if (this.config && typeof this.config === "object") {
        config = this.config;
      } else {
        let raw = this.getAttribute("config") || this._config || "";
        if (!raw || String(raw).trim() === "") {
          const text = (this.textContent || "").trim();
          if (text && (text.startsWith("{") || text.startsWith("["))) raw = text;
        }
        const str = String(raw).trim();
        if (!str) {
          if (typeof window !== "undefined") {
            console.warn("[comp-chart] no config", {
              attr: this.getAttribute("config") ? "(set)" : "(missing)",
              attrLen: (this.getAttribute("config") || "").length,
              hasConfigProp: !!(this.config && typeof this.config === "object"),
              textContentLen: (this.textContent || "").trim().length,
            });
          }
          root.innerHTML = "<span style='font-size:12px;color:#888'>[comp-chart: no config]</span>";
          return;
        }
        try {
          config = JSON.parse(str);
        } catch (e) {
          root.innerHTML = "<pre style='margin:0;font-size:13px;color:#c00'>Chart config JSON error: " + (e && e.message ? e.message : String(e)) + "</pre>";
          return;
        }
      }
      if (!config || typeof config !== "object") {
        root.innerHTML = "";
        return;
      }
      if (typeof window !== "undefined" && window.__explainLogWeb) {
        console.log("[comp-chart] rendering", { type: config.type });
      }
      root.innerHTML = "";
      const wrap = document.createElement("div");
      wrap.style.position = "relative";
      wrap.style.width = "100%";
      wrap.style.maxWidth = getChartSizeDefault("maxWidth");
      wrap.style.maxHeight = getChartSizeDefault("maxHeight");
      wrap.style.minHeight = "200px";
      const canvas = document.createElement("canvas");
      wrap.appendChild(canvas);
      root.appendChild(wrap);

      function waitForLayout(container, timeoutMs) {
        return new Promise((resolve) => {
          if (container.offsetWidth > 0 && container.offsetHeight > 0) return resolve();
          const deadline = Date.now() + (timeoutMs || 2000);
          const check = () => {
            if (container.offsetWidth > 0 && container.offsetHeight > 0) return resolve();
            if (Date.now() >= deadline) return resolve();
            requestAnimationFrame(check);
          };
          requestAnimationFrame(() => requestAnimationFrame(check));
        });
      }

      try {
        await waitForLayout(wrap, 2000);
        if (!this.isConnected || !root.contains(wrap)) return;
        const Chart = await loadChartJs();
        if (!this.isConnected || !root.contains(wrap)) return;
        if (this._chart) {
          this._chart.destroy();
          this._chart = null;
        }
        const opts = config.options || {};
        if (opts.responsive === undefined) opts.responsive = true;
        if (opts.maintainAspectRatio === undefined) opts.maintainAspectRatio = true;
        this._chart = new Chart(canvas, {
          type: config.type || "bar",
          data: config.data || { labels: [], datasets: [] },
          options: opts,
          plugins: config.plugins,
        });
      } catch (err) {
        wrap.innerHTML = "<pre style='margin:0;font-size:13px;color:#c00'>Chart error: " + (err && err.message ? err.message : String(err)) + "</pre>";
      }
    }
  }

  customElements.define(tagName, CompChart);
})();
