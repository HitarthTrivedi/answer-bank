"""The routing agent: looks at ONE question and decides which answer type it is,
which decides which model chain solves it. LLM classification with a keyword
fallback so routing works even with zero keys."""
import json

from ..config import get_model_config
from . import providers

QTYPES = ("numerical", "code", "graph", "diagram", "theory")

_ROUTER_SYS = (
    "TASK: classify_question\n"
    "Classify ONE exam question into exactly one type:\n"
    "- numerical: requires calculation with a definite numeric/symbolic final answer\n"
    "- code: requires writing or analyzing a program/algorithm\n"
    "- graph: requires plotting/sketching a function, curve or data trend\n"
    "- diagram: requires drawing a structure (flowchart, architecture, ER, wireframe, labelled figure)\n"
    "- theory: explanation, definition, comparison, derivation in words\n"
    'Return STRICT JSON: {"qtype": "<one of the five>", "reason": "<15 words max>"}'
)

_KEYWORDS = [
    ("numerical", ["calculate", "compute", "find the value", "evaluate", "how many", "determine the",
                   "numerical", "solve for", "what is the value"]),
    ("code", ["write a program", "write code", "implement", "algorithm", "function that", "pseudo-code",
              "pseudocode", "program to", "code snippet", "time complexity of the following"]),
    ("graph", ["plot", "sketch the graph", "graph of", "draw the curve", "waveform", "characteristics curve"]),
    ("diagram", ["diagram", "flowchart", "draw the", "architecture of", "block schematic", "er model",
                 "wireframe", "structure of", "label the"]),
]


def heuristic_classify(text: str) -> dict:
    low = text.lower()
    for qtype, kws in _KEYWORDS:
        if any(k in low for k in kws):
            return {"qtype": qtype, "reason": f"keyword match ({qtype})"}
    return {"qtype": "theory", "reason": "no structural keywords; default reasoning answer"}


async def classify(text: str) -> dict:
    cfg = get_model_config()["router"]
    if not providers.provider_available(cfg["provider"]):
        return heuristic_classify(text)
    try:
        resp = await providers.chat(
            cfg["provider"],
            cfg["model"],
            [
                {"role": "system", "content": _ROUTER_SYS},
                {"role": "user", "content": text[:4000]},
            ],
        )
        data = providers.extract_json(resp)
        qtype = str(data.get("qtype", "")).lower().strip()
        if qtype not in QTYPES:
            return heuristic_classify(text)
        return {"qtype": qtype, "reason": str(data.get("reason", ""))[:300]}
    except (providers.LLMError, json.JSONDecodeError, AttributeError):
        return heuristic_classify(text)
