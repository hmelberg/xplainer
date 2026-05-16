#ui.explainer()
#ui.markdown()

from browser import document, svg, aio, window
import time, math, re

##################################################
# GLOBALS & STYLES
##################################################
SVG_WIDTH  = 600
SVG_HEIGHT = 400

DEFAULT_FONT_FAMILY = "'Patrick Hand', cursive"
DEFAULT_FONT_SIZE   = "14px"
DEFAULT_FONT_COLOR  = "black"
_UI_DEFAULT_MATH_ENGINE="ascii"
_ui_x_margin= 20
_ui_y_margin= 10
_ui_current_x=_ui_x_margin
_ui_current_y=SVG_HEIGHT- 10
_ui_line_size=20 
_ui_tab_size=20



questionStats = {
    "per_question": {},
    "total_tries":0,
    "total_corrects":0,
    "total_correct_on_first_try":0,
    "total_time_on_questions":0.0
}

_global_id_counter = 0
def _auto_id():
    global _global_id_counter
    _global_id_counter += 1
    return f"auto_{_global_id_counter}"

def cartesian_to_svg_y(y_val):
    return SVG_HEIGHT - float(y_val)

##################################################
# SPEECH
##################################################
current_utterance = None
speaking_canceled = False

def cancel_speech():
    global current_utterance, speaking_canceled
    if window.speechSynthesis.speaking:
        window.speechSynthesis.cancel()
    speaking_canceled = True
    current_utterance = None

# We’ll place the subtitles in a separate area (below the menu).
subtext_div = None  # Will be created in build_container

async def speak_text(details, show_subtitles=False, svg_elem=None):
    global current_utterance, speaking_canceled
    txt = details.get("text","")
    if not txt:
        return

    window.speechSynthesis.cancel()
    speaking_canceled = False

    lang   = details.get("lang", "en-US")
    male   = details.get("male", True)
    voice_name = details.get("voice", None)
    pitch  = float(details.get("pitch", 1))
    rate   = float(details.get("rate", 1))
    volume = float(details.get("volume", 1))

    def pick_voice(lang="en-US", male=True, voice=None):
        voices = window.speechSynthesis.getVoices()
        if voice:
            for v in voices:
                if v.name == voice:
                    return v
        candidate = None
        for v in voices:
            if v.lang and v.lang.startswith(lang):
                if male and ("male" in v.name.lower()):
                    return v
                if not candidate:
                    candidate = v
        return candidate

    chosen = pick_voice(lang, male, voice_name)
    utt = window.SpeechSynthesisUtterance.new(txt)
    utt.lang   = lang
    utt.pitch  = pitch
    utt.rate   = rate
    utt.volume = volume
    if chosen:
        utt.voice = chosen

    current_utterance = utt
    window.speechSynthesis.speak(utt)

    # Place subtitles below the menu (use subtext_div) if show_subtitles
    sub_el = None
    if show_subtitles and subtext_div:
        sub_el = document.createElement("div")
        sub_el.style.marginTop = "6px"
        sub_el.style.padding = "4px 8px"
        sub_el.style.backgroundColor = "rgba(0,0,0,0.7)"
        sub_el.style.color = "#fff"
        sub_el.style.borderRadius = "4px"
        sub_el.style.maxWidth = "600px"
        sub_el.textContent = txt
        subtext_div.appendChild(sub_el)

    while window.speechSynthesis.speaking and not speaking_canceled:
        await aio.sleep(0.1)

    if sub_el:
        sub_el.remove()
    current_utterance = None

##################################################
# AUDIO
##################################################
async def play_audio(cmd):
    src = cmd.get("src","")
    if not src:
        return
    audio_el = document.createElement("audio")
    audio_el.src = src
    audio_el.play()
    done = False
    def on_end(ev):
        nonlocal done
        done = True
    audio_el.bind("ended", on_end)
    while not done:
        await aio.sleep(0.1)

##################################################
# ANIMATION HELPERS
##################################################
def ease(progress, easing_type):
    if easing_type=="ease-in":
        return progress**2
    elif easing_type=="ease-out":
        return 1 - (1 - progress)**2
    elif easing_type=="ease-in-out":
        if progress<0.5:
            return 2*(progress**2)
        else:
            return 1 - 2*((1-progress)**2)
    return progress

async def animate_draw(el, duration=0, easing="linear"):
    if duration<=0:
        return
    start=time.time()
    length=None
    try:
        length=el.getTotalLength()
    except:
        length=None
    if length is not None:
        el.setAttribute("stroke-dasharray",str(length))
        el.setAttribute("stroke-dashoffset",str(length))
    else:
        el.style.opacity=0

    while True:
        now=time.time()
        raw_p=min(1,(now-start)/duration)
        eased=ease(raw_p,easing)
        if length is not None:
            offset=length*(1-eased)
            el.setAttribute("stroke-dashoffset",str(offset))
        else:
            el.style.opacity=eased
        if raw_p>=1:
            break
        await aio.sleep(0.016)

    if length is not None:
        el.removeAttribute("stroke-dasharray")
        el.removeAttribute("stroke-dashoffset")

async def animate_move(el, x, y, duration=1, easing="linear"):
    start_t = time.time()
    init_x  = float(el.getAttribute("x") or 0)
    init_y  = float(el.getAttribute("y") or 0)
    while True:
        now = time.time()
        raw_p = min(1, (now - start_t)/duration)
        eased = ease(raw_p, easing)
        new_x = init_x + eased*(x - init_x)
        new_y = init_y + eased*(y - init_y)
        el.setAttribute("x", str(new_x))
        el.setAttribute("y", str(new_y))
        if raw_p >= 1:
            break
        await aio.sleep(0.016)


# New: General delete command function
async def do_delete(cmd):
    elid = cmd.get("id")
    if elid:
        el = document.getElementById(elid)
        if el:
            el.remove()




