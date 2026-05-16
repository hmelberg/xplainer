#ui.explainer()

from browser import document, svg, window, aio

import time, math



async def animate_draw(element, duration=2):

    """Animate drawing of an SVG element gradually."""

    start = time.time()

    tag = element.tagName.lower()

    length = None



    if tag == "line":

        x1 = float(element.getAttribute("x1"))

        y1 = float(element.getAttribute("y1"))

        x2 = float(element.getAttribute("x2"))

        y2 = float(element.getAttribute("y2"))

        length = math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)

    elif tag == "circle":

        r = float(element.getAttribute("r"))

        length = 2 * math.pi * r

    elif tag == "path":

        try:

            length = element.getTotalLength()

        except Exception:

            length = None



    if length:

        element.setAttribute("stroke-dasharray", str(length))

        element.setAttribute("stroke-dashoffset", str(length))

    else:

        element.style.opacity = 0



    while True:

        now = time.time()

        progress = min(1, (now - start) / duration)

        if length:

            offset = length * (1 - progress)

            element.setAttribute("stroke-dashoffset", str(offset))

        else:

            element.style.opacity = progress

        if progress >= 1:

            break

        await aio.sleep(0.016)



    if length:

        element.removeAttribute("stroke-dasharray")

        element.removeAttribute("stroke-dashoffset")





async def animate_move(element, from_attrs, to_attrs, duration=2):

    """Animate moving an SVG element by interpolating attribute values."""

    start = time.time()

    for attr, start_val in from_attrs.items():

        element.setAttribute(attr, str(start_val))

    while True:

        now = time.time()

        progress = min(1, (now - start) / duration)

        for attr, start_val in from_attrs.items():

            end_val = to_attrs.get(attr)

            if end_val is not None:

                current = start_val + (end_val - start_val) * progress

                element.setAttribute(attr, str(current))

        if progress >= 1:

            break

        await aio.sleep(0.016)





async def wait_for_event(el, event_type, flags, flag_name):

    """Wait until a specific event occurs on an element."""

    fut = aio.Future()

    def event_handler(ev):

        el.unbind(event_type, event_handler)

        flags[flag_name] = True

        fut.set_result(None)

    el.bind(event_type, event_handler)

    await fut





def pick_voice(lang="en-US", male=True, voice=None):

    """

    Attempt to pick a suitable voice from speechSynthesis.

    1) If 'voice' (exact name) is specified, try to match that first.

    2) Otherwise, pick a voice matching 'lang' and 'male' or fallback.

    """

    voices = window.speechSynthesis.getVoices()



    # 1) If an exact voice name is provided, look for it first.

    if voice:

        for v in voices:

            if v.name == voice:

                return v



    # 2) Otherwise, try to match language, then guess male/female by name.

    #    This is very approximate and browser-dependent.

    candidate = None

    for v in voices:

        # Check language match.

        if v.lang and v.lang.startswith(lang):

            # If male is True, we try to find a voice that might contain 'Male' or 'M ' etc. in name.

            if male and ("male" in v.name.lower() or "m " in v.name.lower()):

                return v

            # If we haven't chosen a candidate yet, store it (fallback).

            if not candidate:

                candidate = v



    # Fallback to the candidate or None (system default).

    return candidate





