"""One thin client for every provider. Google AI Studio, Groq and OpenRouter all expose
OpenAI-compatible /chat/completions endpoints, so a single httpx call shape covers them.

Also holds MOCK mode: deterministic canned responses so the entire product runs and
demos with zero API keys (and tests stay reproducible).
"""
import asyncio
import json
import re
import time

import httpx

from ..config import get_settings

BASES = {
    "google": "https://generativelanguage.googleapis.com/v1beta/openai",
    "groq": "https://api.groq.com/openai/v1",
    "openrouter": "https://openrouter.ai/api/v1",
}

_KEY_ATTR = {"google": "google_api_key", "groq": "groq_api_key", "openrouter": "openrouter_api_key"}

# global pacing: never hit the same provider faster than provider_min_interval_s
_last_call: dict[str, float] = {}
_pace_lock = asyncio.Lock()


def provider_available(provider: str) -> bool:
    s = get_settings()
    if s.mock_llm:
        return True
    return bool(getattr(s, _KEY_ATTR.get(provider, ""), ""))


class LLMError(Exception):
    pass


async def chat(provider: str, model: str, messages: list[dict], json_mode: bool = False) -> str:
    s = get_settings()
    if s.mock_llm:
        return _mock_response(messages, json_mode)

    key = getattr(s, _KEY_ATTR.get(provider, ""), "")
    if not key:
        raise LLMError(f"No API key configured for provider '{provider}'")

    async with _pace_lock:
        wait = _last_call.get(provider, 0) + s.provider_min_interval_s - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        _last_call[provider] = time.monotonic()

    body: dict = {"model": model, "messages": messages, "temperature": 0.3}
    if json_mode:
        body["response_format"] = {"type": "json_object"}

    async with httpx.AsyncClient(timeout=s.llm_timeout_s) as client:
        for attempt in range(3):
            try:
                r = await client.post(
                    f"{BASES[provider]}/chat/completions",
                    headers={"Authorization": f"Bearer {key}"},
                    json=body,
                )
                if r.status_code == 429 or r.status_code >= 500:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue
                r.raise_for_status()
                content = r.json()["choices"][0]["message"]["content"]
                if not content:
                    raise LLMError(f"{provider}/{model} returned empty content")
                return content
            except httpx.HTTPError as e:
                if attempt == 2:
                    raise LLMError(f"{provider}/{model} failed: {e}") from e
                await asyncio.sleep(2 ** (attempt + 1))
    raise LLMError(f"{provider}/{model} exhausted retries (rate limited)")


def extract_json(text: str):
    """Models wrap JSON in prose/fences constantly; dig it out robustly."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # last resort: first {...} or [...] span
    for open_c, close_c in [("{", "}"), ("[", "]")]:
        start = text.find(open_c)
        end = text.rfind(close_c)
        if start != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                continue
    raise LLMError("Model response contained no parseable JSON")


# ---------------- mock mode ----------------

_MOCK_BY_TYPE = {
    "numerical": (
        "**Given:** A body accelerates uniformly from rest.\n\n"
        "**Step 1 — identify the relation**\n\n"
        "$$v = u + at$$\n\n"
        "**Step 2 — substitute** with $u = 0$, $a = 2\\ \\text{m/s}^2$, $t = 5\\ \\text{s}$:\n\n"
        "$$v = 0 + 2 \\times 5 = 10\\ \\text{m/s}$$\n\n"
        "FINAL: 10 m/s\n\n"
        "```verify\n0 + 2*5\n```\n"
    ),
    "code": (
        "**Approach:** iterative two-pointer reversal, $O(n)$ time, $O(1)$ space.\n\n"
        "```python\ndef reverse_list(head):\n    prev = None\n    while head:\n        head.next, prev, head = prev, head, head.next\n    return prev\n```\n\n"
        "**Why it works:** each iteration re-points one node backwards; `prev` ends as the new head.\n"
    ),
    "graph": (
        "**Behaviour:** the function rises steeply for $x > 0$ and approaches the axis for $x < 0$.\n\n"
        "```graphspec\n"
        '{"title": "Exponential growth vs decay", "xlabel": "x", "ylabel": "y",'
        ' "xrange": [-3, 3], "expressions": [{"expr": "exp(x)", "label": "e^x"},'
        ' {"expr": "exp(-x)", "label": "e^-x"}]}\n'
        "```\n\n**Reading the graph:** the curves mirror each other about the y-axis and intersect at $(0, 1)$.\n"
    ),
    "diagram": (
        "**Architecture:** a classic three-tier split keeps presentation, logic and storage independent.\n\n"
        "```mermaid\nflowchart TD\n    A[Client / Browser] --> B[Application Server]\n    B --> C[(Database)]\n    B --> D[Cache]\n```\n\n"
        "**Key point:** each tier scales and fails independently, which is the whole argument for the split.\n"
    ),
    "theory": (
        "**Definition:** normalization organizes relational data to remove redundancy.\n\n"
        "**Main points:**\n\n"
        "1. **1NF** — atomic values, no repeating groups.\n"
        "2. **2NF** — no partial dependency on a composite key.\n"
        "3. **3NF** — no transitive dependency on non-key attributes.\n\n"
        "**Conclusion:** most schemas stop at 3NF; further forms trade write simplicity for read joins.\n"
    ),
}


def _mock_response(messages: list[dict], json_mode: bool) -> str:
    joined = "\n".join(m.get("content", "") for m in messages)
    if "TASK: extract_questions" in joined:
        # mock extractor defers to the heuristic — return empty list so caller falls back
        return "[]"
    if "TASK: classify_question" in joined:
        low = messages[-1].get("content", "").lower()  # classify the QUESTION, not the instructions
        for t, kws in [
            ("numerical", ["calculate", "find the", "compute", "determine the value", "solve for"]),
            ("code", ["program", "code", "function", "algorithm", "implement"]),
            ("graph", ["plot", "graph", "curve", "sketch"]),
            ("diagram", ["diagram", "draw", "architecture", "flowchart", "block"]),
        ]:
            if any(k in low for k in kws):
                return json.dumps({"qtype": t, "reason": f"mock keyword match: {t}"})
        return json.dumps({"qtype": "theory", "reason": "mock default"})
    if "TASK: explain_newbie" in joined:
        return (
            "**In plain words:** imagine explaining this to a friend who missed the lecture.\n\n"
            "The answer above works because each step only uses one small idea at a time. "
            "Start from what is given, apply the single rule that connects it to what is asked, "
            "and keep units/names consistent. If you can re-tell the answer as a story of "
            "'given → rule → result', you understand it."
        )
    # solver: pick canned answer by declared question type
    m = re.search(r"QUESTION_TYPE: (\w+)", joined)
    qtype = m.group(1) if m else "theory"
    return _MOCK_BY_TYPE.get(qtype, _MOCK_BY_TYPE["theory"])