##################################################
# QUESTION
##################################################
async def show_question(svg_elem, details):
    qtxt   = details.get("question","(No question)")
    alts   = details.get("alternatives",[])
    correct_idx = details.get("answer",0)

    ov_id=f"question_{id(details)}"
    questionStats["per_question"][ov_id] = {
        "tries":0,"correct":0,
        "start_time":time.time(),
        "end_time":None,
        "correct_on_first_try":False,
        "time_spent":0.0
    }

    overlay=svg.g(id=ov_id)
    bg=svg.rect(x="0", y="0", width="100%", height="100%", fill="rgba(0,0,0,0.4)")
    overlay.appendChild(bg)

    box_w, box_h = 320, 220
    box_x = (SVG_WIDTH - box_w)//2
    box_y = (SVG_HEIGHT - box_h)//2
    top_y = cartesian_to_svg_y(box_y) - box_h

    frame = svg.rect(
        x=box_x, y=top_y,
        width=box_w, height=box_h,
        fill="white", stroke="black", **{"stroke-width":2,"rx":10,"ry":10}
    )
    overlay.appendChild(frame)

    fobj=svg.foreignObject(x=box_x, y=top_y, width=box_w, height=box_h)
    container = document.createElement("div")
    container.style.width=f"{box_w}px"
    container.style.height=f"{box_h}px"
    container.style.overflow="auto"
    container.style.position="relative"
    container.style.fontFamily = DEFAULT_FONT_FAMILY
    container.style.fontSize   = DEFAULT_FONT_SIZE
    container.style.color      = DEFAULT_FONT_COLOR
    container.style.padding    = "10px"

    q_div = document.createElement("div")
    q_div.textContent = qtxt
    q_div.style.marginBottom="12px"
    container.appendChild(q_div)

    answers_div = document.createElement("div")
    container.appendChild(answers_div)

    def on_click_factory(idx):
        def onclick(ev):
            st=questionStats["per_question"][ov_id]
            st["tries"]+=1
            questionStats["total_tries"]+=1
            if idx==correct_idx:
                st["correct"]+=1
                questionStats["total_corrects"]+=1
                if st["tries"]==1:
                    st["correct_on_first_try"]=True
                    questionStats["total_correct_on_first_try"]+=1
                feedback_div.textContent="Correct!"
                feedback_div.style.color="green"
                st["end_time"]=time.time()
                st["time_spent"]=st["end_time"]-st["start_time"]
                questionStats["total_time_on_questions"]+=st["time_spent"]
                def rm():
                    overlay.remove()
                window.setTimeout(rm,800)
            else:
                feedback_div.textContent="Try again!"
                feedback_div.style.color="red"
        return onclick

    for i, alt_txt in enumerate(alts):
        card = document.createElement("div")
        card.style.border="1px solid #ccc"
        card.style.borderRadius="8px"
        card.style.padding="6px"
        card.style.marginBottom="8px"
        card.style.cursor="pointer"
        card.textContent = alt_txt
        card.bind("click", on_click_factory(i))
        answers_div.appendChild(card)

    feedback_div = document.createElement("div")
    feedback_div.style.textAlign="center"
    feedback_div.style.marginTop="12px"
    feedback_div.style.color="blue"
    feedback_div.style.fontWeight="bold"
    container.appendChild(feedback_div)

    fobj.appendChild(container)
    overlay.appendChild(fobj)
    svg_elem.appendChild(overlay)

    while document.getElementById(ov_id) is not None:
        await aio.sleep(0.1)

##################################################
# SPECIAL COMMANDS: MATH, MARKDOWN, POINTER, HIGHLIGHT, ZOOM
##################################################
async def do_math(svg_elem, cmd):
    global _ui_current_y
    # Ensure y is converted from cartesian to SVG coordinates.
    x = float(cmd.get("x", 0))
    y = float(cmd.get("y", 0))
    
    scrolled=False
    if "y" not in cmd:
        x,y = _adjust_xy(cmd)
        if y<10:
            scroll_area()
            #aio.sleep(0.1)
            y=(SVG_HEIGHT/2)-_ui_line_size
            #y=(SVG_HEIGHT/2)
            scrolled=True
            _ui_current_y=y+_ui_line_size
            
    
    sy = cartesian_to_svg_y(y)

    # Create a foreignObject with a provisional size and hide it.
    fobj = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject")
    fobj.setAttribute("x", str(x))
    fobj.setAttribute("y", str(sy))
    fobj.setAttribute("width", "300")
    fobj.setAttribute("height", "50")
    fobj.style.opacity = "0"  # start hidden

    # Create a div to hold the math content.
    div = document.createElement("div")
    div.style.fontSize = cmd.get("font-size", DEFAULT_FONT_SIZE)
    #div.style.color = cmd.get("fill", "darkred")
    div.style.display = "inline-block"  # helps with accurate measurement

    math_txt = cmd.get("text", "").strip()
    ascii_math = cmd.get("ascii", _UI_DEFAULT_MATH_ENGINE=="ascii")
    alpha_start=math_txt.startswith("@") and math_txt.endswith("@")
    is_ascii = ascii_math or alpha_start
    if is_ascii: 
        if not alpha_start:
            math_txt = "@" + math_txt + "@"
        div.innerHTML = math_txt
    else:
        if not math_txt.startswith("$$"):
            math_txt = "$$" + math_txt + "$$"
            
        # For LaTeX
        #math_txt = math_txt.replace(chr(92), chr(92) * 2)
        div.innerHTML =  math_txt 

    fobj.appendChild(div)
    svg_elem.appendChild(fobj)

    # If MathJax is present, typeset the math.
    if window.MathJax and window.MathJax.typeset:
        window.MathJax.typeset([div])

    # Wait briefly to allow rendering and MathJax typesetting to complete.
    await aio.sleep(0.1)

    # Now measure the rendered content's size.
    width = div.scrollWidth
    height = div.scrollHeight
    fobj.setAttribute("width", str(width))
    fobj.setAttribute("height", str(height))
    if not "y" in cmd:
        if scrolled:
            #_ui_current_y=(SVG_HEIGHT/2)+_ui_line_size-height
            _ui_current_y=_ui_current_y-height
        else:
            _ui_current_y=_ui_current_y-height

    # Fade in the element using a CSS transition.
    fobj.style.transition = "opacity 0.2s ease-in-out"
    fobj.style.opacity = "1"


# NEW: Markdown command
async def do_markdown(svg_elem, cmd):
    global _ui_current_y
    
    x = float(cmd.get("x", 0))
    y = float(cmd.get("y", 0))
    
    scrolled=False
    if "y" not in cmd:
        x, y = _adjust_xy(cmd)
        if y<10:
            scroll_area()
            #aio.sleep(0.1)
            y=(SVG_HEIGHT/2)-_ui_line_size
            _ui_current_y=y+_ui_line_size
            scrolled=True
    
    sy = cartesian_to_svg_y(y)
    text_md = cmd.get("text","")

    fobj = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject")
    fobj.setAttribute("x", str(x))
    fobj.setAttribute("y", str(sy))
    fobj.setAttribute("width", "300")
    fobj.setAttribute("height", "10")

    div = document.createElement("div")
    div.style.fontSize = cmd.get("font-size", "14px")
    div.style.color = cmd.get("fill", "black")
    div.style.display = "inline-block"  # helps determine width based on content

    div.style.visibility = "hidden"
    md=ui.markdown(text_md, math=True)
    div.appendChild(md)


    fobj.appendChild(div)
    svg_elem.appendChild(fobj)

    # Wait a bit so the browser can render and compute sizes
    await aio.sleep(0.05)
    # Now measure the content's size
    width = div.scrollWidth
    height = div.scrollHeight
    fobj.setAttribute("width", str(width))
    fobj.setAttribute("height", str(height))
    div.style.visibility = "visible"
    if "y" not in cmd:
        _ui_current_y=_ui_current_y-height





async def do_pointer(svg_elem, cmd):
    x = float(cmd.get("x",0))
    y = float(cmd.get("y",0))
    sy = cartesian_to_svg_y(y)
    r = float(cmd.get("r",5))
    dur = float(cmd.get("duration",1))
    circle = svg.circle(cx=x, cy=sy, r=r, fill="yellow", opacity="0.5")
    svg_elem.appendChild(circle)
    start_t = time.time()
    while True:
        now=time.time()
        if now - start_t>=dur:
            break
        await aio.sleep(0.05)
    circle.remove()

async def do_pause(cmd):
    seconds = float(cmd.get("seconds", 1))
    await aio.sleep(seconds)

