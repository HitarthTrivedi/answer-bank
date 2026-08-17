"""The "explain it simply" agent — the only place Prism's own AI writes prose.

Answers never come from here. They come from the student's own ChatGPT/Claude/Gemini,
which is the whole architecture: better models than any free API tier, paid for by a
subscription the student already has, and no inference cost to us.

An explanation is the one exception, and deliberately so. It is a short re-read of an
answer the student is already looking at, clicked on a whim, and often abandoned two
lines in. Making that open a browser tab, wait on a queue and burn one of the student's
free messages would cost more than the feature is worth — so this runs on the same small
free model that does the routing, and the browser stays out of it.

With no key configured it returns None and the caller falls back to a paste-it-yourself
prompt, exactly like everything else in the product.
"""
import logging

from ..config import get_model_config
from . import providers, solver

log = logging.getLogger("prism.explainer")

# An explanation is prose, not a classification: no JSON mode, and enough room that a
# reasoning model can think and still have budget left to write the answer.
_PARAMS = {"max_tokens": 2000}


async def explain(question: str, answer_md: str) -> str | None:
    """A beginner's version of an answer. None when no model is reachable."""
    cfg = get_model_config()
    chain = [cfg.get("explainer") or cfg["router"]] + cfg.get("router_fallbacks", [])
    messages = solver.build_explain_messages(question, answer_md)

    for cand in chain:
        if not providers.provider_available(cand["provider"]):
            continue
        try:
            text = await providers.chat(
                cand["provider"], cand["model"], messages,
                json_mode=False,                       # prose, whatever the entry says
                params={**(cand.get("params") or {}), **_PARAMS},
                models=cand.get("models"),
            )
            text = (text or "").strip()
            if len(text) >= 40:
                return text
            log.warning("explainer %s/%s returned %d chars; trying the next one",
                        cand["provider"], cand["model"], len(text))
        except Exception as e:
            log.warning("explainer %s/%s failed: %s", cand["provider"], cand["model"], e)
    return None
