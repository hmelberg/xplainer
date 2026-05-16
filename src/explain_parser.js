/* ---------------- Text parser to lecture JSON ---------------- */

function parseArgs(argText = "") {
  const args = {};
  const positional = [];
  const text = argText.trim();
  if (!text) return args;
  const parts = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ((ch === '"' || ch === "'") && (i === 0 || text[i - 1] !== "\\")) {
      if (!inQuote) {
        inQuote = true;
        quoteChar = ch;
      } else if (quoteChar === ch) {
        inQuote = false;
        quoteChar = "";
      }
    }
    if (ch === "," && !inQuote) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  const parseValue = (raw) => {
    const v = String(raw ?? "").trim().replace(/^['"]|['"]$/g, "");
    if (v === "true") return true;
    if (v === "false") return false;
    if (!Number.isNaN(Number(v)) && v !== "") return Number(v);
    return v;
  };
  parts.forEach((part) => {
    const seg = String(part || "").trim();
    if (!seg) return;
    const eqIdx = seg.indexOf("=");
    if (eqIdx === -1) {
      positional.push(parseValue(seg));
      return;
    }
    const key = seg.slice(0, eqIdx).trim();
    if (!key) return;
    const rawVal = seg.slice(eqIdx + 1).trim();
    if (rawVal === "") {
      args[key] = true;
      return;
    }
    args[key] = parseValue(rawVal);
  });
  if (positional.length) args.__positional = positional;
  return args;
}

function inferBlockType(content = "") {
  const text = content.trim();
  if (!text) return "write";
  const head = text.split("\n")[0].trim();
  if (/^(flowchart|sequenceDiagram|graph|gantt|classDiagram|stateDiagram)/i.test(head)) return "mermaid";
  if (/(function\s+setup|function\s+draw|createCanvas\s*\()/i.test(text)) return "p5";
  if (/(import\s+\w+|def\s+\w+|print\s*\(|plt\.)/i.test(text)) return "pyodide";
  if (/(<-|library\s*\(|ggplot\s*\(|tibble\s*\()/i.test(text)) return "webr";
  return "write_speak";
}

function splitArgsList(text = "") {
  const parts = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ((ch === '"' || ch === "'") && (i === 0 || text[i - 1] !== "\\")) {
      if (!inQuote) {
        inQuote = true;
        quoteChar = ch;
      } else if (quoteChar === ch) {
        inQuote = false;
        quoteChar = "";
      }
    }
    if (ch === "," && !inQuote) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.map((part) => {
    const v = part.replace(/^['"]|['"]$/g, "");
    if (v === "true") return true;
    if (v === "false") return false;
    if (!Number.isNaN(Number(v)) && v !== "") return Number(v);
    return v;
  });
}

// State-machine tokenizer for the suffix of a draw command line. Respects
// double/single quoted values so that key="long text, with commas" stays a
// single token. Bare flags (key with no = ) come back as [key, true].
function tokenizeDrawArgs(src) {
  const s = String(src || "");
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
    if (i >= s.length) break;
    const keyStart = i;
    while (i < s.length && s[i] !== "=" && !/[\s,]/.test(s[i])) i++;
    if (i === keyStart) { i++; continue; }
    const key = s.slice(keyStart, i);
    if (s[i] !== "=") {
      out.push([key, true]);
      continue;
    }
    i++; // consume =
    let value;
    if (s[i] === '"' || s[i] === "'") {
      const quote = s[i];
      i++;
      let v = "";
      while (i < s.length && s[i] !== quote) {
        if (s[i] === "\\" && i + 1 < s.length) { v += s[i + 1]; i += 2; continue; }
        v += s[i++];
      }
      if (i < s.length) i++; // consume closing quote
      value = v;
    } else {
      const vStart = i;
      while (i < s.length && !/[\s,]/.test(s[i])) i++;
      value = s.slice(vStart, i);
    }
    out.push([key, value]);
  }
  return out;
}

function coerceDrawArgValue(v) {
  if (v === true) return true;
  if (v === "true") return true;
  if (v === "false") return false;
  if (v !== "" && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

function parseDrawLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj && !obj.cmd && obj.type) {
        obj.cmd = obj.type;
        delete obj.type;
      }
      return { type: "draw", ...obj };
    } catch {
      return null;
    }
  }
  const funcMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*\((.*)\)\s*(.*)$/);
  if (funcMatch) {
    const cmd = funcMatch[1];
    const argList = splitArgsList(funcMatch[2] || "");
    const rest = funcMatch[3] || "";
    const args = {};
    if (cmd === "line" && argList.length >= 4) {
      [args.x1, args.y1, args.x2, args.y2] = argList;
    } else if (cmd === "circle" && argList.length >= 3) {
      [args.cx, args.cy, args.r] = argList;
    } else if (cmd === "rect" && argList.length >= 4) {
      [args.x, args.y, args.width, args.height] = argList;
    } else if (cmd === "ellipse" && argList.length >= 4) {
      [args.cx, args.cy, args.rx, args.ry] = argList;
    } else if (cmd === "text" && argList.length >= 3) {
      [args.x, args.y, args.text] = argList;
    } else if (cmd === "polygon" && argList.length >= 6) {
      const pts = [];
      for (let i = 0; i < argList.length; i += 2) {
        if (argList[i + 1] === undefined) break;
        pts.push([Number(argList[i]), Number(argList[i + 1])]);
      }
      args.points = pts;
    } else if (cmd === "path" && argList.length >= 1) {
      args.d = String(argList[0]);
    }
    if (rest) {
      for (const [k, v] of tokenizeDrawArgs(rest)) {
        args[k] = coerceDrawArgValue(v);
      }
    }
    return { type: "draw", cmd, ...args };
  }
  // Fallback: non-parenthesized form, e.g. `text x=10 y=20 speak="hi"`.
  const firstSpace = trimmed.search(/\s/);
  const cmd = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const rest = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1);
  const args = {};
  for (const [k, v] of tokenizeDrawArgs(rest)) {
    args[k] = coerceDrawArgValue(v);
  }
  return { type: "draw", cmd, ...args };
}

function parseDrawLines(content = "") {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  const out = [];
  lines.forEach((line) => {
    const cmd = parseDrawLine(line);
    if (cmd) out.push(cmd);
  });
  return out;
}

function parseQuestionBlock(content = "") {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  const prompt = lines.shift() || "";
  const choices = [];
  const correct = [];
  lines.forEach((line) => {
    const isCorrect = line.startsWith("*");
    const clean = line.replace(/^[-*]\s?/, "");
    if (clean) {
      if (isCorrect) correct.push(choices.length);
      choices.push(clean);
    }
  });
  return { markdown: prompt, choices, correct_indices: correct };
}

// Components that use "first line = prompt, rest = list" (same as question block).
// Parsed content is merged into the action; header args override.
const COMPONENT_PROMPT_LIST = {
  "ui-poll": (parsed) => ({ question: parsed.markdown, options: parsed.choices }),
  "ui-multiple-choice": (parsed) => ({
    question: parsed.markdown,
    options: parsed.choices,
    correct_indices: parsed.correct_indices,
  }),
};

function parseMarkdownTable(content = "") {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const sepIdx = lines.findIndex((line) => /\|?\s*:?-{3,}:?\s*\|/.test(line));
  if (sepIdx <= 0) return null;
  const headerLine = lines[sepIdx - 1];
  const bodyLines = lines.slice(sepIdx + 1);
  const parseRow = (line) => {
    const trimmed = line.replace(/^\||\|$/g, "");
    return trimmed.split("|").map((cell) => cell.trim());
  };
  const headers = parseRow(headerLine);
  const rows = bodyLines.map(parseRow).filter((row) => row.some((cell) => cell !== ""));
  return { headers, rows };
}

function parseCsvLine(line = "") {
  const out = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (ch === "," && !inQuote) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

function parseCsvTable(content = "") {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(parseCsvLine).filter((row) => row.some((cell) => cell !== ""));
  return { headers, rows };
}

function normalizePresetKey(key = "") {
  const raw = String(key || "").trim();
  if (!raw) return "";
  if (raw === "lang") return "speech_lang";
  if (raw === "voice") return "speech_voice";
  if (raw === "rate") return "speech_rate";
  return raw;
}

function parseNamesBlock(content = "") {
  const out = {};
  const lines = String(content || "").split("\n");
  lines.forEach((lineRaw) => {
    const line = String(lineRaw || "").trim();
    if (!line || line.startsWith("#")) return;
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) return;
    const name = line.slice(0, colonIdx).trim();
    if (!name) return;
    const rhs = line.slice(colonIdx + 1).trim();
    if (!rhs) return;
    const parsed = parseArgs(rhs);
    const clean = {};
    Object.entries(parsed).forEach(([k, v]) => {
      if (k === "__positional") return;
      const nk = normalizePresetKey(k);
      if (!nk) return;
      clean[nk] = v;
    });
    if (!Object.keys(clean).length) return;
    out[name] = { ...(out[name] || {}), ...clean };
  });
  return out;
}

function parseLectureText(text = "") {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let current = null;

  const pushCurrent = () => {
    if (!current) return;
    const hasContent = current.content && current.content.some((l) => l.trim() !== "");
    if (current.name || hasContent) {
      blocks.push(current);
    }
    current = null;
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith(":::")) {
      pushCurrent();
      const header = trimmed.replace(/^:::+/, "").trim();
      let name = "";
      let args = {};
      if (header) {
        const match = header.match(/^([a-zA-Z0-9_.-]+)\s*(?:\((.*)\))?$/);
        if (match) {
          name = match[1];
          args = parseArgs(match[2] || "");
        } else {
          name = header.split(/\s+/)[0];
        }
      }
      current = { name, args, content: [], header };
    } else {
      if (!current) current = { name: "", args: {}, content: [] };
      current.content.push(line);
    }
  });
  pushCurrent();

  const defaults = {};
  const commands = [];

  blocks.forEach((blk) => {
    const content = (blk.content || []).join("\n").trim();
    let type = blk.name || inferBlockType(content);
    if (type === "py") type = "python"; // alias
    if (type === "bpy") type = "brython"; // alias
    if (type === "python") type = "pyodide";
    if (type === "r") type = "webr";
    const rawArgs = blk.args || {};
    const positionalArgs = Array.isArray(rawArgs.__positional) ? rawArgs.__positional : [];
    const args = { ...rawArgs };
    delete args.__positional;

    if (type === "defaults") {
      Object.assign(defaults, args);
      if (content) {
        content.split("\n").forEach((line) => {
          const [k, ...vparts] = line.split("=");
          if (!k) return;
          const v = vparts.join("=").trim();
          if (!v) return;
          defaults[k.trim()] = parseArgs(`x=${v}`).x;
        });
      }
      return;
    }

    if (type === "names" || type === "presets") {
      const parsedNames = parseNamesBlock(content);
      if (Object.keys(parsedNames).length) {
        const existing = (defaults.speech_tags && typeof defaults.speech_tags === "object")
          ? defaults.speech_tags
          : {};
        defaults.speech_tags = { ...existing, ...parsedNames };
      }
      return;
    }

    if (type === "web_defaults") {
      const mappings = {};
      if (content) {
        content.split("\n").forEach((line) => {
          const eq = line.indexOf("=");
          if (eq === -1) return;
          const tag = line.slice(0, eq).trim();
          const attr = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
          if (tag && attr) mappings[tag] = attr;
        });
      }
      Object.assign(mappings, args);
      commands.push({ type: "web_defaults", mappings });
      return;
    }

    if (type === "new_page") {
      commands.push({ type: "new_page", title: args.title || content || "" });
      return;
    }

    if (type === "title") {
      commands.push({ type: "title", title: args.title || content || "", ...args });
      return;
    }

    if (type === "wait") {
      commands.push({ type: "wait", ...args, label: args.label || content || undefined });
      return;
    }

    if (type === "mark") {
      const positionalText = positionalArgs.length ? String(positionalArgs[0]) : "";
      const payload = {
        type: "mark",
        index: args.index ?? -1,
        id: args.id,
        target: args.type ?? args.target,
        text: args.text ?? args.code_text ?? positionalText,
        code_text: args.code_text ?? args.text ?? positionalText,
        temporary: args.temporary !== false && args.permanent !== true,
        permanent: args.permanent === true,
        speak: args.speak,
        duration: args.duration ?? args.seconds,
        effect: args.effect,
        color: args.color,
        line: args.line,
        line_start: args.line_start,
        line_end: args.line_end,
        regex: args.regex,
        occurrence: args.occurrence,
        all: args.all,
        case_sensitive: args.case_sensitive,
        ...args,
      };
      if (content && !payload.text && !payload.code_text) payload.text = content;
      commands.push(payload);
      return;
    }

    if (type === "highlight") {
      const positionalText = positionalArgs.length ? String(positionalArgs[0]) : "";
      const payload = {
        type: "mark",
        target: "code",
        index: args.index ?? -1,
        id: args.id,
        temporary: args.temporary !== false && args.permanent !== true,
        permanent: args.permanent === true,
        text: args.text ?? positionalText,
        code_text: args.code_text ?? positionalText,
        ...args,
      };
      if (content && !payload.code_text && !payload.text) payload.text = content;
      commands.push(payload);
      return;
    }

    if (type === "dim" || type === "no_dim") {
      const payload = { type, ...args };
      if (content && payload.index === undefined && payload.slice === undefined && payload.range === undefined) {
        payload.index = content;
      }
      commands.push(payload);
      return;
    }

    if (type === "annotate_table") {
      const positionalText = positionalArgs.length ? String(positionalArgs[0]) : "";
      const payload = {
        type: "mark",
        target: "table",
        index: args.index ?? -1,
        id: args.id,
        temporary: args.temporary !== false && args.permanent !== true,
        permanent: args.permanent === true,
        text: args.text ?? positionalText,
        ...args,
      };
      if (content && !payload.text) payload.text = content;
      commands.push(payload);
      return;
    }

    if (type === "speak") {
      commands.push({ type: "speak", text: content, ...args });
      return;
    }

    // Comment blocks are intentionally ignored.
    // Supported aliases:
    //   ::: comment
    //   ::: ignore
    if (type === "comment" || type === "ignore") {
      return;
    }

    if (type === "math") {
      commands.push({ type: "math", text: content, ...args });
      return;
    }

    if (type === "message") {
      commands.push({ type: "message", text: content, ...args });
      return;
    }

    if (type === "xplainer_link" || type === "tutorial_link") { // tutorial_link is a deprecated alias
      const lines = content.split("\n").map((s) => s.trim()).filter(Boolean);
      const first = lines[0] || "";
      const second = lines[1] || "";
      const url = args.url || args.href || args.src || first;
      const text = args.text || args.title || second || first || url || "Open explainer";
      commands.push({ type: "xplainer_link", url, text, ...args });
      return;
    }

    if (type === "link") {
      const lines = content.split("\n").map((s) => s.trim()).filter(Boolean);
      let href = args.url || args.href || args.src || (lines[0] || "");
      const text = args.text || args.title || (lines[1] || lines[0] || href || "Open link");
      if (href && !/^(https?:|\/|#)/.test(href)) {
        href = "https://" + href;
      }
      commands.push({ type: "link", href, text, ...args });
      return;
    }

    if (type === "write" || type === "write_speak") {
      commands.push({ type, markdown: content, ...args });
      return;
    }

    if (type === "image" || type === "img") {
      const src = args.src || args.url || args.href || content || "";
      commands.push({ type: "image", src, ...args });
      return;
    }

    if (type === "mark_image" || type === "annotate_image") {
      const positionalText = positionalArgs.length ? String(positionalArgs[0]) : "";
      const payload = {
        type: "mark_image",
        index: args.index ?? -1,
        id: args.id,
        text: args.text ?? positionalText,
        duration: args.duration ?? args.seconds,
        temporary: args.temporary !== false && args.permanent !== true,
        permanent: args.permanent === true,
        ...args,
      };
      if (content && !payload.text) payload.text = content;
      commands.push(payload);
      return;
    }

    if (type === "draw") {
      const drawCmds = parseDrawLines(content);
      drawCmds.forEach((cmd) => commands.push({ ...cmd, ...args }));
      return;
    }

    if (type === "multiple_choice") {
      const q = parseQuestionBlock(content);
      commands.push({ type: "question", ...q, ...args });
      return;
    }

    if (type === "question") {
      const hasQaArgs = args.question || args.answer || args.hint || args.gif || args.gif_src || args.gif_url;
      if (!hasQaArgs && content) {
        const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
        if (lines.length === 2) {
          commands.push({ type: "question", question: lines[0], answer: lines[1], ...args });
          return;
        }
        if (lines.length >= 3 && !lines.some((l) => l.startsWith("-") || l.startsWith("*"))) {
          commands.push({ type: "question", question: lines[0], answer: lines.slice(1), ...args });
          return;
        }
        const q = parseQuestionBlock(content);
        commands.push({ type: "question", ...q, ...args });
        return;
      }
      const payload = {
        type: "question",
        question: args.question || content || "",
        answer: args.answer,
        hint: args.hint,
        gif: args.gif,
        gif_src: args.gif_src || args.gif_url || (typeof args.gif === "string" ? args.gif : undefined),
        ...args,
      };
      commands.push(payload);
      return;
    }

    if (type === "flashcard" || type === "flash_card" || type === "flash-card") {
      const contentStr = (content || "").trim();
      const lines = contentStr ? contentStr.split("\n").map((l) => l.trim()).filter(Boolean) : [];

      function makeCardFromLines(cardLines) {
        if (!cardLines || cardLines.length === 0) return null;
        const front = cardLines[0] || "";
        const backLine = cardLines.length > 1 ? cardLines[1] : "";
        const extra = cardLines.length > 2 ? cardLines.slice(2).join("\n") : "";
        const back = extra ? [backLine, extra].filter(Boolean).join("\n") : backLine;
        return { front, back };
      }

      let cards = [];

      if (lines.length) {
        const segments = [];
        let current = [];
        for (const line of lines) {
          if (/^---+\s*$/.test(line)) {
            if (current.length) {
              segments.push(current);
              current = [];
            }
          } else {
            current.push(line);
          }
        }
        if (current.length) segments.push(current);
        if (segments.length === 0) segments.push(lines);
        cards = segments.map((seg) => makeCardFromLines(seg)).filter(Boolean);
      } else if (args.front != null || args.back != null) {
        cards = [
          {
            front: args.front != null ? String(args.front) : "",
            back: args.back != null ? String(args.back) : "",
          },
        ];
      }

      if (cards.length === 0) {
        commands.push({ type: "write_speak", markdown: content, ...args });
        return;
      }

      const flashArgs = { ...args };
      delete flashArgs.__positional;

      const first = cards[0];
      const payload = {
        type: "component",
        tag: "ui-flashcard",
        cards,
        front: first.front,
        back: first.back,
        // Default: flashcards pause progression until user interacts.
        pause_on_click: flashArgs.pause_on_click !== undefined ? !!flashArgs.pause_on_click : true,
        ...flashArgs,
      };

      commands.push(payload);
      return;
    }

    if (type === "table") {
      const parsed = parseMarkdownTable(content);
      if (parsed) {
        commands.push({ type: "table", headers: parsed.headers, rows: parsed.rows, ...args });
        return;
      }
      commands.push({ type: "table", headers: [], rows: [], ...args });
      return;
    }

    if (type === "pyodide" || type === "webr" || type === "p5" || type === "mermaid" || type === "js" || type === "brython") {
      commands.push({ type, code: content, ...args });
      return;
    }

    // chart-NAME (e.g. chart-line, chart-bar) → comp comp-chart-data(type=NAME) with same body and kwargs
    const chartNameMatch = typeof type === "string" && type.match(/^chart-(.+)$/);
    if (chartNameMatch) {
      const chartType = chartNameMatch[1];
      const webArgs = { ...args, type: chartType };
      delete webArgs.__positional;
      const contentStr = content && String(content).trim();
      const payload = { type: "comp", tag: "comp-chart-data", ...webArgs };
      if (contentStr) {
        payload.content = contentStr;
        payload._bodyText = contentStr;
        payload.into = "content";
      }
      commands.push(payload);
      return;
    }

    // comp / component (::: comp TAG or ::: component TAG). "web" accepted for backward compatibility only.
    if (type === "comp" || type === "component" || type === "web") {
      const headerAfterColons = (blk.header || "").replace(/^:::+/, "").trim();
      const rest = headerAfterColons.replace(/^(comp|component|web)\s+/, "").trim();
      let tag = "";
      let webArgs = { ...args };
      if (rest) {
        const webMatch = rest.match(/^([a-zA-Z0-9_.-]+)\s*(?:\((.*)\))?$/);
        if (webMatch) {
          tag = webMatch[1];
          if (webMatch[2] !== undefined) webArgs = parseArgs(webMatch[2] || "");
        } else {
          tag = rest.split(/\s+/)[0] || "";
        }
      }
      if (tag === "chart-data") tag = "comp-chart-data";
      else if (tag === "web-mermaid") tag = "comp-mermaid";
      const positionals = Array.isArray(webArgs.__positional) ? webArgs.__positional : [];
      delete webArgs.__positional;
      const hasInto = "into" in webArgs || positionals.includes("into");
      const contentStr = content && String(content).trim();
      if (contentStr && hasInto) {
        const intoVal = webArgs.into;
        webArgs.into = typeof intoVal === "string" && intoVal.trim() !== "" ? String(intoVal).trim() : "content";
        webArgs._bodyText = contentStr;
      }
      const payload = { type: "comp", tag, ...webArgs };
      if (contentStr) {
        payload.content = contentStr;
        payload._bodyText = payload._bodyText ?? contentStr;
        if (tag === "comp-chart" && !hasInto) {
          payload.into = "config";
          payload._bodyText = contentStr;
        }
        if (tag === "comp-chart-data" && !hasInto) {
          payload.into = "content";
          payload._bodyText = contentStr;
        }
      }
      if (typeof window !== "undefined" && (tag === "comp-chart" || window.__explainLogWeb)) {
        console.log("[explain parser] comp block", { tag, contentLen: contentStr ? contentStr.length : 0, hasInto: !!payload.into });
      }
      commands.push(payload);
      return;
    }

    if (type === "webcomponent") {
      const headerAfterColons = (blk.header || "").replace(/^:::+/, "").trim();
      const rest = headerAfterColons.startsWith("webcomponent ") ? headerAfterColons.slice(13).trim() : "";
      let tag = "";
      let wcArgs = { ...args };
      if (rest) {
        const wcMatch = rest.match(/^([a-zA-Z0-9_.-]+)\s*(?:\((.*)\))?$/);
        if (wcMatch) {
          tag = wcMatch[1];
          if (wcMatch[2] !== undefined) wcArgs = parseArgs(wcMatch[2] || "");
        } else {
          tag = rest.split(/\s+/)[0] || "";
        }
      }
      const positionals = Array.isArray(wcArgs.__positional) ? wcArgs.__positional : [];
      delete wcArgs.__positional;
      const urlFromPositional = positionals.length === 1 && typeof positionals[0] === "string" && /^https?:\/\//i.test(positionals[0]) ? positionals[0] : null;
      const scriptUrl = wcArgs.script ?? wcArgs.url ?? urlFromPositional;
      commands.push({
        type: "webcomponent",
        tag,
        script: scriptUrl,
        lang: wcArgs.lang ?? "js",
        shadow: wcArgs.shadow !== false,
        body_attr: wcArgs.body_attr ?? "content",
        code: content,
        ...wcArgs,
      });
      return;
    }

    if (type === "html") {
      const allowHtml = args.allow_html ?? true;
      commands.push({ type: "html", html: content, ...args, allow_html: allowHtml });
      return;
    }

    if (type === "svg") {
      commands.push({ type: "svg", svg: content, ...args });
      return;
    }

    if (type === "pdf") {
      const src = args.src || content || "";
      commands.push({ type: "pdf", src, ...args });
      return;
    }

    if (type === "accordion") {
      const items = [];
      if (args.title != null || args.markdown != null || args.text != null) {
        const body = args.markdown ?? args.text ?? (content ? content.trim() : null);
        items.push({
          title: args.title ?? "Details",
          ...(args.markdown != null || (body && args.text == null) ? { markdown: body } : {}),
          ...(args.text != null ? { text: body } : {}),
          open: args.open === true,
        });
      }
      if (items.length === 0 && content) {
        const lines = content.split("\n");
        let currentTitle = "Details";
        let currentBody = [];
        for (const line of lines) {
          const heading = line.match(/^##\s+(.+)$/);
          if (heading) {
            if (currentBody.length > 0 || currentTitle !== "Details") {
              items.push({
                title: currentTitle,
                markdown: currentBody.join("\n").trim() || null,
                open: false,
              });
            }
            currentTitle = heading[1].trim();
            currentBody = [];
          } else {
            currentBody.push(line);
          }
        }
        if (currentTitle || currentBody.length > 0) {
          items.push({
            title: currentTitle,
            markdown: currentBody.join("\n").trim() || null,
            open: false,
          });
        }
      }
      if (items.length === 0) items.push({ title: "Details", markdown: null });
      commands.push({ type: "accordion", items, ...args });
      return;
    }

    // ui.COMPONENT_NAME(...) or py.COMPONENT_NAME(...) — (args/kwargs optional)
    if (type.startsWith("ui.") || type.startsWith("py.")) {
      const prefix = type.startsWith("py.") ? "py" : "ui";
      const name = type.slice(prefix.length + 1);
      const tag = prefix + "-" + name.replace(/_/g, "-");
      const payload = { type: "component", tag, ...args };
      const promptListFn = COMPONENT_PROMPT_LIST[tag];
      if (promptListFn && content.trim()) {
        const parsed = parseQuestionBlock(content);
        Object.assign(payload, promptListFn(parsed));
      } else if (content) {
        payload.content = content;
      }
      commands.push(payload);
      return;
    }

    // Registry passthrough: if a handler has been registered in Xplainer.actions
    // (see src/player/core.js), emit the block with its original type + args so
    // the registered handler in explain_player.js's runAction can dispatch it.
    // This is how new block types like :::celebrate, :::sound, :::countdown,
    // :::reveal, :::intro become first-class without touching the parser for each.
    if (typeof window !== "undefined" && window.Xplainer && window.Xplainer.actions && window.Xplainer.actions.has(type)) {
      const payload = { type, ...args };
      if (content !== undefined && content !== null && String(content).trim() !== "") {
        payload.content = content;
        payload._bodyText = content;
      }
      commands.push(payload);
      return;
    }

    commands.push({ type: "write_speak", markdown: content, ...args });
  });

  return { defaults, commands };
}

window.parseLectureText = parseLectureText;