async def do_highlight(svg_elem, cmd):
    elid = cmd.get("id")
    color= cmd.get("color","#ff0")
    dur  = float(cmd.get("duration",1))
    target = document.getElementById(elid)
    if not target:
        return
    old_stroke = target.getAttribute("stroke")
    old_sw     = target.getAttribute("stroke-width")
    target.setAttribute("stroke", color)
    target.setAttribute("stroke-width", "4")
    start_t = time.time()
    while True:
        now=time.time()
        if now - start_t>=dur:
            break
        await aio.sleep(0.1)
    # revert
    if old_stroke:
        target.setAttribute("stroke", old_stroke)
    else:
        target.removeAttribute("stroke")
    if old_sw:
        target.setAttribute("stroke-width", old_sw)
    else:
        target.removeAttribute("stroke-width")

# A global group to handle zoom transformations
_zoom_g = None
_current_zoom_factor = 1.0
_zoom_offset_x = 0
_zoom_offset_y = 0

async def do_zoom(svg_elem, cmd):
    """
      cmd may have:
      - id (string) or x, y (float)
      - level (float) e.g. 2.0 => 2x zoom
      - reset (bool) => if True, go back to scale=1
    """
    global _current_zoom_factor, _zoom_g, _zoom_offset_x, _zoom_offset_y

    reset = cmd.get("reset", False)
    level = float(cmd.get("level", 1.0))

    # Create a top-level group if we haven't yet
    if not _zoom_g:
        # Wrap all existing children in one group
        _zoom_g = svg.g(id="zoom_container")
        children = list(svg_elem.children)
        for ch in children:
            _zoom_g.appendChild(ch)
        svg_elem.appendChild(_zoom_g)

    # If reset:
    if reset or abs(level - 1.0) < 1e-9:
        _current_zoom_factor = 1.0
        _zoom_g.setAttribute("transform", "")
        return

    # Otherwise, apply a scale around (x, y) or around some object center
    # For simplicity, just scale the entire group around (0,0).
    # If we want to center on a coordinate, we'd do translate + scale + translate back.
    _current_zoom_factor = level
    # If the user gave an id, we might want to find that element's center:
    elid = cmd.get("id")
    if elid:
        target = document.getElementById(elid)
        if target:
            # Simplistic approach: assume (x, y) in its "x", "y" attrs
            tx = float(target.getAttribute("x") or 0)
            ty = float(target.getAttribute("y") or 0)
            ty = cartesian_to_svg_y(ty)
            # center-based transform (not fully robust, but just an example)
            transform_str = f"translate({tx},{ty}) scale({level}) translate({-tx},{-ty})"
            _zoom_g.setAttribute("transform", transform_str)
            return
    # If x,y given:
    zx = float(cmd.get("x", 0))
    zy = float(cmd.get("y", 0))
    sy = cartesian_to_svg_y(zy)
    transform_str = f"translate({zx},{sy}) scale({level}) translate({-zx},{-sy})"
    _zoom_g.setAttribute("transform", transform_str)

##################################################
# MAIN SVG COMMAND
##################################################
_groups = {}

async def apply_svg_command(svg_elem, cmd):
    global _ui_current_x
    global _ui_current_y
    ctype = cmd.get("command","").lower()
    dur   = float(cmd.get("duration",0))
    easing= cmd.get("easing","linear")

    # For grouping
    grp_name = cmd.get("group")
    parent_el = svg_elem
    if grp_name:
        if grp_name not in _groups:
            _groups[grp_name] = svg.g(id=f"group_{grp_name}")
            svg_elem.appendChild(_groups[grp_name])
        parent_el = _groups[grp_name]

    # (1) CLEAR
    if ctype=="clear":
        svg_elem.clear()
        _groups.clear()
        return

    # (1)bis: NEW_PAGE
    elif ctype=="new_page":
        scroll_up = cmd.get("scroll_up", False)
        title     = cmd.get("title", "")
        # If scroll_up, animate existing content upward
        if scroll_up:
            # Quick approach: move everything up by SVG_HEIGHT
            # We'll gather all children in a temporary group and animate it
            temp_g = svg.g()
            while svg_elem.firstChild:
                temp_g.appendChild(svg_elem.firstChild)
            svg_elem.appendChild(temp_g)

            start_t = time.time()
            offset = SVG_HEIGHT
            anim_dur = dur if dur>0 else 1
            while True:
                now = time.time()
                p = min(1, (now - start_t)/anim_dur)
                temp_g.setAttribute("transform", f"translate(0, {-offset*p})")
                if p>=1:
                    break
                await aio.sleep(0.016)

        # now clear
        svg_elem.clear()
        _groups.clear()
        
        _ui_current_x=_ui_x_margin
        _ui_current_y= SVG_HEIGHT - _ui_y_margin
        print("CURR1",SVG_HEIGHT,_ui_y_margin,  _ui_current_y)
        # If we have a title, place a big text near top, centered
        if title:
            t_el = document.createElementNS("http://www.w3.org/2000/svg","text")
            t_el.setAttribute("x", str(SVG_WIDTH/2))
            # near top => let's say y=30 below top
            t_el.setAttribute("y", str(30))
            t_el.setAttribute("text-anchor","middle")
            t_el.style.fontSize   = "24px"
            t_el.style.fontFamily = DEFAULT_FONT_FAMILY
            t_el.style.fill       = "black"
            t_el.textContent = title
            svg_elem.appendChild(t_el)
            _ui_current_y = _ui_current_y - 35
            print("CURR2", _ui_current_y)


        return

    # (2) MOVE
    elif ctype=="move":
        elid = cmd.get("id")
        if not elid: return
        el = document.getElementById(elid)
        if not el: return
        x  = float(cmd.get("x",0))
        y  = float(cmd.get("y",0))
        sy = cartesian_to_svg_y(y)
        await animate_move(el, x, sy, dur, easing)
        return

    # (3) SET_ATTRIBUTE
    elif ctype=="set_attribute":
        elid = cmd.get("id")
        if not elid: return
        el = document.getElementById(elid)
        if not el: return
        attr = cmd.get("attr")
        val  = cmd.get("value")
        if attr and val is not None:
            el.setAttribute(attr, str(val))
        return

    # (2') ZOOM
    elif ctype=="zoom":
        await do_zoom(svg_elem, cmd)
        return

    # (2'') MARKDOWN
    elif ctype=="markdown":
        await do_markdown(svg_elem, cmd)
        return

    # 4) Otherwise, a regular SVG shape or text
    ns="http://www.w3.org/2000/svg"
    el = document.createElementNS(ns, ctype if ctype else "g")  # fallback to <g> if empty
    if "id" not in cmd:
        el.setAttribute("id", _auto_id())

    font_family = cmd.get("font-family", DEFAULT_FONT_FAMILY)
    font_size   = cmd.get("font-size", DEFAULT_FONT_SIZE)
    fill_color  = cmd.get("fill", DEFAULT_FONT_COLOR)
    el.style.fontFamily = font_family
    el.style.fontSize   = font_size
    el.style.fill       = fill_color
    #el.style.whiteSpace = "pre"
    el.setAttribute("xml:space", "preserve")



    for k, v in cmd.items():
        if k in ("action", "command", "duration", "easing", "group"):
            continue
        if k in ("font-family", "font-size", "fill", "scroll_up", "title"):
            continue
        if k.lower().startswith("y") and k in ("y","y1","y2"):
            vy = cartesian_to_svg_y(v)
            el.setAttribute(k, str(vy))
        else:
            el.setAttribute(k, str(v))

    if ctype == "text" and "text" in cmd:
        raw_txt = cmd["text"]
        if "y" not in cmd:
            x,y = _adjust_xy(cmd)
            raw_txt=raw_txt.lstrip("#")
            if y<0:
                scroll_area()
                #aio.sleep(0.1)
                y=(SVG_HEIGHT/2)-_ui_line_size
                _ui_current_y=y+_ui_line_size
                    
        else:
            y=cmd["y"]
            x=cmd["x"]

        y=cartesian_to_svg_y(y)
        el.setAttribute("y", str(y))
        el.setAttribute("x", str(x))
        #print("YYYY", x, y, raw_txt)
        parent_el.appendChild(el)

            
        if chr(13) in raw_txt:
            lines = raw_txt.split(chr(13))
            el.textContent = ""  # Clear default textContent
            # Create tspans for each line
            for i, line in enumerate(lines):
                tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan")
                tspan.textContent = ""
                tspan.setAttribute("x", el.getAttribute("x") or "0")
                if i > 0:
                    tspan.setAttribute("dy", "1.2em")
                el.appendChild(tspan)
                # Animate letter by letter for this line
                if len(line) == 0:
                    await aio.sleep(dur/len(raw_txt))
                else:
                    t_per_char = dur / len(raw_txt)
                    for ch in line:
                        tspan.textContent += ch
                        await aio.sleep(t_per_char)
        else:
            # Fallback if no line breaks are detected
            el.textContent = ""
            if len(raw_txt) == 0:
                await aio.sleep(dur)
            else:
                t_per_char = dur / len(raw_txt)
                for ch in raw_txt:
                    el.textContent += ch
                    await aio.sleep(t_per_char)
        parent_el.appendChild(el)
        
        if "y" not in cmd:
            height = el.getBBox().height
            _ui_current_y -= height
            print("HEIGHT",_ui_current_y, height )
            
        
        return


    parent_el.appendChild(el)
    if dur>0:
        await animate_draw(el,dur,easing)


