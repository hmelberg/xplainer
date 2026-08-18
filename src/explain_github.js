// Save the editor's lecture to a GitHub repo via the contents API.
// Auth: a fine-grained Personal Access Token (one repo, contents:
// read/write), pasted once and stored in this browser's localStorage.
// The editor already loads raw GitHub URLs, so a saved file round-trips,
// and #github-{owner}/{repo}/blob/{branch}/{path} plays it directly.
(function () {
  "use strict";

  var LS_CFG = "xplainer_github";

  var els = {};

  function setStatus(text, isError) {
    var el = document.getElementById("editorStatus");
    if (!el) return;
    el.textContent = text || "";
    el.style.color = isError ? "#fca5a5" : "var(--muted)";
  }

  function getCfg() {
    try { return JSON.parse(localStorage.getItem(LS_CFG) || "{}") || {}; } catch (e) { return {}; }
  }
  function setCfg(cfg) {
    try { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
  }

  function deriveFileName() {
    var textarea = document.getElementById("editorTextarea");
    var text = textarea ? textarea.value : "";
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^:::\s*(?:new_page|title|intro)\s*\(([^)]*)\)/);
      if (m) {
        var t = m[1].match(/(?:title|text)\s*=\s*([^,)]+)/);
        if (t) return slugify(t[1]) + ".txt";
      }
    }
    for (var k = 0; k < lines.length; k++) {
      var line = lines[k].trim();
      if (line && !line.startsWith(":::")) return slugify(line.replace(/^#+\s*/, "")) + ".txt";
    }
    return "lecture.txt";
  }
  function slugify(s) {
    return String(s).trim().replace(/^["']|["']$/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "lecture";
  }

  function b64utf8(text) {
    return btoa(unescape(encodeURIComponent(text)));
  }

  // ---------- GitHub API ----------

  function ghFetch(cfg, url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({
      Authorization: "Bearer " + cfg.token,
      Accept: "application/vnd.github+json",
    }, opts.headers || {});
    return fetch(url, opts);
  }

  function contentsUrl(cfg) {
    return "https://api.github.com/repos/" + cfg.owner + "/" + cfg.repo +
      "/contents/" + cfg.path.split("/").map(encodeURIComponent).join("/");
  }

  function getExistingSha(cfg) {
    return ghFetch(cfg, contentsUrl(cfg) + "?ref=" + encodeURIComponent(cfg.branch)).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) return failFromJson(res);
      return res.json().then(function (data) { return data.sha || null; });
    });
  }

  function putFile(cfg, text, sha) {
    var body = {
      message: (sha ? "Update " : "Add ") + cfg.path + " (from xplainer editor)",
      content: b64utf8(text),
      branch: cfg.branch,
    };
    if (sha) body.sha = sha;
    return ghFetch(cfg, contentsUrl(cfg), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function failFromJson(res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      throw Object.assign(new Error(data.message || ("GitHub error " + res.status)), { code: res.status });
    });
  }

  function saveToGithub(cfg, text) {
    return getExistingSha(cfg).then(function (sha) {
      return putFile(cfg, text, sha).then(function (res) {
        if (res.status === 409 || res.status === 422) {
          // Someone else pushed between our GET and PUT — refetch sha once.
          return getExistingSha(cfg).then(function (freshSha) {
            return putFile(cfg, text, freshSha).then(function (res2) {
              if (!res2.ok) return failFromJson(res2);
              return res2.json();
            });
          });
        }
        if (!res.ok) return failFromJson(res);
        return res.json();
      });
    });
  }

  // ---------- UI ----------

  function injectStyles() {
    var css = [
      ".editor-gh-overlay { position:fixed; inset:0; background:rgba(0,0,0,.55);",
      "  display:none; align-items:center; justify-content:center; z-index:10000; }",
      ".editor-gh-overlay.visible { display:flex; }",
      ".editor-gh-modal { background:#1e293b; color:#e2e8f0; border:1px solid rgba(255,255,255,.12);",
      "  border-radius:10px; padding:18px; width:min(460px, 92vw); font-size:14px;",
      "  box-shadow:0 18px 50px rgba(0,0,0,.5); }",
      ".editor-gh-modal h3 { margin:0 0 10px; font-size:15px; }",
      ".editor-gh-modal p { margin:6px 0 12px; font-size:12px; color:#94a3b8; line-height:1.5; overflow-wrap:anywhere; }",
      ".editor-gh-modal a { color:#7dd3fc; }",
      ".editor-gh-modal label { display:block; font-size:12px; color:#94a3b8; margin:8px 0 3px; }",
      ".editor-gh-modal input { width:100%; box-sizing:border-box; background:#0f172a; color:#e2e8f0;",
      "  border:1px solid rgba(255,255,255,.15); border-radius:6px; padding:6px 8px; font-size:13px; }",
      ".editor-gh-row { display:flex; gap:8px; }",
      ".editor-gh-row > div { flex:1; }",
      ".editor-gh-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:14px; }",
    ].join("\n");
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildModal() {
    var overlay = document.createElement("div");
    overlay.className = "editor-gh-overlay";
    overlay.innerHTML = '<div class="editor-gh-modal" id="ghModalBody"></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) hideModal();
    });
    els.overlay = overlay;
    els.modalBody = overlay.querySelector("#ghModalBody");
  }
  function showModal(html) {
    els.modalBody.innerHTML = html;
    els.overlay.classList.add("visible");
  }
  function hideModal() { els.overlay.classList.remove("visible"); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function showSaveDialog(text) {
    var cfg = getCfg();
    var path = cfg.path || deriveFileName();
    showModal(
      "<h3>Save to GitHub</h3>" +
      "<p>Needs a <a href='https://github.com/settings/personal-access-tokens/new' target='_blank' rel='noopener'>" +
      "fine-grained personal access token</a> for the target repo with " +
      "<b>Contents: read and write</b>. Stored only in this browser.</p>" +
      "<label>Token</label><input id='ghToken' type='password' autocomplete='off' value='" + esc(cfg.token || "") + "' placeholder='github_pat_…' />" +
      "<div class='editor-gh-row'><div><label>Owner</label><input id='ghOwner' value='" + esc(cfg.owner || "") + "' placeholder='hmelberg' /></div>" +
      "<div><label>Repo</label><input id='ghRepo' value='" + esc(cfg.repo || "") + "' placeholder='lectures' /></div>" +
      "<div><label>Branch</label><input id='ghBranch' value='" + esc(cfg.branch || "main") + "' /></div></div>" +
      "<label>File path</label><input id='ghPath' value='" + esc(path) + "' />" +
      "<div class='editor-gh-actions'>" +
      "<button class='editor-btn' id='ghSaveBtn'>Save</button>" +
      "<button class='editor-btn' id='ghCancelBtn'>Cancel</button></div>"
    );
    els.modalBody.querySelector("#ghCancelBtn").addEventListener("click", hideModal);
    els.modalBody.querySelector("#ghSaveBtn").addEventListener("click", function () {
      var next = {
        token: els.modalBody.querySelector("#ghToken").value.trim(),
        owner: els.modalBody.querySelector("#ghOwner").value.trim(),
        repo: els.modalBody.querySelector("#ghRepo").value.trim(),
        branch: els.modalBody.querySelector("#ghBranch").value.trim() || "main",
        path: els.modalBody.querySelector("#ghPath").value.trim(),
      };
      if (!next.token || !next.owner || !next.repo || !next.path) {
        setStatus("Token, owner, repo and file path are all required.", true);
        return;
      }
      setCfg(next);
      hideModal();
      runSave(next, text);
    });
  }

  function showResult(cfg) {
    var rawUrl = "https://raw.githubusercontent.com/" + cfg.owner + "/" + cfg.repo + "/" + cfg.branch + "/" + cfg.path;
    var repoUrl = "https://github.com/" + cfg.owner + "/" + cfg.repo + "/blob/" + cfg.branch + "/" + cfg.path;
    var play = location.origin + location.pathname + "#github-" + cfg.owner + "/" + cfg.repo + "/blob/" + cfg.branch + "/" + cfg.path;
    showModal(
      "<h3>Saved to GitHub</h3>" +
      '<p>Play link (share this):<br/><a href="' + esc(play) + '" target="_blank" rel="noopener">' + esc(play) + "</a></p>" +
      '<p>File on GitHub:<br/><a href="' + esc(repoUrl) + '" target="_blank" rel="noopener">' + esc(repoUrl) + "</a></p>" +
      '<p>Raw URL (loads in the editor):<br/><a href="' + esc(rawUrl) + '" target="_blank" rel="noopener">' + esc(rawUrl) + "</a></p>" +
      "<div class='editor-gh-actions'>" +
      "<button class='editor-btn' id='ghCopyBtn'>Copy play link</button>" +
      "<button class='editor-btn' id='ghDoneBtn'>Done</button></div>"
    );
    els.modalBody.querySelector("#ghDoneBtn").addEventListener("click", hideModal);
    els.modalBody.querySelector("#ghCopyBtn").addEventListener("click", function () {
      navigator.clipboard.writeText(play).then(function () {
        setStatus("Play link copied.");
      }, function () {
        setStatus("Could not copy — select the link manually.", true);
      });
    });
  }

  function runSave(cfg, text) {
    setStatus("Saving to GitHub…");
    saveToGithub(cfg, text).then(function () {
      setStatus("Saved to " + cfg.owner + "/" + cfg.repo + "/" + cfg.path + ".");
      showResult(cfg);
    }).catch(function (err) {
      var hint = err.code === 401 ? " (token invalid or expired?)"
        : err.code === 404 ? " (repo not found, or the token lacks access to it)" : "";
      setStatus("GitHub save failed: " + err.message + hint, true);
    });
  }

  function init() {
    var pane = document.getElementById("editorPane");
    var actions = pane && pane.querySelector(".editor-actions");
    if (!actions) return;
    injectStyles();
    buildModal();
    var btn = document.createElement("button");
    btn.id = "editorGithubBtn";
    btn.className = "editor-btn";
    btn.textContent = "GitHub";
    btn.title = "Commit this lecture to a GitHub repo (personal access token)";
    btn.addEventListener("click", function () {
      var textarea = document.getElementById("editorTextarea");
      var text = textarea ? textarea.value : "";
      if (!text.trim()) {
        setStatus("Nothing to save — the editor is empty.", true);
        return;
      }
      showSaveDialog(text);
    });
    actions.appendChild(btn);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