async def execute_commands(commands):

    flags = {}



    for key in commands:

        details = commands[key]

        action = details.get("action")



        if action == "svg":

            # Create the SVG element.

            cmd_type = details.get("command")

            ns = "http://www.w3.org/2000/svg"

            element = document.createElementNS(ns, cmd_type)

            

            # Set attributes (skip our special keys).

            for attr, value in details.items():

                if attr in ("action", "command", "text", "duration", 

                            "font-family", "font-size", "lang", "male", 

                            "pitch", "rate", "volume", "voice"):

                    continue

                element.setAttribute(attr, str(value))

            if "text" in details:

                element.textContent = details["text"]



            # For text elements, apply default font styles if not provided.

            if cmd_type == "text":

                font_family = details.get("font-family", "Patrick Hand, cursive")

                font_size   = details.get("font-size", "24px")

                fill_color  = details.get("fill", "black")

                element.style.fontFamily = font_family

                element.style.fontSize = font_size

                element.style.fill = fill_color



            # Ensure the element is clickable.

            if not element.hasAttribute("pointer-events"):

                element.setAttribute("pointer-events", "all")



            svg_elem = document.getElementById("mysvg")

            if svg_elem:

                svg_elem.appendChild(element)

            else:

                print("SVG container not found in the DOM.")



            # Animate drawing.

            anim_duration = float(details.get("duration", 2))

            await animate_draw(element, duration=anim_duration)



        elif action == "wait":

            # Wait for an event (e.g., click) on an element.

            obj_id = details.get("objectId")

            event_type = details.get("event")

            flag_name = details.get("flag")

            if obj_id and event_type and flag_name:

                flags[flag_name] = False

                el = document.getElementById(obj_id)

                if not el:

                    print(f"Element with id '{obj_id}' not found.")

                else:

                    await wait_for_event(el, event_type, flags, flag_name)

            else:

                print("Wait command missing required keys: objectId, event, flag")



        elif action == "move":

            # Gradually move an SVG element.

            obj_id = details.get("objectId")

            if not obj_id:

                print("Move command missing objectId")

                continue

            element = document.getElementById(obj_id)

            if not element:

                print(f"Element with id '{obj_id}' not found for move.")

                continue

            from_attrs = details.get("from", {})

            to_attrs = details.get("to", {})

            duration = float(details.get("duration", 2))

            await animate_move(element, from_attrs, to_attrs, duration)



        elif action == "speak":

            # Extended speech parameters

            text   = details.get("text", "")

            lang   = details.get("lang", "en-US")

            male   = details.get("male", True)

            pitch  = float(details.get("pitch", 1))

            rate   = float(details.get("rate", 1))

            volume = float(details.get("volume", 1))

            voice_name = details.get("voice", None)



            utterance = window.SpeechSynthesisUtterance.new(text)

            utterance.lang   = lang

            utterance.pitch  = pitch

            utterance.rate   = rate

            utterance.volume = volume



            # Attempt to pick a suitable voice

            chosen_voice = pick_voice(lang=lang, male=male, voice=voice_name)

            if chosen_voice:

                utterance.voice = chosen_voice



            window.speechSynthesis.speak(utterance)



        elif action == "finish_speaking":

            # Wait until speechSynthesis is no longer speaking.

            while window.speechSynthesis.speaking:

                await aio.sleep(0.1)



        else:

            print(f"Unknown action: {action}")

            