##################################################
# EXPLAINER ENGINE
##################################################
class ExplainerPlayer:
    def __init__(self, command_list):
        self.commands = command_list
        self.index=0
        self.total=len(command_list)
        self.paused=False
        self.showSubtitles=False

        if not document.getElementById("mysvg"):
            doc_svg=svg.svg(id="mysvg", width="60vw", height="40vw",          viewBox="0 0 600 400", preserveAspectRatio="xMidYMid meet")
            
            doc_svg.style.border="2px solid black"
            doc_svg.style.borderRadius="12px"
            document.body<=doc_svg
        self.svg_elem=document["mysvg"]

        self.build_container()
        self.setup_mouse_handling()

    def build_container(self):
        global subtext_div
        if not document.getElementById("explainerContainer"):
            container=document.createElement("div")
            container.id="explainerContainer"
            document.body.appendChild(container)
            container.appendChild(self.svg_elem)
        else:
            container=document["explainerContainer"]

        # Menu
        self.menu_div=document.createElement("div")
        #self.menu_div.style.width=f"{SVG_WIDTH}px"
        self.menu_div.style.width="60vw"
        
        self.menu_div.style.backgroundColor="#ececec"
        self.menu_div.style.border="1px solid #999"
        self.menu_div.style.padding="5px"
        self.menu_div.style.marginBottom="10px"
        self.menu_div.style.fontFamily="sans-serif"
        self.menu_div.style.display="flex"
        self.menu_div.style.gap="5px"
        self.menu_div.style.flexWrap="wrap"
        self.menu_div.style.alignItems="center"
        self.menu_div.style.visibility="hidden"
        self.menu_div.style.borderRadius="8px"
        container.appendChild(self.menu_div)

        # Subtitles below the menu
        subtext_div = document.createElement("div")
        container.appendChild(subtext_div)

        # Play/Pause
        self.play_pause_btn = document.createElement("button")
        self.play_pause_btn.textContent = "▶/⏸"
        self.play_pause_btn.style.fontSize="12px"
        self.play_pause_btn.bind("click", self.toggle_play)
        self.menu_div.appendChild(self.play_pause_btn)

        # Rewind
        self.rewind_btn=document.createElement("button")
        self.rewind_btn.textContent="⏮"
        self.rewind_btn.style.fontSize="12px"
        self.rewind_btn.bind("click", self.on_rewind_click)
        self.menu_div.appendChild(self.rewind_btn)

        # Subtitles (CC icon)
        self.sub_btn=document.createElement("button")
        self.sub_btn.textContent="🄪"
        self.sub_btn.style.fontSize="12px"
        self.sub_btn.bind("click", self.toggle_subtitles)
        self.menu_div.appendChild(self.sub_btn)

        # Slider
        self.slider=document.createElement("input")
        self.slider.type="range"
        self.slider.min="0"
        self.slider.max=str(self.total)
        self.slider.value="0"
        self.slider.style.flex="1"
        self.slider.bind("input", self.on_slider_input)
        self.slider.bind("change", self.on_slider_change)
        self.menu_div.appendChild(self.slider)

        def on_menu_enter(ev):
            self.menu_div.style.visibility="visible"

        def on_menu_leave(ev):
            rect=self.svg_elem.getBoundingClientRect()
            mx=ev.clientX
            my=ev.clientY
            near_bottom=(my>=(rect.bottom-50) and my<=rect.bottom
                         and mx>=rect.left and mx<=rect.right)
            if not near_bottom:
                self.menu_div.style.visibility="hidden"

        self.menu_div.bind("mouseenter", on_menu_enter)
        self.menu_div.bind("mouseleave", on_menu_leave)

    def setup_mouse_handling(self):
        def on_mouse_move(ev):
            rect=self.svg_elem.getBoundingClientRect()
            mx=ev.clientX
            my=ev.clientY
            near_bottom=(my>=(rect.bottom-50) and my<=rect.bottom
                         and mx>=rect.left and mx<=rect.right)
            if near_bottom or self.paused:
                self.menu_div.style.visibility="visible"
            else:
                menurect=self.menu_div.getBoundingClientRect()
                if (mx<menurect.left or mx>menurect.right
                    or my<menurect.top or my>menurect.bottom):
                    self.menu_div.style.visibility="hidden"
        document.bind("mousemove", on_mouse_move)

    def on_slider_input(self, ev):
        # (7) Must immediately pause, cancel speech, and fast redraw ignoring
        # speak, question, audio, pointer, highlight, etc. Subtitles cleared.
        if not self.paused:
            cancel_speech()
            self.paused=True
        val=int(self.slider.value)
        self.index=val
        self.fast_redraw(val)

    def on_slider_change(self, ev):
        val=int(self.slider.value)
        self.index=val
        self.fast_redraw(val)

    def toggle_play(self, ev):
        if not self.paused:
            cancel_speech()
            self.paused=True
        else:
            self.paused=False
            aio.run(self.play_from_current())

    def on_rewind_click(self, ev):
        cancel_speech()
        self.index=0
        self.slider.value="0"
        self.fast_redraw(0)
        self.paused=True

    def toggle_subtitles(self, ev):
        self.showSubtitles=not self.showSubtitles

    # (7) FAST REDRAW
    def fast_redraw(self, idx):
        global _ui_current_y
        _ui_current_y = SVG_HEIGHT
        # Clear screen & subtext
        self.svg_elem.clear()
        subtext_div.innerHTML = ""
        # Also reset group references, if any
        global _groups
        _groups.clear()
        # If we had a special zoom group, reset it
        global _zoom_g, _current_zoom_factor
        _zoom_g = None
        _current_zoom_factor = 1.0

        # Re-apply commands (duration=0) for only the drawing parts
        for i in range(idx):
            cmd = self.commands[i]
            action = cmd.get("action","").lower()

            if action=="svg":
                local_cmd=dict(cmd)
                local_cmd["duration"]=0
                # just do the shape or text, skip anything else
                aio.run(apply_svg_command(self.svg_elem, local_cmd))

            elif action.startswith("speak_and_"):
                # We do only the drawing/move part, skip the speaking
                # example: "speak_and_draw" => we have speak_data, draw_data
                # We'll do the draw_data with duration=0
                # same for move, highlight, pointer
                if "draw" in cmd:
                    local_cmd = dict(cmd["draw"])
                    local_cmd["duration"]=0
                    aio.run(apply_svg_command(self.svg_elem, local_cmd))
                elif "move" in cmd:
                    move_cmd = dict(cmd["move"])
                    move_cmd["command"] = "move"
                    move_cmd["duration"] = 0
                    aio.run(apply_svg_command(self.svg_elem, move_cmd))
                elif "highlight" in cmd:
                    # highlight is visible effect but let's skip or do instant highlight?
                    # Usually you'd skip, but let's do a short highlight with dur=0 => no effect
                    pass
                elif "pointer" in cmd:
                    # pointer also ephemeral, skip
                    pass

            elif action=="math":
                # We should still show the math, but with no animation
                local_cmd = dict(cmd)
                # math doesn't have a "duration" concept, so just do it
                aio.run(do_math(self.svg_elem, local_cmd))

            elif action=="markdown":
                # Also show markdown with no animation
                local_cmd = dict(cmd)
                aio.run(do_markdown(self.svg_elem, local_cmd))

            elif action=="zoom":
                # Re-apply the zoom
                local_cmd = dict(cmd)
                aio.run(do_zoom(self.svg_elem, local_cmd))

            # For question, speak, audio, pointer, highlight => skip entirely
            # (the user specifically wants ignoring them in fast mode)
            else:
                pass

    async def play_from_current(self):
        while self.index < self.total:
            if self.paused:
                break
            cmd = self.commands[self.index]
            action = cmd.get("action","").lower()

            if action=="svg":
                await apply_svg_command(self.svg_elem, cmd)

            elif action=="speak":
                await speak_text(cmd, self.showSubtitles, self.svg_elem)
            
            elif action == "pause":
                await do_pause(cmd)
        
            elif action == "delete":
                await do_delete(cmd)

            elif action=="question":
                # ensure any ongoing speech is finished
                while window.speechSynthesis.speaking:
                    await aio.sleep(0.1)
                await show_question(self.svg_elem, cmd)

            elif action=="audio":
                while window.speechSynthesis.speaking:
                    await aio.sleep(0.1)
                await play_audio(cmd)

            elif action=="math":
                await do_math(self.svg_elem, cmd)

            elif action=="markdown":
                await do_markdown(self.svg_elem, cmd)

            elif action=="pointer":
                await do_pointer(self.svg_elem, cmd)

            elif action=="highlight":
                await do_highlight(self.svg_elem, cmd)

            elif action=="zoom":
                await do_zoom(self.svg_elem, cmd)

            # speak_and_xyz commands:
            elif action=="speak_and_draw":
                speak_data = cmd.get("speak", {})
                draw_data  = cmd.get("draw", {})
                aio.run(speak_text(speak_data, self.showSubtitles, self.svg_elem))
                await apply_svg_command(self.svg_elem, draw_data)
                while window.speechSynthesis.speaking:
                    await aio.sleep(0.1)

            elif action=="speak_and_move":
                speak_data = cmd.get("speak", {})
                move_data  = cmd.get("move", {})
                aio.run(speak_text(speak_data, self.showSubtitles, self.svg_elem))
                move_cmd = dict(move_data)
                move_cmd["command"] = "move"
                await apply_svg_command(self.svg_elem, move_cmd)
                while window.speechSynthesis.speaking:
                    await aio.sleep(0.1)

            elif action=="speak_and_highlight":
                speak_data = cmd.get("speak", {})
                highlight_data  = cmd.get("highlight", {})
                aio.run(speak_text(speak_data, self.showSubtitles, self.svg_elem))
                await do_highlight(self.svg_elem, highlight_data)
                while window.speechSynthesis.speaking:
                    await aio.sleep(0.1)

            elif action=="speak_and_point":
                speak_data = cmd.get("speak", {})
                pointer_data  = cmd.get("pointer", {})
                aio.run(speak_text(speak_data, self.showSubtitles, self.svg_elem))
                await do_pointer(self.svg_elem, pointer_data)
                while window.speechSynthesis.speaking:
                    await aio.sleep(0.1)

            elif action=="finish_speaking":
                while window.speechSynthesis.speaking:
                    await aio.sleep(0.1)

            self.index += 1
            self.slider.value = str(self.index)
            if self.index >= self.total:
                break
            await aio.sleep(0.04)

        print("Done playing!")
        print("QuestionStats:", questionStats)

