"""One thin client for the routing model.

This is the *only* place Prism calls a model, and it never produces an answer — it
reads a question and decides which of the student's browser AIs should answer it. That
job is a handful of tokens on a tiny free-tier model, so it stays cheap no matter how
many questions run through it.

Google AI Studio, Groq and OpenRouter all expose OpenAI-compatible /chat/completions, so
a single call shape covers all three. MOCK_LLM=true returns a canned routing decision so
the product runs and tests reproducibly with zero keys.
"""
import asyncio
import json
import logging
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

log = logging.getLogger("prism.providers")

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


async def chat(provider: str, model: str, messages: list[dict],
               json_mode: bool = False, params: dict | None = None) -> str:
    """`params` carries model-specific extras from models.json (e.g. gpt-oss takes
    `reasoning_effort`). If the endpoint rejects them we retry once with a plain body,
    so a model that doesn't know a knob degrades instead of failing the run."""
    s = get_settings()
    if s.mock_llm:
        return _mock_routing_response(messages)

    key = getattr(s, _KEY_ATTR.get(provider, ""), "")
    if not key:
        raise LLMError(f"No API key configured for provider '{provider}'")

    async with _pace_lock:
        wait = _last_call.get(provider, 0) + s.provider_min_interval_s - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        _last_call[provider] = time.monotonic()

    base: dict = {"model": model, "messages": messages, "temperature": 0.0}
    rich = dict(base, **(params or {}))
    if json_mode:
        rich["response_format"] = {"type": "json_object"}

    body = rich
    async with httpx.AsyncClient(timeout=s.llm_timeout_s) as client:
        for attempt in range(3):
            try:
                r = await client.post(
                    f"{BASES[provider]}/chat/completions",
                    headers={"Authorization": f"Bearer {key}"},
                    json=body,
                )
                if r.status_code == 400 and body is rich:
                    # an unsupported knob (reasoning_effort, json mode) — drop them all
                    # and try once more rather than losing the routing decision
                    log.warning("%s/%s rejected optional params (%s); retrying plain",
                                provider, model, r.text[:160])
                    body = base
                    continue
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
    for open_c, close_c in [("{", "}"), ("[", "]")]:
        start, end = text.find(open_c), text.rfind(close_c)
        if start != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                continue
    raise LLMError("Model response contained no parseable JSON")


# ---------------- mock mode ----------------


def _mock_routing_response(messages: list[dict]) -> str:
    """Deterministic routing so dev/tests don't need a key. Mirrors the keyword fallback
    so mock behaviour and key-less behaviour agree."""
    from .router_agent import heuristic_classify

    question = messages[-1]["content"] if messages else ""
    guess = heuristic_classify(question)
    return json.dumps({"qtype": guess["qtype"], "reason": "mock router"})
