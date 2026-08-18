// Save the editor's lecture to a Google Doc in the USER'S own Drive.
// Closes the loop with the #gdoc-{id} autoplay path: save → share link →
// anyone can play it, collaborators edit the doc in Google's UI.
//
// Auth: Google Identity Services token client, scope drive.file
// (non-sensitive; the app can only touch files it created). Tokens are
// short-lived and kept in memory only. The client id below is public.
//
// Setup (one-time, site owner): Google Cloud project → enable Drive API →
// OAuth client ID (web application) with this site's origin → paste the
// id into GOOGLE_CLIENT_ID.
(function () {
  "use strict";

  var GOOGLE_CLIENT_ID = "548330454961-f5van5po0ch1k2eo13sisc34ud4d3sca.apps.googleusercontent.com";
  var SCOPE = "https://www.googleapis.com/auth/drive.file";
  var LS_DOCS = "xplainer_gdoc_docs";

  var els = {};
  var auth = { token: null, expiresAt: 0, client: null, gisLoaded: false };

  function setStatus(text, isError) {
    var el = document.getElementById("editorStatus");
    if (!el) return;
    el.textContent = text || "";
    el.style.color = isError ? "#fca5a5" : "var(--muted)";
  }

  function docMap() {
    try { return JSON.parse(localStorage.getItem(LS_DOCS) || "{}") || {}; } catch (e) { return {}; }
  }
  function rememberDoc(key, id, name) {
    var map = docMap();
    map[key] = { id: id, name: name, when: new Date().toISOString() };
    try { localStorage.setItem(LS_DOCS, JSON.stringify(map)); } catch (e) { /* ignore */ }
  }

  // ---------- title / key derivation ----------

  function deriveTitle(text) {
    var lines = String(text || "").split("\n");
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^:::\s*(?:new_page|title|intro)\s*\(([^)]*)\)/);
      if (m) {
        var t = m[1].match(/(?:title|text)\s*=\s*([^,)]+)/);
        if (t) return cleanTitle(t[1]);
      }
      if (/^:::\s*title\s*$/.test(lines[i])) {
        for (var j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() && !lines[j].startsWith(":::")) return cleanTitle(lines[j]);
          if (lines[j].startsWith(":::")) break;
        }
      }
    }
    for (var k = 0; k < lines.length; k++) {
      var line = lines[k].trim();
      if (line && !line.startsWith(":::") && !line.startsWith("#")) return cleanTitle(line);
      if (line.startsWith("# ")) return cleanTitle(line.slice(2));
    }
    return "xplainer lecture";
  }
  function cleanTitle(s) {
    return String(s).trim().replace(/^["']|["']$/g, "").slice(0, 80) || "xplainer lecture";
  }
  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }

  // ---------- Google auth ----------

  function loadGis() {
    if (auth.gisLoaded) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.onload = function () { auth.gisLoaded = true; resolve(); };
      s.onerror = function () { reject(new Error("Could not load Google sign-in.")); };
      document.head.appendChild(s);
    });
  }

  function getToken(forceNew) {
    if (!forceNew && auth.token && Date.now() < auth.expiresAt - 60000) {
      return Promise.resolve(auth.token);
    }
    return loadGis().then(function () {
      return new Promise(function (resolve, reject) {
        if (!auth.client) {
          auth.client = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: SCOPE,
            callback: function () {},
          });
        }
        auth.client.callback = function (resp) {
          if (resp.error) { reject(new Error("Google sign-in failed: " + resp.error)); return; }
          auth.token = resp.access_token;
          auth.expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
          resolve(auth.token);
        };
        try {
          auth.client.requestAccessToken({ prompt: "" });
        } catch (e) {
          reject(new Error("Google sign-in could not open (popup blocked?)."));
        }
      });
    });
  }

  // ---------- Drive API ----------

  function driveFetch(token, url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ Authorization: "Bearer " + token }, opts.headers || {});
    return fetch(url, opts).then(function (res) {
      if (res.status === 401) { auth.token = null; throw Object.assign(new Error("unauthorized"), { code: 401 }); }
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          var msg = (data.error && data.error.message) || ("Drive error " + res.status);
          throw Object.assign(new Error(msg), { code: res.status });
        });
      }
      return res.status === 204 ? null : res.json();
    });
  }

  function createDoc(token, name, text) {
    var boundary = "xplainer" + Math.random().toString(36).slice(2);
    var body =
      "--" + boundary + "\r\n" +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify({ name: name, mimeType: "application/vnd.google-apps.document" }) + "\r\n" +
      "--" + boundary + "\r\n" +
      "Content-Type: text/plain; charset=UTF-8\r\n\r\n" +
      text + "\r\n" +
      "--" + boundary + "--";
    return driveFetch(token,
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name",
      {
        method: "POST",
        headers: { "Content-Type": 'multipart/related; boundary="' + boundary + '"' },
        body: body,
      });
  }

  function updateDoc(token, id, text) {
    return driveFetch(token,
      "https://www.googleapis.com/upload/drive/v3/files/" + encodeURIComponent(id) + "?uploadType=media&fields=id,name",
      {
        method: "PATCH",
        headers: { "Content-Type": "text/plain; charset=UTF-8" },
        body: text,
      });
  }

  function shareAnyoneViewer(token, id) {
    return driveFetch(token,
      "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id) + "/permissions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      });
  }

  function withToken(fn) {
    return getToken(false).then(fn).catch(function (err) {
      if (err && err.code === 401) return getToken(true).then(fn);
      throw err;
    });
  }

  // ---------- UI ----------

  function injectStyles() {
    var css = [
      ".editor-gdoc-overlay { position:fixed; inset:0; background:rgba(0,0,0,.55);",
      "  display:none; align-items:center; justify-content:center; z-index:10000; }",
      ".editor-gdoc-overlay.visible { display:flex; }",
      ".editor-gdoc-modal { background:#1e293b; color:#e2e8f0; border:1px solid rgba(255,255,255,.12);",
      "  border-radius:10px; padding:18px; width:min(460px, 92vw); font-size:14px;",
      "  box-shadow:0 18px 50px rgba(0,0,0,.5); }",
      ".editor-gdoc-modal h3 { margin:0 0 10px; font-size:15px; }",
      ".editor-gdoc-modal p { margin:6px 0 12px; font-size:12px; color:#94a3b8; line-height:1.5; overflow-wrap:anywhere; }",
      ".editor-gdoc-modal a { color:#7dd3fc; }",
      ".editor-gdoc-modal input { width:100%; box-sizing:border-box; background:#0f172a; color:#e2e8f0;",
      "  border:1px solid rgba(255,255,255,.15); border-radius:6px; padding:6px 8px; font-size:13px; margin:4px 0 10px; }",
      ".editor-gdoc-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:10px; flex-wrap:wrap; }",
    ].join("\n");
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildModal() {
    var overlay = document.createElement("div");
    overlay.className = "editor-gdoc-overlay";
    overlay.innerHTML = '<div class="editor-gdoc-modal" id="gdocModalBody"></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) hideModal();
    });
    els.overlay = overlay;
    els.modalBody = overlay.querySelector("#gdocModalBody");
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

  function playUrlFor(id) {
    return location.origin + location.pathname + "#gdoc-" + id;
  }

  function showSetupHelp() {
    showModal(
      "<h3>Google Doc saving is not configured yet</h3>" +
      "<p>The site owner needs to register this app with Google first: " +
      "create a Google Cloud project, enable the <b>Drive API</b>, create an " +
      "<b>OAuth client ID</b> (web application) with this site's address as an " +
      "authorized JavaScript origin, and paste the client id into " +
      "<code>src/explain_gdoc.js</code> (GOOGLE_CLIENT_ID).</p>" +
      '<div class="editor-gdoc-actions"><button class="editor-btn" id="gdocCloseBtn">Close</button></div>'
    );
    els.modalBody.querySelector("#gdocCloseBtn").addEventListener("click", hideModal);
  }

  function showSaveDialog(text) {
    var title = deriveTitle(text);
    var key = slug(title);
    var existing = docMap()[key];
    var html = "<h3>Save to Google Doc</h3>";
    if (existing) {
      html += "<p>This lecture was saved before as <b>" + esc(existing.name) + "</b>. " +
        "Update that doc (keeps its share link working), or save as a new one.</p>";
    } else {
      html += "<p>Creates a doc in <b>your</b> Google Drive, shared as " +
        "“anyone with the link can view” so the play link works right away.</p>";
    }
    html += "<label>Document name</label><input id='gdocNameInput' value='" + esc(existing ? existing.name : title) + "' />";
    html += '<div class="editor-gdoc-actions">';
    if (existing) html += '<button class="editor-btn" id="gdocUpdateBtn">Update</button>';
    html += '<button class="editor-btn" id="gdocCreateBtn">' + (existing ? "Save as new" : "Create") + "</button>";
    html += '<button class="editor-btn" id="gdocCancelBtn">Cancel</button></div>';
    showModal(html);

    els.modalBody.querySelector("#gdocCancelBtn").addEventListener("click", hideModal);
    els.modalBody.querySelector("#gdocCreateBtn").addEventListener("click", function () {
      runCreate(key, els.modalBody.querySelector("#gdocNameInput").value.trim() || title, text);
    });
    if (existing) {
      els.modalBody.querySelector("#gdocUpdateBtn").addEventListener("click", function () {
        runUpdate(key, existing, text);
      });
    }
  }

  function showResult(name, id, updated) {
    var play = playUrlFor(id);
    var docUrl = "https://docs.google.com/document/d/" + id + "/edit";
    showModal(
      "<h3>" + (updated ? "Updated" : "Saved") + ": " + esc(name) + "</h3>" +
      '<p>Play link (share this):<br/><a href="' + esc(play) + '" target="_blank" rel="noopener">' + esc(play) + "</a></p>" +
      '<p>Edit / collaborate in Google Docs:<br/><a href="' + esc(docUrl) + '" target="_blank" rel="noopener">' + esc(docUrl) + "</a></p>" +
      "<p>Tip: in Docs, turn off Tools → Preferences → “Use smart quotes” before " +
      "hand-editing — the player normalizes quotes on load, but it keeps the doc clean.</p>" +
      '<div class="editor-gdoc-actions">' +
      '<button class="editor-btn" id="gdocCopyBtn">Copy play link</button>' +
      '<button class="editor-btn" id="gdocDoneBtn">Done</button></div>'
    );
    els.modalBody.querySelector("#gdocDoneBtn").addEventListener("click", hideModal);
    els.modalBody.querySelector("#gdocCopyBtn").addEventListener("click", function () {
      navigator.clipboard.writeText(play).then(function () {
        setStatus("Play link copied.");
      }, function () {
        setStatus("Could not copy — select the link manually.", true);
      });
    });
  }

  function runCreate(key, name, text) {
    setStatus("Saving to Google Drive…");
    hideModal();
    withToken(function (token) {
      return createDoc(token, name, text).then(function (file) {
        return shareAnyoneViewer(token, file.id).then(function () { return file; });
      });
    }).then(function (file) {
      rememberDoc(key, file.id, file.name || name);
      setStatus("Saved to your Google Drive.");
      showResult(file.name || name, file.id, false);
    }).catch(function (err) {
      setStatus("Google Doc save failed: " + err.message, true);
    });
  }

  function runUpdate(key, existing, text) {
    setStatus("Updating Google Doc…");
    hideModal();
    withToken(function (token) {
      return updateDoc(token, existing.id, text);
    }).then(function () {
      rememberDoc(key, existing.id, existing.name);
      setStatus("Google Doc updated.");
      showResult(existing.name, existing.id, true);
    }).catch(function (err) {
      if (err.code === 404 || err.code === 403) {
        setStatus("That doc is gone or not editable by this app — saving as new.", true);
        runCreate(key, existing.name, text);
        return;
      }
      setStatus("Google Doc update failed: " + err.message, true);
    });
  }

  function onSaveClick() {
    var textarea = document.getElementById("editorTextarea");
    var text = textarea ? textarea.value : "";
    if (!text.trim()) {
      setStatus("Nothing to save — the editor is empty.", true);
      return;
    }
    if (!GOOGLE_CLIENT_ID) { showSetupHelp(); return; }
    showSaveDialog(text);
  }

  function init() {
    var pane = document.getElementById("editorPane");
    var actions = pane && pane.querySelector(".editor-actions");
    if (!actions) return;
    injectStyles();
    buildModal();
    var btn = document.createElement("button");
    btn.id = "editorGdocBtn";
    btn.className = "editor-btn";
    btn.textContent = "Doc";
    btn.title = "Save to a Google Doc in your Drive (shareable play link)";
    btn.addEventListener("click", onSaveClick);
    actions.appendChild(btn);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