def _adjust_xy(cmd):
    if "y" not in cmd:
        y=_ui_current_y -_ui_line_size
        print("CY", y, cmd)
    else:
        y=cmd["y"]
    
    if "x" not in cmd:
        if "text" in cmd:
            text_val = cmd["text"]
            count = 0
            for ch in text_val:
                if ch == "#":
                    count += 1
                else:
                    break
            x = _ui_x_margin + count * _ui_tab_size
        x=_ui_x_margin
    else:
        x=cmd["x"]
    
    return x,y


from browser import document, aio
import time


def scroll_area(parent_id="mysvg", x0=None, y0=None, x1=None, y1=None, 
                            direction="up", percentage=50, duration=0.1):
    """
    Captures all elements within the defined rectangular area of a parent element (an SVG or a <g>),
    or if no coordinates are defined, captures all content inside that parent,
    and scrolls that captured content in the specified direction.

    Parameters:
      parent_id  : the id of the parent element (SVG or <g>) containing the content.
      x0, y0, x1, y1: Optional coordinates defining the capture area.
                     If any are not provided, the parent's bounding box is used.
      direction  : "up" (or "u"), "down" (or "d"), "left" (or "l"), or "right" (or "r").
      percentage : Percentage of the area’s width (for left/right) or height (for up/down) to scroll.
                   (100% means scrolling the entire area so that the original view is off-screen.)
      duration   : Duration of the scroll animation in seconds (default is 1 second).
    """
    parent = document.getElementById(parent_id)
    if not parent:
        print(f"Element with id '{parent_id}' not found.")
        return
    
    # If no coordinates are provided, capture the entire parent's bounding box.
    if x0 is None or y0 is None or x1 is None or y1 is None:
        try:
            bbox = parent.getBBox()
            x0 = bbox.x
            y0 = bbox.y
            x1 = bbox.x + bbox.width
            y1 = bbox.y + bbox.height
        except Exception as e:
            # Fallback using width/height attributes (if available)
            width = float(parent.getAttribute("width") or 0)
            height = float(parent.getAttribute("height") or 0)
            x0, y0, x1, y1 = 0, 0, width, height

    area_width = x1 - x0
    area_height = y1 - y0

    # Create a new group to hold the captured content.
    scrollGroup = document.createElementNS("http://www.w3.org/2000/svg", "g")
    scrollGroup.setAttribute("id", f"{parent_id}_scrollContent")

    # Create or get the <defs> element to store the clipPath.
    svg_elem = parent if parent.tagName.lower() == "svg" else parent.closest("svg")
    defs = svg_elem.querySelector("defs")
    if not defs:
        defs = document.createElementNS("http://www.w3.org/2000/svg", "defs")
        svg_elem.insertBefore(defs, svg_elem.firstChild)
    
    # Create a clipPath for the capture area.
    clip_id = f"clip_{parent_id}_area"
    clipPath = document.createElementNS("http://www.w3.org/2000/svg", "clipPath")
    clipPath.setAttribute("id", clip_id)
    rect = document.createElementNS("http://www.w3.org/2000/svg", "rect")
    rect.setAttribute("x", str(x0))
    rect.setAttribute("y", str(y0))
    rect.setAttribute("width", str(area_width))
    rect.setAttribute("height", str(area_height))
    clipPath.appendChild(rect)
    defs.appendChild(clipPath)
    
    # Apply the clipPath to our scroll group.
    scrollGroup.setAttribute("clip-path", f"url(#{clip_id})")
    
    # Capture all children of the parent whose center lies within the defined area.
    # (If no area was specified, this means all children inside the parent's bbox.)
    for child in list(parent.children):
        try:
            bbox = child.getBBox()
            cx = bbox.x + bbox.width / 2
            cy = bbox.y + bbox.height / 2
            if (x0 <= cx <= x1) and (y0 <= cy <= y1):
                scrollGroup.appendChild(child)
        except Exception as e:
            continue

    # Append the scroll group back into the parent.
    parent.appendChild(scrollGroup)
    
    # Calculate the translation vector based on the direction.
    dx, dy = 0, 0
    if direction.lower() in ["down", "d"]:
        dy = (percentage / 100.0) * area_height
    elif direction.lower() in ["up", "u"]:
        dy = - (percentage / 100.0) * area_height
    elif direction.lower() in ["right", "r"]:
        dx = (percentage / 100.0) * area_width
    elif direction.lower() in ["left", "l"]:
        dx = - (percentage / 100.0) * area_width
    else:
        print("Invalid direction. Use 'up', 'down', 'left', or 'right'.")
        return

    start_time = time.time()

    async def animate():
        while True:
            elapsed = time.time() - start_time
            t = elapsed / duration
            if t > 1:
                t = 1
            current_dx = dx * t
            current_dy = dy * t
            scrollGroup.setAttribute("transform", f"translate({current_dx}, {current_dy})")
            if t >= 1:
                break
            await aio.sleep(0.016)  # roughly 60 fps

    aio.run(animate())






    
