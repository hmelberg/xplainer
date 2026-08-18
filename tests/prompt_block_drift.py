"""Drift check: the AI generation prompt must know the app's block vocabulary.

Compares three sources:
  1. Parser-native block types  (explain_parser.js:  type === "...")
  2. Registry-registered blocks (src/player/handlers/*.js: actions.register("..."))
  3. Blocks documented in the prompt's reference table
     (src/explain_prompt_generate.txt: markdown table rows)

Fails when the app has an author-facing block the prompt doesn't document,
or the prompt documents a block the app doesn't have. Run:
    python3 tests/prompt_block_drift.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARSER = ROOT / "src" / "explain_parser.js"
HANDLERS_DIR = ROOT / "src" / "player" / "handlers"
PROMPT = ROOT / "src" / "explain_prompt_generate.txt"

# Not author-facing (internal, dev-only, or deprecated/alias forms the prompt
# deliberately teaches under a single canonical name instead).
EXCLUDE = {
    "comment", "ignore",              # authoring utilities, not lecture content
    "pyodide_preload", "p5_control",  # internal engine plumbing
    "new_drawing",                    # draw-content line, not a block
    "myblock",                        # registration example
    "flash_card", "flash-card",       # aliases of flashcard
    "bpy", "py",                      # aliases of brython / python
    "pyodide", "webr",                # internal canonical names for python / r
    "comp", "web",                    # aliases of component
    "image",                          # alias of img
    "names", "presets", "web_defaults",  # power features, kept out of the prompt
    "xplainer_link", "tutorial_link",    # deprecated; prompt teaches `link`
}

# Dynamic families: any prompt token matching these prefixes is valid.
DYNAMIC_PREFIXES = ("ui.", "py.", "chart-")


def parser_types():
    src = PARSER.read_text(encoding="utf-8")
    return set(re.findall(r'(?<!typeof )type ===? "([a-z_0-9-]+)"', src))


def registry_types():
    found = set()
    for f in HANDLERS_DIR.glob("*.js"):
        found |= set(re.findall(r'actions\.register\("([a-z_0-9.-]+)"', f.read_text(encoding="utf-8")))
    return found


def prompt_types():
    if not PROMPT.exists():
        print(f"FAIL: prompt file missing: {PROMPT}")
        sys.exit(1)
    src = PROMPT.read_text(encoding="utf-8")
    found = set()
    # Table rows: first cell may hold several names ("write / write_speak").
    for row in re.findall(r"^\| ([a-zA-Z_0-9 ./*-]+) \|", src, flags=re.M):
        for name in row.split("/"):
            name = name.strip().rstrip("*")
            if name and not name.startswith("-") and name.lower() != "block":
                found.add(name)
    return found


def is_dynamic(name):
    return any(name.startswith(p) for p in DYNAMIC_PREFIXES)


def main():
    app = (parser_types() | registry_types()) - EXCLUDE
    prompt = prompt_types()

    missing_in_prompt = sorted(n for n in app if n not in prompt and not is_dynamic(n))
    unknown_in_prompt = sorted(
        n for n in prompt if n not in app and not is_dynamic(n) and n not in EXCLUDE
    )

    ok = True
    if missing_in_prompt:
        ok = False
        print("FAIL: app blocks missing from the prompt's reference table:")
        for n in missing_in_prompt:
            print(f"  - {n}")
    if unknown_in_prompt:
        ok = False
        print("FAIL: prompt documents blocks the app does not have:")
        for n in unknown_in_prompt:
            print(f"  - {n}")
    if ok:
        print(f"OK: prompt covers all {len(app)} author-facing blocks, no strays.")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