commands = {

    # 1. Headline

    "cmd1": {

        "action": "speak",

        "text": "Welcome! Today, we will learn about consumer surplus."

    },

    "cmd2": {

        "action": "svg",

        "command": "text",

        "id": "headline",

        "x": 180,

        "y": 30,

        "fill": "black",

        "font-size": "24px",

        "font-weight": "bold",

        "text": "Understanding Consumer Surplus",

        "duration": 2

    },

    "cmd3": {

        "action": "finish_speaking"

    },



    # 2. Draw the axes

    "cmd4": {

        "action": "speak",

        "text": "Let's start by drawing the axes. The horizontal axis represents quantity, and the vertical axis represents price."

    },

    "cmd5": {

        "action": "svg",

        "command": "line",

        "id": "xAxis",

        "x1": 80, "y1": 320, "x2": 520, "y2": 320,

        "stroke": "black", "stroke-width": 2,

        "duration": 2

    },

    "cmd6": {

        "action": "svg",

        "command": "line",

        "id": "yAxis",

        "x1": 80, "y1": 320, "x2": 80, "y2": 50,

        "stroke": "black", "stroke-width": 2,

        "duration": 2

    },

    # Mark the axes

    "cmd7": {

        "action": "svg",

        "command": "text",

        "id": "xLabel",

        "x": 500, "y": 340,

        "fill": "black", "font-size": "18px",

        "text": "Quantity", "duration": 2

    },

    "cmd8": {

        "action": "svg",

        "command": "text",

        "id": "yLabel",

        "x": 50, "y": 60,

        "fill": "black", "font-size": "18px",

        "text": "Price", "duration": 2

    },

    "cmd9": {

        "action": "finish_speaking"

    },



    # 3. Draw the demand curve (corrected slope)

    "cmd10": {

        "action": "speak",

        "text": "Now, we draw the demand curve in red. It slopes downward because as prices decrease, consumers buy more."

    },

    "cmd11": {

        "action": "svg",

        "command": "line",

        "id": "demandCurve",

        "x1": 100, "y1": 100, "x2": 400, "y2": 300,  # Corrected slope

        "stroke": "red", "stroke-width": 2,

        "duration": 2

    },

    "cmd12": {

        "action": "svg",

        "command": "text",

        "id": "demandLabel",

        "x": 410, "y": 300,

        "fill": "red", "font-size": "16px",

        "text": "Demand", "duration": 2

    },

    "cmd13": {

        "action": "finish_speaking"

    },



    # 4. Draw the supply curve (corrected slope)

    "cmd14": {

        "action": "speak",

        "text": "Next, we add the supply curve in green. It slopes upward because higher prices encourage producers to sell more."

    },

    "cmd15": {

        "action": "svg",

        "command": "line",

        "id": "supplyCurve",

        "x1": 100, "y1": 300, "x2": 400, "y2": 100,  # Corrected slope

        "stroke": "green", "stroke-width": 2,

        "duration": 2

    },

    "cmd16": {

        "action": "svg",

        "command": "text",

        "id": "supplyLabel",

        "x": 410, "y": 100,

        "fill": "green", "font-size": "16px",

        "text": "Supply", "duration": 2

    },

    "cmd17": {

        "action": "finish_speaking"

    },



    # 5. Show market equilibrium

    "cmd18": {

        "action": "speak",

        "text": "The point where supply and demand intersect is called market equilibrium. It determines the price and quantity."

    },

    "cmd19": {

        "action": "svg",

        "command": "line",

        "id": "equilibriumLine",

        "x1": 80, "y1": 200, "x2": 420, "y2": 200,

        "stroke": "black", "stroke-dasharray": "5,5", "stroke-width": 2,

        "duration": 2

    },

    "cmd20": {

        "action": "svg",

        "command": "text",

        "id": "equilibriumLabel",

        "x": 430, "y": 205,

        "fill": "black", "font-size": "16px",

        "text": "Equilibrium Price", "duration": 2

    },

    "cmd21": {

        "action": "finish_speaking"

    },



    # 6. Explain consumer surplus (corrected shading)

    "cmd22": {

        "action": "speak",

        "text": "Consumer surplus is the area between the demand curve and the market price. It represents the extra benefit consumers get."

    },

    "cmd23": {

        "action": "svg",

        "command": "path",

        "id": "consumerSurplusArea",

        # Corrected coordinates for the shaded area

        "d": "M100,100 L100,200 L250,200 Z",  

        "stroke": "none",

        "fill": "rgba(255, 0, 0, 0.3)",

        "duration": 2

    },

    "cmd24": {

        "action": "svg",

        "command": "text",

        "id": "csLabel",

        "x": 110, "y": 150,

        "fill": "red", "font-size": "16px",

        "text": "Consumer Surplus", "duration": 2

    },

    "cmd25": {

        "action": "finish_speaking"

    },



    # 7. Conclusion

    "cmd26": {

        "action": "speak",

        "text": (

            "Consumer surplus helps us understand the extra value buyers get from market transactions. "

            "It shows how much more consumers were willing to pay compared to what they actually pay."

        )

    },

    "cmd27": {

        "action": "finish_speaking"

    }

}





# Create the SVG container.

if not document.getElementById("mysvg"):

    document.body <= svg.svg(id="mysvg", width="600", height="400")



aio.run(execute_commands(commands)