demo_commands = [
    # 1) Clear any previous drawing
    {"action":"svg", "command":"clear"},

    # 2) Draw simple text
    {"action":"svg", "command":"text", "x":50, "y":80, "text":"Hello World!", "duration":1},

    # 3) Use Markdown (foreignObject) at (x=50, y=60)
    {"action":"svg", "command":"markdown",
     "x":50, "y":60,
     "text":"**Bold** text here!- Bullet 1- Bullet 2 and we have losts and lots of text in this markdown. realyy a lot sdf. wf w f wg dg e fgfdgefg efg egefge gefg eg e g efg efg eg e gf",
     "font-size":"14px", "fill":"blue"},



    # 6) Show a pointer “pulse” near (x=100, y=100)
    {"action":"svg", "command":"pointer", "x":100, "y":100, "duration":2},

    # 7) Highlight the text element we drew (assuming it got auto-assigned id="auto_2")
    {"action":"svg", "command":"highlight", "id":"auto_2", "color":"red", "duration":2},

    # 8) Start a new page with a central title, scrolling up the old content
    {"action":"svg", "command":"new_page", "title":"New Chapter", "scroll_up":True, "duration":1},

    # 9) Speak while drawing a rectangle (demonstrates speak_and_draw)
    {"action":"speak_and_draw",
     "speak":{
       "text":"Now drawing a rectangle!",
       "rate":1.0, "pitch":1.0
     },
     "draw":{
       "command":"rect", "x":120, "y":150, "width":80, "height":50,
       "fill":"green", "duration":2
     }},

    # 10) Done
]


consumer_surplus = [
    # 1) Clear the screen
    {"action": "svg", "command": "clear"},
    # 2) Example usage: speak_and_draw
    {
        "action": "speak_and_draw",
        "speak": {
            "text": "Welcome to Consumer Surplus. Let's draw the axes."
        },
        "draw": {
            "command": "line",
            "id": "xAxis",
            "x1": 50, "y1": 0,
            "x2": 550, "y2": 0,
            "stroke": "black",
            "stroke-width": 2,
            "duration": 2
        }
    },
    # etc...
]


consumer_surplus = [
    # 1) Clear the screen
    {
        "action": "svg",
        "command": "clear"
    },
    # 2) Intro with speak_and_draw: set up axes
    {
        "action": "speak_and_draw",
        "speak": {
            "text": (
                "Welcome to this explanation of Consumer Surplus - the difference between your highest willingness to pay and the price you actually shell out. "
            )
        },
        "draw": {
            "command": "line",
            "id": "xAxis",
            "x1": 50, "y1": 0,
            "x2": 550, "y2": 0,
            "stroke": "black",
            "stroke-width": 2,
            "duration": 2
        }
    },
    # 3) Draw y-axis with speak_and_draw
    {
        "action": "speak_and_draw",
        "speak": {
            "text": (
                "Let's add the vertical axis for price. Because, well, prices always go up, "
                "especially when you’re not looking."
            )
        },
        "draw": {
            "command": "line",
            "id": "yAxis",
            "x1": 50, "y1": 0,
            "x2": 50, "y2": 300,
            "stroke": "black",
            "stroke-width": 2,
            "duration": 2
        }
    },
    # 4) Demand curve
    {
        "action": "speak_and_draw",
        "speak": {
            "text": (
                "Next, behold our downward-sloping demand curve, much like your enthusiasm "
                "after hearing another pun. The higher the price, the less you want it."
            )
        },
        "draw": {
            "command": "line",
            "id": "demandLine",
            "x1": 50,  "y1": 280,
            "x2": 500, "y2": 20,
            "stroke": "blue",
            "stroke-width": 2,
            "duration": 3
        }
    },
    # 5) Example of WTP
    {
        "action": "speak",
        "text": (
            "Imagine you want a coffee and you’d pay up to five dollars. "
            "If it only costs three, you basically keep two dollars in your wallet. "
            "That's your consumer surplus. It's like a bonus you didn't know you needed."
        )
    },
    # 6) A bit of 'math' for consumer surplus
    {
        "action": "math",
        "text": "@ sum_(k=1)^n k^2 = (n(n+1)(2n+1))/6 @",
        "ascii": True,  # treat as AsciiMath
        "x": 200,
        "y": 150,
        "font-size": 16,
        "fill": "darkred"
    },
    # 7) Highlight the region representing consumer surplus
    {
        "action": "speak",
        "text": (
            "On the grand supply-demand graph, consumer surplus is the area under the demand curve "
            "and above the actual price. Let’s highlight that bit, shall we?"
        )
    },
    {
        "action": "highlight",
        "id": "demandLine",
        "color": "green",
        "duration": 2
    },
    # 8) Quick question
    {
        "action": "question",
        "question": "Which area best represents consumer surplus on a supply-demand diagram?",
        "alternatives": [
            "Below the demand curve and above the price line",
            "Above the demand curve and below the supply line",
            "Where the supply curve meets the axis"
        ],
        "answer": 0
    },
    # 9) Wrap up
    {
        "action": "speak",
        "text": (
            "Congratulations. You now know consumer surplus. It’s the warm feeling of paying less "
            "than what you’d have grudgingly coughed up. Use it wisely—and keep an eye out for more couch coins."
        )
    }
]


