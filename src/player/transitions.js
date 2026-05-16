/**
 * Xplainer slide transitions.
 *
 * Phase B.6 of the modular refactor moved transition handling INTO the
 * `new_page` handler in src/player/handlers/structure.js. This file no longer
 * registers its own action handler — the registry has no handler-chain
 * support, so having both `structure.js` and this file register "new_page"
 * would result in last-write-wins and the transition decorator disappearing.
 *
 * Instead, this file just attaches the `applyTransition` helper and its CSS
 * onto window.Xplainer.transitions. The structure.js new_page handler calls
 * that helper inline after it has cleared the board and populated the next
 * slide's content.
 *
 * Supported transitions: cut (default, no-op), fade, wipe-left, wipe-right,
 * iris, cross-dissolve, slide-up. Authors write:
 *
 *   ::: new_page(title="Chapter 2", transition=fade)
 *   ::: new_page(transition=wipe-left, duration=500)
 *
 * Or set a lecture-wide default:  ::: defaults(transition=fade)
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (!window.Xplainer) {
    console.warn("[Xplainer.transitions] core.js must load first");
    return;
  }

  const STYLE_ID = "xplainer-transitions-styles";
  const CSS = `
    .xp-transition { animation-timing-function: ease-out; animation-fill-mode: both; }
    .xp-transition-fade         { animation: xp-fade var(--xp-transition-dur, 600ms); }
    .xp-transition-wipe-left    { animation: xp-wipe-left var(--xp-transition-dur, 600ms); }
    .xp-transition-wipe-right   { animation: xp-wipe-right var(--xp-transition-dur, 600ms); }
    .xp-transition-iris         { animation: xp-iris var(--xp-transition-dur, 700ms); }
    .xp-transition-cross-dissolve { animation: xp-cross-dissolve var(--xp-transition-dur, 900ms); }
    .xp-transition-slide-up     { animation: xp-slide-up var(--xp-transition-dur, 600ms); }
    @keyframes xp-fade         { from { opacity: 0; } to { opacity: 1; } }
    @keyframes xp-wipe-left    { from { clip-path: inset(0 0 0 100%); } to { clip-path: inset(0 0 0 0); } }
    @keyframes xp-wipe-right   { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
    @keyframes xp-iris         { from { clip-path: circle(0% at 50% 50%); } to { clip-path: circle(120% at 50% 50%); } }
    @keyframes xp-cross-dissolve { 0% { opacity: 0; filter: blur(8px); } 100% { opacity: 1; filter: blur(0); } }
    @keyframes xp-slide-up     { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: translateY(0); } }
  `;

  function injectStylesOnce() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /**
   * applyTransition(board, name, duration) — add a transition class to the
   * board element so the named CSS animation plays on the next slide.
   * No-op for name === "cut" / "none" / empty. Called from structure.js.
   */
  function applyTransition(board, name, duration) {
    if (!board || !name || name === "cut" || name === "none") return;
    injectStylesOnce();
    const cls = "xp-transition-" + String(name).replace(/_/g, "-");
    // Clear any prior transition class before re-applying so the animation restarts.
    board.classList.remove(
      "xp-transition",
      "xp-transition-fade",
      "xp-transition-wipe-left",
      "xp-transition-wipe-right",
      "xp-transition-iris",
      "xp-transition-cross-dissolve",
      "xp-transition-slide-up",
    );
    if (duration) {
      board.style.setProperty("--xp-transition-dur", duration + "ms");
    } else {
      board.style.removeProperty("--xp-transition-dur");
    }
    // Force reflow so the animation restarts reliably.
    void board.offsetWidth;
    board.classList.add("xp-transition", cls);
    // Clean up the class after the animation so it doesn't linger on the element.
    const cleanup = () => {
      board.classList.remove("xp-transition", cls);
      board.removeEventListener("animationend", cleanup);
    };
    board.addEventListener("animationend", cleanup);
  }

  window.Xplainer.transitions = { applyTransition, injectStylesOnce };
})();
