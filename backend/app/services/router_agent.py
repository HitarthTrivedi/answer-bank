"""Looks at ONE question and decides which answer type it is, which decides which AI
site the extension sends it to and which answer structure the prompt demands.

Keyword-based, no model call. Routing only has to be good enough to pick a prompt
shape and a target tab; the student can see the type on every answer card and
regenerate if it's wrong.
"""

QTYPES = ("numerical", "code", "graph", "diagram", "theory")

_KEYWORDS = [
    ("numerical", ["calculate", "compute", "find the value", "evaluate", "how many", "determine the",
                   "numerical", "solve for", "what is the value"]),
    ("code", ["write a program", "write code", "implement", "algorithm", "function that", "pseudo-code",
              "pseudocode", "program to", "code snippet", "time complexity of the following"]),
    ("graph", ["plot", "sketch the graph", "graph of", "draw the curve", "waveform", "characteristics curve"]),
    ("diagram", ["diagram", "flowchart", "draw the", "architecture of", "block schematic", "er model",
                 "wireframe", "structure of", "label the"]),
]


def classify(text: str) -> dict:
    low = text.lower()
    for qtype, kws in _KEYWORDS:
        if any(k in low for k in kws):
            return {"qtype": qtype, "reason": f"keyword match ({qtype})"}
    return {"qtype": "theory", "reason": "no structural keywords; default reasoning answer"}