rdd_explanation = [
    # 1) Clear the screen
    {"action": "svg", "command": "clear"},

    # 2) Introduction: What is RDD?
    {"action": "speak",
     "text": (
         "Welcome to our detailed explanation of Regression Discontinuity Design, or RDD. "
         "RDD is a quasi-experimental design used in economics to estimate causal effects by exploiting a predetermined cutoff. "
         "It compares outcomes for subjects just above and just below the threshold, assuming they are similar in all respects except for the treatment."
     )},

    # 3) Set up axes with speak_and_draw
    {"action": "speak_and_draw",
     "speak": {"text": (
         "Imagine we have a running variable, such as a test score, that determines eligibility for a scholarship. "
         "Those above the cutoff receive the treatment, while those below do not."
     )},
     "draw": {
         "command": "line",
         "id": "xAxis",
         "x1": 50, "y1": 50,
         "x2": 550, "y2": 50,
         "stroke": "black",
         "stroke-width": 2,
         "duration": 2
     }},

    # 4) Draw the vertical cutoff line
    {"action": "speak_and_draw",
     "speak": {"text": (
         "This vertical red dashed line represents the cutoff. Subjects just above and just below this threshold are assumed to be very similar, except for receiving the treatment."
     )},
     "draw": {
         "command": "line",
         "id": "cutoffLine",
         "x1": 300, "y1": 50,
         "x2": 300, "y2": 350,
         "stroke": "red",
         "stroke-dasharray": "5,5",
         "stroke-width": 2,
         "duration": 2
     }},

    # 5) Draw the outcome (vertical) axis
    {"action": "speak_and_draw",
     "speak": {"text": (
         "The vertical axis shows the outcome variable—for example, future earnings or test performance. "
         "We compare outcomes just above and below the cutoff."
     )},
     "draw": {
         "command": "line",
         "id": "yAxis",
         "x1": 50, "y1": 350,
         "x2": 50, "y2": 50,
         "stroke": "black",
         "stroke-width": 2,
         "duration": 2
     }},

    # 6) Draw regression lines on both sides of the cutoff
    {"action": "speak_and_draw",
     "speak": {"text": (
         "Here we sketch the regression lines. The left-hand line (control) and the right-hand line (treatment) may differ in intercept. "
         "This jump at the cutoff is our estimate of the treatment effect."
     )},
     "draw": {
         "command": "line",
         "id": "leftLine",
         "x1": 50, "y1": 320,
         "x2": 300, "y2": 200,
         "stroke": "blue",
         "stroke-width": 2,
         "duration": 3
     }},
    {"action": "speak_and_draw",
     "speak": {"text": (
         "Notice how the right-hand line shows a jump at the cutoff."
     )},
     "draw": {
         "command": "line",
         "id": "rightLine",
         "x1": 300, "y1": 180,
         "x2": 550, "y2": 150,
         "stroke": "blue",
         "stroke-width": 2,
         "duration": 3
     }},

    # 7) Math command to show the treatment effect formula
    {"action": "math",
     "text": "@τ = E[Y|X=c⁺] - E[Y|X=c⁻]@",
     "ascii": True,
     "x": 200,
     "y": 400,
     "font-size": 18,
     "fill": "darkgreen"},

    # 8) Explain the key assumption
    {"action": "speak",
     "text": (
         "A critical assumption in RDD is that subjects cannot precisely manipulate their value of the running variable around the cutoff. "
         "This ensures that those just above and just below the threshold are comparable, and the discontinuity in outcomes is attributable to the treatment."
     )},

    # 9) Discuss bandwidth considerations
    {"action": "speak",
     "text": (
         "Another important factor is the bandwidth—the range of values around the cutoff used for analysis. "
         "A narrower bandwidth reduces bias but may lead to higher variance, while a wider bandwidth increases sample size at the risk of including dissimilar subjects."
     )},

    # 10) Question for reflection
    {"action": "question",
     "question": "Which assumption is critical for ensuring that RDD yields a valid causal estimate?",
     "alternatives": [
         "Precise manipulation of the running variable",
         "Continuity of potential outcomes at the cutoff",
         "Large sample size"
     ],
     "answer": 1},

    # 11) Final wrap-up
    {"action": "speak",
     "text": (
         "In summary, Regression Discontinuity Design leverages a cutoff to compare similar subjects on either side, "
         "providing a robust method for estimating causal effects in observational settings. "
         "Thank you for exploring RDD with us."
     )}
]

