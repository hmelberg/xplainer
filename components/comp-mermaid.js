/**
 * comp-mermaid: web component for Mermaid diagrams. Load via ::: webcomponent comp-mermaid(script=./components/comp-mermaid.js)
 * or rely on auto-load from components/comp-mermaid.js. Body maps to "content" attribute.
 */
(function () {
  const tagName = "comp-mermaid";
  if (typeof customElements !== "undefined" && customElements.get(tagName)) return;
  class CompMermaid extends HTMLElement {
    static get observedAttributes() {
      return ["content"];
    }
    connectedCallback() {
      this._render();
    }
    attributeChangedCallback() {
      this._render();
    }
    async _render() {
      const code = (this.getAttribute("content") || this.textContent || "").trim();
      if (!code) return;
      if (this._lastCode === code) return;
      this._lastCode = code;
      this.innerHTML = "<span style='color:#8b949e;'>Loading diagram…</span>";
      try {
        let mermaid = typeof window !== "undefined" && window.mermaid;
        if (!mermaid) {
          const mod = await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
          mermaid = mod.default || mod.mermaid || mod;
          if (typeof mermaid.initialize === "function") mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });
        }
        const id = "mermaid-" + Math.random().toString(36).slice(2);
        const { svg, bindFunctions } = await mermaid.render(id, code);
        const wrap = document.createElement("div");
        wrap.className = "mermaid-block";
        wrap.style.maxWidth = "100%";
        wrap.innerHTML = svg;
        if (typeof bindFunctions === "function") bindFunctions(wrap);
        this.innerHTML = "";
        this.appendChild(wrap);
      } catch (err) {
        this.innerHTML = "";
        const pre = document.createElement("pre");
        pre.style.margin = "0";
        pre.style.fontSize = "13px";
        pre.textContent = "Mermaid error: " + (err && err.message ? err.message : String(err));
        this.appendChild(pre);
      }
    }
  }
  customElements.define(tagName, CompMermaid);
})();
