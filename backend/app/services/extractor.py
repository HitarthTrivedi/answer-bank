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
    """Numbered-line splitter. Works on the common '1. ...' / 'Q2) ...' layouts.

    Each question also carries `offset`, the character position where it began. That is
    what lets a figure extracted from the same part of the file find the right question.
    """
    questions: list[dict] = []
    current: list[str] | None = None
    start = 0
    pos = 0
    for line in raw.split("\n"):
        m = _Q_LINE.match(line)
        if m and m.group(2).strip():
            if current:
                questions.append(_finish(current, start))
            current, start = [m.group(2).strip()], pos
        elif current is not None and line.strip():
            current.append(line.strip())
        elif current is not None and not line.strip() and len(current) > 6:
            questions.append(_finish(current, start))
            current = None
        pos += len(line) + 1
    if current:
        questions.append(_finish(current, start))
    return [q for q in questions if len(q["text"]) >= 12]


def _finish(lines: list[str], offset: int = 0) -> dict:
    text = " ".join(lines).strip()
    marks = None
    m = _MARKS.search(text)
    if m:
        marks = int(m.group(1) or m.group(2))
    return {"text": text, "marks": marks, "offset": offset}


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


_FIGURE_HINT = re.compile(
    r"\b(fig(?:ure)?\.?\s*\d|the (?:above|below|following|given) (?:figure|diagram|graph|table|circuit)"
    r"|(?:figure|diagram|graph|table|circuit|waveform|network) (?:above|below|shown|given)"
    r"|refer to the (?:figure|diagram|graph|table)|shown in the (?:figure|diagram|graph)"
    r"|from the (?:graph|figure|diagram|table)|as shown)\b",
    re.IGNORECASE,
)


def mentions_a_figure(text: str) -> bool:
    """Does this question point at something the student can see and the AI cannot?

    Used to warn at the review step. A question that references a figure it hasn't got
    doesn't fail loudly — the AI writes a confident answer about a graph it never saw —
    so flagging it is the difference between a wrong answer and a fixable one.
    """
    return bool(_FIGURE_HINT.search(text))