iv_explanation = [
    # 1) Clear the screen to start fresh
    {"action": "svg", "command": "clear"},

    # 2) Title Page
    {
        "action": "svg",
        "command": "new_page",
        "title": "Instrumental Variables Method",
        "scroll_up": False,
        "duration": 0.5
    },
    {
        "action": "speak",
        "text": (
            "Welcome to a detailed exploration of Instrumental Variables. "
            "When an explanatory variable is correlated with the error term, "
            "this method helps us recover the true causal effect."
        )
    },

    # 3) Display a visual text summary using chr(13) for line breaks
    {
        "action": "svg",
        "command": "text",
        "text": "Instrumental Variables (IV):" + chr(13) +
                "---------------------------------" + chr(13) +
                "1) Solve endogeneity by finding a variable Z" + chr(13) +
                "2) Z must be correlated with X (Relevance)" + chr(13) +
                "3) Z must not be correlated with errors (Exogeneity)",
        "fill": "black",
    },
    
    
        {
        "action": "svg",
        "command": "text",
        "text": "Instrumental Variables (IV)4:"
    },
    
    
            {
        "action": "svg",
        "command": "text",
        "text": "Instrumental Variables (IV)3:" 
    },
                {
        "action": "svg",
        "command": "text",
        "text": "Instrumental Variables (IV)3:" 
    },            {
        "action": "svg",
        "command": "text",
        "text": "Instrumental Variables (IV)3:" 
    },            {
        "action": "svg",
        "command": "text",
        "text": "Instrumental Variables (IV)3:" 
    },            {
        "action": "svg",
        "command": "text",
        "text": "Instrumental Variables (IV)3:" 
    },            {
        "action": "svg",
        "command": "text",
        "text": "Instrumental Variables (IV)3:" 
    },            {
        "action": "svg",
        "command": "text",
        "text": "Instrumental Variables (IV)3:" 
    },            {
        "action": "svg",
        "command": "text",
        "text": "Instrumental Variables (IV)3:" 
    },            {
        "action": "svg",
        "command": "text",
        "text": "Instrumental Variables (IV)3:" 
    },            {
        "action": "svg",
        "command": "text",
        "text": "Instrumental Variables (IV)3:" 
    },            {
        "action": "svg",
        "command": "text",
        "text": "Instrumental Variables (IV)3:" 
    },            {
        "action": "svg",
        "command": "text",
        "text": "Instrumental Variables (IV)3:" 
    },            {
        "action": "svg",
        "command": "text",
        "text": "Instrumental Variables (IV)23:" 
    },            {
        "action": "svg",
        "command": "text",
        "text": "Instrumental Variables (IV)243:" },
    
    {
        "action": "svg",
        "command": "text",
        "text": " Anoterh Instrumental Variables (IV25):",
    },
    
    {
        "action": "svg",
        "command": "text",
        "text": " And a thrid  Instrumental Variables (IV):",
        "font-size": "10px",
        "fill": "black",
    },

    # 5) Further explanation of endogeneity
    {
        "action": "speak",
        "text": (
            "Endogeneity occurs when X is jointly determined with Y or affected by omitted factors. "
            "An instrument, Z, isolates the exogenous variation in X."
        )
    },

    # 6) Draw horizontal axis (X-axis) with speak_and_draw
    {
        "action": "speak_and_draw",
        "speak": {"text": "Let’s draw the horizontal axis representing X."},
        "draw": {
            "command": "line",
            "id": "axisX",
            "x1": 50, "y1": 50,
            "x2": 550, "y2": 50,
            "stroke": "black",
            "stroke-width": 2,
            "duration": 2
        }
    },

    # 7) Draw vertical axis (Y-axis)
    {
        "action": "speak_and_draw",
        "speak": {"text": "Now, the vertical axis representing Y."},
        "draw": {
            "command": "line",
            "id": "axisY",
            "x1": 50, "y1": 50,
            "x2": 50, "y2": 300,
            "stroke": "black",
            "stroke-width": 2,
            "duration": 2
        }
    },

    # 8) Label the axes using text commands
    {
        "action": "svg",
        "command": "text",
        "x": 560,
        "y": 45,
        "text": "X",
        "font-size": "16px",
        "fill": "blue"
    },
    {
        "action": "svg",
        "command": "text",
        "x": 40,
        "y": 310,
        "text": "Y",
        "font-size": "16px",
        "fill": "blue"
    },

    # 9) Display the IV formula using ASCII math with @ delimiters
    {
        "action": "math",
        "text": "@beta_(IV) = (Cov(Z, Y)) / (Cov(Z, X))@",
        "ascii": True,

    },
    
        # 9) latex math
    {
        "action": "math",
        "text": r"$$\\sum_{i=1}^n i^2 = \\frac{n(n+1)(2n+1)}{6}$$",
        "ascii": False,
        "x": 200,
        "y": 120,

    },
    
        {
        "action": "math",
        "text": "@beta_(IV) = (Cov(1Z, Y)) / (Cov(Z, X))@",
        "ascii": True,


    },
        {
        "action": "math",
        "text": "@beta_(IV) = (2Cov(Z, Y)) / (Cov(Z, X))@",
        "ascii": True,


    },
            {
        "action": "math",
        "text": "@beta_(IV) = (3Cov(Z, Y)) / (Cov(Z, X))@",
        "ascii": True,


    },
    
    
        # 9) Display the IV formula using ASCII math with @ delimiters
    {
        "action": "math",
        "text": "@beta_(IV) = (Cov(Z, Y)) / (Cov(Z, X))@",
        "ascii": True,
    },
    {
        "action": "math",
        "text": "@beta_(IV) = (Cov(Z, Y)) / (Cov(Z, X))@",
        "ascii": True,
    },
    
    
        {
        "action": "math",
        "text": "@beta_(IV) = (Cov(Z, Z)) / (Cov(Z, A))@",
        "ascii": True,
    },
            {
        "action": "svg",
        "text": "One more line",
    },
    
                {
        "action": "svg",
        "text": "And  more line",
    },


    # 10) Pointer to highlight the formula
    {
        "action": "svg",
        "command": "pointer",
        "x": 200,
        "y": 180,
        "duration": 3
    },

    # 11) Explain two-stage least squares (2SLS)
    {
        "action": "speak",
        "text": (
            "A common estimator is two-stage least squares. In Stage One, we regress X on Z. "
            "In Stage Two, we regress Y on the predicted values of X. This isolates the exogenous part of X."
        )
    },

    # 12) Visual text for the 2SLS stages using chr(13) for line breaks
    {
        "action": "svg",
        "command": "markdown",
        "text": "Stages of 2SLS:" + chr(13) +
                "1) @^X = pi_0 + pi_1 * Z@" + chr(13) +
                "2) @Y = alpha_0 + alpha_1 * ^x@",

    },
    
        # 3) Display a visual text summary using chr(13) for line breaks
    {
        "action": "svg",
        "command": "text",
        "text": " Anoterh Instrumental Variables (IV):",
        "font-size": "14px",
        "fill": "black",
    },

    # 13) New page with a title for exogeneity conditions
    {
        "action": "svg",
        "command": "new_page",
        "title": "Exogeneity Conditions",
        "scroll_up": True,
        "duration": 1
    },

    # 14) Draw a circle to visually represent the instrument Z
    {
        "action": "speak_and_draw",
        "speak": {"text": "A valid instrument must be unrelated to the error term. Here, Z is shown as an isolated circle."},
        "draw": {
            "command": "circle",
            "id": "instrumentCircle",
            "cx": 150, "cy": 200,
            "r": 40,
            "fill": "lightblue",
            "duration": 2
        }
    },

    # 15) Label the instrument with text
    {
        "action": "svg",
        "command": "text",
        "x": 140,
        "y": 205,
        "text": "Z",
        "font-size": "16px",
        "fill": "black"
    },

    # 16) Pointer to the instrument circle
    {
        "action": "svg",
        "command": "pointer",
        "x": 150,
        "y": 200,
        "duration": 2
    },

    # 17) Pause briefly
    {"action": "pause", "seconds": 1},

    # 18) Question to check understanding
    {
        "action": "question",
        "question": "Which property is crucial for a valid instrument?",
        "alternatives": [
            "It must be correlated with the error term.",
            "It must be correlated with X but uncorrelated with the error term.",
            "It must have no effect on X."
        ],
        "answer": 1
    },

    # 19) Final wrap-up
    {
        "action": "speak",
        "text": (
            "In summary, instrumental variables help us extract the exogenous variation in X using a valid instrument, Z. "
            "This approach is essential in empirical research across economics. Thank you for watching this lecture."
        )
    }
]




##################################################
# RUN DEMO
##################################################
# consumer_surplus
# demo_commands
# rdd_explanation
#iv_explanation
async def main():
    player = ExplainerPlayer(iv_explanation)
    await player.play_from_current()

aio.run(main())