"""Quick balanced-delimiter check for the new player modules. Not a real JS
parser — just catches blatantly broken braces/parens/brackets. Remove this file
once we have a proper test harness.
"""
import re
import sys
from pathlib import Path


def strip_strings_and_comments(src: str) -> str:
    out = []
    i = 0
    n = len(src)
    # Track whether a `/` can begin a regex literal. Heuristic: after certain
    # tokens (operators, keywords, punctuation), `/` is a regex; after an
    # identifier/number/), it's division.
    # This mirrors the standard JS lexer disambiguation.
    regex_allowed_prev = set("(,=:[!&|?{};\n^~<>%*+-")
    prev_nonspace = ""
    regex_allowed_keywords = {"return", "typeof", "instanceof", "in", "of", "new", "delete", "throw", "void", "yield", "await", "case", "if", "else", "do", "while"}

    def can_regex():
        if not prev_nonspace:
            return True
        if prev_nonspace[-1] in regex_allowed_prev:
            return True
        # check trailing word
        j = len(prev_nonspace) - 1
        while j >= 0 and (prev_nonspace[j].isalnum() or prev_nonspace[j] == "_"):
            j -= 1
        word = prev_nonspace[j + 1:]
        if word in regex_allowed_keywords:
            return True
        return False

    while i < n:
        ch = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        # block comment
        if ch == "/" and nxt == "*":
            end = src.find("*/", i + 2)
            if end == -1:
                return "".join(out)
            # preserve newlines for line counting
            out.append("\n" * src[i:end + 2].count("\n"))
            i = end + 2
            continue
        # line comment
        if ch == "/" and nxt == "/":
            end = src.find("\n", i + 2)
            if end == -1:
                return "".join(out)
            i = end
            continue
        # regex literal
        if ch == "/" and can_regex():
            j = i + 1
            in_class = False
            while j < n:
                c = src[j]
                if c == "\\":
                    j += 2
                    continue
                if c == "\n":
                    break  # not a regex
                if c == "[":
                    in_class = True
                elif c == "]":
                    in_class = False
                elif c == "/" and not in_class:
                    j += 1
                    # skip flags
                    while j < n and src[j].isalpha():
                        j += 1
                    out.append("/x/")
                    i = j
                    prev_nonspace = "/"  # behave like an expression
                    break
                j += 1
            else:
                # incomplete regex — treat as division, fall through
                pass
            if out and out[-1] == "/x/":
                continue
        # template literal
        if ch == "`":
            start = i
            i += 1
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == "`":
                    i += 1
                    break
                if src[i] == "$" and i + 1 < n and src[i + 1] == "{":
                    depth = 1
                    i += 2
                    while i < n and depth > 0:
                        if src[i] == "{":
                            depth += 1
                        elif src[i] == "}":
                            depth -= 1
                        i += 1
                    continue
                i += 1
            # preserve newlines for line counting
            out.append("\n" * src[start:i].count("\n"))
            prev_nonspace = "`"
            continue
        # single/double quote string
        if ch == "'" or ch == '"':
            quote = ch
            start = i
            i += 1
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == quote:
                    i += 1
                    break
                if src[i] == "\n":
                    out.append("\n")
                i += 1
            # keep a marker char so `can_regex()` sees non-regex-allowed prev
            out.append('""')
            prev_nonspace = '"'
            continue
        out.append(ch)
        if not ch.isspace():
            prev_nonspace = (prev_nonspace + ch)[-32:]
        i += 1
    return "".join(out)


def check(path: Path) -> list[str]:
    src = path.read_text(encoding="utf-8")
    stripped = strip_strings_and_comments(src)
    pairs = {")": "(", "]": "[", "}": "{"}
    stack: list[tuple[str, int]] = []
    line = 1
    errs: list[str] = []
    for ch in stripped:
        if ch == "\n":
            line += 1
        if ch in "([{":
            stack.append((ch, line))
        elif ch in ")]}":
            if not stack or stack[-1][0] != pairs[ch]:
                errs.append(f"MISMATCH line ~{line}: unexpected {ch!r}; top of stack={stack[-3:]}")
                return errs
            stack.pop()
    if stack:
        errs.append(f"UNCLOSED: {stack[-5:]}")
    return errs


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    files = [
        root / "components" / "ui-intro.js",
        root / "src" / "player" / "core.js",
        root / "src" / "player" / "engines" / "base.js",
        root / "src" / "player" / "transitions.js",
        root / "src" / "player" / "handlers" / "fx.js",
    ]
    rc = 0
    for p in files:
        errs = check(p)
        size = p.stat().st_size
        if errs:
            print(f"FAIL {p.name} ({size}B): {errs}")
            rc = 1
        else:
            print(f"OK   {p.name} ({size}B)")
    return rc


if __name__ == "__main__":
    sys.exit(main())
