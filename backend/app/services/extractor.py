"""Raw text → structured questions [{text, marks}].

Deterministic on purpose. This server calls no model, so extraction is a numbered-line
splitter — which is also *faster* and more predictable than an LLM pass, and the student
reviews and edits the list before answering starts anyway. Extraction is never silently
trusted, so a regex miss costs one edit, not a wrong answer.
"""
import re

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


def extract_questions(raw: str) -> list[dict]:
    return _dedupe(heuristic_extract(raw))


def _dedupe(questions: list[dict]) -> list[dict]:
    seen, out = set(), []
    for q in questions:
        key = re.sub(r"\s+", " ", q["text"].lower())[:200]
        if key not in seen:
            seen.add(key)
            out.append(q)
    return out
