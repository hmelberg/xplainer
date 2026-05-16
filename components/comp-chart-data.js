/**
 * comp-chart-data: web component that accepts CSV-like body and renders via comp-chart.
 * Kwargs: type (line|bar|pie|doughnut|...), delimiter (,|;), header (true|false),
 * legend_position, options (JSON string). Default: legend on the right, stacked vertically.
 * Set web_defaults: comp-chart-data=content so block body maps to the content attribute.
 */
(function () {
  const tagName = "comp-chart-data";
  if (typeof customElements !== "undefined" && customElements.get(tagName)) return;

  function loadCompChart() {
    if (typeof customElements !== "undefined" && customElements.get("comp-chart")) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const url = new URL("components/comp-chart.js", document.baseURI).href;
      const script = document.createElement("script");
      script.src = url;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load comp-chart.js"));
      document.head.appendChild(script);
    });
  }

  function parseCSV(text, delimiter, hasHeader) {
    const delim = (delimiter || ",").trim() || ",";
    const lines = String(text || "")
      .split(/\r\n|\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return { labels: [], datasets: [] };
    const rows = lines.map((line) => line.split(delim).map((c) => c.trim()));
    let headers = null;
    let dataRows = rows;
    if (hasHeader !== false && rows.length > 0) {
      headers = rows[0];
      dataRows = rows.slice(1);
    }
    if (dataRows.length === 0) return { labels: [], datasets: [] };
    const numCols = Math.max(...dataRows.map((r) => r.length));
    const labels = dataRows.map((r) => (r[0] != null ? String(r[0]) : ""));
    const datasets = [];
    for (let col = 1; col < numCols; col++) {
      const label = headers && headers[col] != null ? String(headers[col]) : "Series " + col;
      const data = dataRows.map((r) => {
        const v = r[col];
        if (v === "" || v == null) return NaN;
        const n = Number(v);
        return Number.isFinite(n) ? n : v;
      });
      datasets.push({ label, data });
    }
    return { labels, datasets };
  }

  function buildConfig(parsed, chartType, extraOptions) {
    const isPieLike = /^pie$|^doughnut$|^polarArea$/i.test(chartType);
    let labels = parsed.labels;
    let datasets = parsed.datasets;
    if (isPieLike && datasets.length > 1) {
      datasets = [{ label: datasets[0].label, data: datasets[0].data }];
    }
    const options = {
      responsive: true,
      maintainAspectRatio: true,
      legend: {
        position: "right",
        labels: { boxWidth: 12 },
      },
      ...(extraOptions && typeof extraOptions === "object" ? extraOptions : {}),
    };
    return {
      type: chartType || "bar",
      data: { labels, datasets },
      options,
    };
  }

  class CompChartData extends HTMLElement {
    static get observedAttributes() {
      return ["content", "type", "delimiter", "header", "legend_position", "options"];
    }

    constructor() {
      super();
      this.attachShadow({ mode: "open" });
    }

    connectedCallback() {
      this._render();
    }

    attributeChangedCallback() {
      this._render();
    }

    _render() {
      const root = this.shadowRoot;
      if (!root) return;
      const raw = (this.getAttribute("content") || this.textContent || "").trim();
      if (!raw) {
        root.innerHTML = "<span style='font-size:12px;color:#888'>[comp-chart-data: no content]</span>";
        return;
      }
      const chartType = (this.getAttribute("type") || "bar").toLowerCase();
      const delimiter = this.getAttribute("delimiter") || ",";
      const headerAttr = this.getAttribute("header");
      const hasHeader = headerAttr === "false" || headerAttr === "0" ? false : true;
      let extraOptions = null;
      try {
        const optStr = this.getAttribute("options");
        if (optStr) extraOptions = JSON.parse(optStr);
      } catch (_) {}
      const legendPos = this.getAttribute("legend_position");
      if (legendPos && !extraOptions) extraOptions = {};
      if (legendPos && extraOptions) {
        if (!extraOptions.legend) extraOptions.legend = {};
        extraOptions.legend.position = legendPos;
      }
      const parsed = parseCSV(raw, delimiter, hasHeader);
      if (parsed.labels.length === 0 && parsed.datasets.length === 0) {
        root.innerHTML = "<span style='font-size:12px;color:#888'>[comp-chart-data: no data]</span>";
        return;
      }
      const config = buildConfig(parsed, chartType, extraOptions);
      loadCompChart().then(() => {
        if (!this.isConnected || !root) return;
        root.innerHTML = "";
        const comp = document.createElement("comp-chart");
        comp.setAttribute("config", JSON.stringify(config));
        comp.config = config;
        root.appendChild(comp);
      }).catch((err) => {
        root.innerHTML = "<pre style='margin:0;font-size:13px;color:#c00'>comp-chart-data: " + (err && err.message ? err.message : String(err)) + "</pre>";
      });
    }
  }

  customElements.define(tagName, CompChartData);
})();
