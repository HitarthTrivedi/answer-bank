"""Raw text → structured questions [{text, marks}].

Two engines: an LLM pass (better at messy layouts) with a regex heuristic as both
fallback and zero-key path. Whatever comes out, the student reviews/edits the list
before answering starts — extraction is never silently trusted.
"""
import re

from ..config import get_model_config
from . import providers

MAX_CHUNK = 9000  # chars per LLM extraction call

_EXTRACT_SYS = (
    "TASK: extract_questions\n"
    "You extract exam/assignment questions from raw question-bank text.\n"
    "Return STRICT JSON: an array of objects {\"text\": string, \"marks\": integer or null}.\n"
    "Rules: keep each question's full text including sub-parts (a), (b)...; strip numbering "
    "prefixes like 'Q1.' or '3)'; capture marks from patterns like '(5 marks)', '[10M]', '5M'; "
    "ignore headers, footers, instructions, course codes. No commentary — JSON only."
)

_Q_LINE = re.compile(r"^\s*(?:Q(?:uestion)?\s*\.?\s*)?(\d{1,3})\s*[\.\):]\s+(.*)", re.IGNORECASE)
_MARKS = re.compile(r"[\(\[]\s*(\d{1,3})\s*(?:marks?|M)\s*[\)\]]|\b(\d{1,3})\s*marks?\b", re.IGNORECASE)


def heuristic_extract(raw: str) -> list[dict]:
    """Numbered-line splitter. Works on the common '1. ...' / 'Q2) ...' layouts."""
    questions: list[dict] = []
    current: list[str] | None = None
    for line in raw.splitlines():
        m = _Q_LINE.match(line)
        if m and m.group(2).strip():
            if current:
                questions.append(_finish(current))
            current = [m.group(2).strip()]
        elif current is not None and line.strip():
            current.append(line.strip())
        elif current is not None and not line.strip() and len(current) > 6:
            questions.append(_finish(current))
            current = None
    if current:
        questions.append(_finish(current))
    return [q for q in questions if len(q["text"]) >= 12]


def _finish(lines: list[str]) -> dict:
    text = " ".join(lines).strip()
    marks = None
    m = _MARKS.search(text)
    if m:
        marks = int(m.group(1) or m.group(2))
    return {"text": text, "marks": marks}


async def extract_questions(raw: str) -> list[dict]:
    cfg = get_model_config()["extractor"]
    if not providers.provider_available(cfg["provider"]):
        return heuristic_extract(raw)

    chunks = _chunk(raw)
    out: list[dict] = []
    try:
        for chunk in chunks:
            resp = await providers.chat(
                cfg["provider"],
                cfg["model"],
                [
                    {"role": "system", "content": _EXTRACT_SYS},
                    {"role": "user", "content": chunk},
                ],
            )
            data = providers.extract_json(resp)
            if isinstance(data, list):
                for item in data:
                    text = str(item.get("text", "")).strip()
                    if len(text) >= 12:
                        marks = item.get("marks")
                        out.append({"text": text, "marks": int(marks) if marks else None})
    except providers.LLMError:
        out = []
    if not out:  # LLM failed or returned nothing → heuristic saves the upload
        out = heuristic_extract(raw)
    return _dedupe(out)


def _chunk(raw: str) -> list[str]:
    if len(raw) <= MAX_CHUNK:
        return [raw]
    chunks, buf, size = [], [], 0
    for line in raw.splitlines(keepends=True):
        if size + len(line) > MAX_CHUNK and buf:
            chunks.append("".join(buf))
            buf, size = [], 0
        buf.append(line)
        size += len(line)
    if buf:
        chunks.append("".join(buf))
    return chunks


def _dedupe(questions: list[dict]) -> list[dict]:
    seen, out = set(), []
    for q in questions:
        key = re.sub(r"\s+", " ", q["text"].lower())[:200]
        if key not in seen:
            seen.add(key)
            out.append(q)
    return out
