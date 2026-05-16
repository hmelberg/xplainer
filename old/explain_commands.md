# Explain Command Reference

This is a compact, accurate reference for the Explain engine command blocks.
All commands are written as blocks:

```
::: command_name(key="value", flag=true)
content starts on the next line
```

## Core commands

### ::: write_speak
Write markdown and speak it (or `speak_text` if provided).
- Common keywords: `write_effect`, `write_speed_chars_per_sec`, `split`, `split_mode`,
  `typewriter_cps`, `typewriter_min_line_ms`, `write_gap`
- Example:
```
::: write_speak
# Heading
Short line of text.
```

### ::: write
Write markdown only (no speech).
- Same keywords as `write_speak`.

### ::: speak
Speak only (no text).
- Keywords: `text` or `speak_text`, `speech_rate`, `speech_voice`, `speech_lang`
```
::: speak
This is spoken only.
```

### ::: wait
Pause playback.
- Keywords: `click=true` or `seconds=1.2`
```
::: wait(click=true)
```

### ::: new_page
Clear the board (start a new page).
- Keyword: `title`
```
::: new_page
Section Title
```

### ::: defaults / ::: default
Set defaults for the rest of the lecture.
- Example:
```
::: defaults(skin="playful", dim=true, write_effect="typewriter")
```

## Code execution

### ::: pyodide
Python code execution.
- Keywords: `title`, `subtitle`, `editable`, `silent`, `auto_run`, `height`,
  `location`, `result_location`, `max_lines`
- Example:
```
::: pyodide(editable=true, title="Sandbox")
print("hello")
```

### ::: webr
R code execution.
- Same keywords as `pyodide`.

### ::: js
JavaScript execution in the browser.
- Same keywords as `pyodide`.
- Default: `show_code=false` (executes without showing the code block).

### ::: pyodide_preload
Preload Pyodide in the background.
- Keyword: `enabled` (true/false)

## Visuals

### ::: draw / ::: new_drawing
SVG drawing blocks (cartesian coordinates by default).
- Keywords: `height`, `location`, `coords`
- Content: SVG path commands or line primitives.

### ::: p5 / ::: p5js
JavaScript simulation using p5.js (`setup()` and `draw()` required).
- Keywords: `title`, `height`, `location`, `autorun`, `controls`

### ::: p5_control
Control an existing p5 simulation (e.g., play/pause or params).

### ::: mermaid
Mermaid diagrams.
- Keywords: `title`, `height`

### ::: img / ::: image
Image block.
- Keywords: `src`, `alt`, `width`, `height`

### ::: video
Video block.
- Keywords: `src`, `poster`, `width`, `height`

### ::: youtube
YouTube embed.
- Keywords: `src` or `url`

### ::: html
Raw HTML block.

### ::: link
Link block.
- Keywords: `href`, `text`

### ::: tutorial_link
Loads another tutorial into the same player.
- Keywords: `url`/`href`/`src`, `text`, `caption`
- Accepts GitHub links (auto‑converted to raw) and `owner/repo/path` shorthand.

### ::: accordion
Accordion block (collapsible content).

### ::: pdf
PDF embed/link.
- Keyword: `src`

## Tables

### ::: table
Markdown table blocks.
- Keyword: `title`
```
::: table
| Name | Value |
| --- | --- |
| A | 1 |
| B | 2 |
```

## Questions

### ::: question
Multiple choice (MCQ) or Q&A.
- MCQ: first line is the prompt; options below; mark correct with `*` or `✅`.
- Q&A: use keywords `answer`, `hint`.
```
::: question
What is 2+2?
- 3
* 4
- 5
```

## Annotations and focus

### ::: annotate
Annotate last element (text, code, or table) or a specific target.
- Keywords: `text` / `code_text`, `type` (box, circle, underline, highlight),
  `color`, `pulse`, `duration`, `permanent`, `target`

### ::: dim / ::: no_dim
Dim or undim elements.
- Keywords: `index` or `slice` (e.g. `-1`, `1:3`)

## Math

### ::: math
Display math block (no `$` required).
```
::: math
E = mc^2
```

## Editing existing elements

### ::: underline / ::: move / ::: rotate / ::: change / ::: delete
Apply transformations to existing elements (by id).

## Messages

### ::: message
Show a note or warning box.
- Keywords: `level="note"` or `level="warning"`

## Capabilities (quick map)
- Text + narration: `write`, `write_speak`, `speak`
- Code execution: `pyodide`, `webr`, `js` with inline output
- Visuals: `draw`, `p5`, `mermaid`
- Media + HTML: `img`, `video`, `youtube`, `html`, `link`, `pdf`, `accordion`
- Interaction: `question`, `message`, `wait`
- Emphasis + focus: `annotate`, `dim`, `no_dim`
- Data: `table`
- Math: `math` or `$...$` inside text

## Gotchas / Tips
- `silent=true` on `pyodide`/`webr` hides the code block; use only for background setup.
- `js` runs in the browser and shows output from `console.log` and returned values.
- `::: python` is an alias for `::: pyodide`; `::: r` is an alias for `::: webr`.
- `pause_on_click=false` prevents clicks on a block from pausing playback.
- `result_location="inside"` renders code and output in the same column.
- `editable=false` uses a read-only code block (`pre`) instead of a textarea.
- `write_speak` speaks `speak_text` if provided, otherwise it speaks the written markdown.
- `write_split=true` splits text into multiple blocks; spacing depends on `--write-gap`.
- `annotate` without a target will choose the most recent text/code/table element.
- `annotate` can target code with `code_text` or text with `text`.
- `dim`/`no_dim` accept index or slice like `-1`, `-2`, `1`, `1:3` (last element is `-1`).
