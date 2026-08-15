"""Raw text → structured questions [{text, marks, offset}].

Splitting a question bank is harder than it looks. "1." starts a question — and also
starts every algorithm step and bullet list *inside* an answer. On a real 27-question
bank, a pure regex produced 83 fragments.

So the work is divided by what each side is good at:

  regex  finds every *candidate* boundary — cheap, exhaustive, no judgement
  the AI decides which candidates are real questions — judgement, no bulk text

That split matters for cost. Sending the whole document would be several calls per
upload; sending only the candidate openings is ONE small call, whatever the document's
size. With no key, or if the call fails, a two-tier heuristic takes over and the student
fixes any mistakes at the review step — extraction is never silently trusted either way.
"""
import logging
import re

from ..config import get_model_config
from . import providers

log = logging.getLogger("prism.extractor")

# "Q7." / "Question 7)" — an explicit marker, which a list inside an answer never uses.
_Q_MARKER = re.compile(r"^\s*Q(?:uestion)?\s*\.?\s*(\d{1,3})\s*[\.\):]\s*(.*)", re.IGNORECASE)
# "7." / "7)" — a bare number: a question in a plain bank, but also every algorithm step.
_NUM_LINE = re.compile(r"^\s*(\d{1,3})\s*[\.\):]\s+(.*)")
_MARKS = re.compile(r"[\(\[]\s*(\d{1,3})\s*(?:marks?|M)\s*[\)\]]|\b(\d{1,3})\s*marks?\b", re.IGNORECASE)

_MARKER_CONFIDENCE = 3     # fewer explicit markers than this and they're incidental
_PREVIEW_CHARS = 110       # of each candidate, shown to the model
_MAX_CANDIDATES = 400      # sanity bound on one upload


# ---------------------------------------------------------------- candidates


def _candidates(raw: str) -> list[dict]:
    """Every line that *could* start a question, with where it starts."""
    out, pos = [], 0
    for line in raw.split("\n"):
        m = _Q_MARKER.match(line)
        kind = "marker"
        if not m:
            m = _NUM_LINE.match(line)
            kind = "number"
        if m:
            out.append({
                "offset": pos,
                "kind": kind,
                "num": int(m.group(1)),
                "opening": (m.group(2) or "").strip()[:_PREVIEW_CHARS],
            })
        pos += len(line) + 1
    return out[:_MAX_CANDIDATES]


def _build(raw: str, kept: list[dict]) -> list[dict]:
    """Slice the document at the kept boundaries."""
    out = []
    for i, c in enumerate(kept):
        end = kept[i + 1]["offset"] if i + 1 < len(kept) else len(raw)
        body = " ".join(raw[c["offset"]:end].split())
        # drop the leading "Q7." / "7." — the number is positional, not part of the question
        body = _Q_MARKER.sub(r"\2", body, count=1) if body[:1].upper() == "Q" else _NUM_LINE.sub(r"\2", body, count=1)
        out.append(_finish(body.strip(), c["offset"]))
    return [q for q in out if len(q["text"]) >= 12]


def _finish(text: str, offset: int = 0) -> dict:
    m = _MARKS.search(text)
    return {"text": text, "marks": int(m.group(1) or m.group(2)) if m else None, "offset": offset}


# ---------------------------------------------------------------- the AI pass


_SPLIT_SYS = (
    "TASK: find_question_boundaries\n"
    "You are given the numbered openings of every line in a document that MIGHT start an "
    "exam question. Some genuinely start a question. Others are steps inside an answer "
    "(algorithm steps, numbered rules, bullet points, table rows, sub-parts of the "
    "previous question).\n\n"
    "Return the ids of ONLY the ones that start a real, separate exam question.\n"
    "Guidance:\n"
    "- A real question asks something: define, explain, compare, calculate, write, draw, "
    "apply, illustrate, prove, discuss, differentiate.\n"
    "- A step inside an answer continues a procedure or list: 'Place the node on OPEN', "
    "'If OPEN is empty, stop', 'Repeat until converged'. These are NOT questions.\n"
    "- If a document numbers questions explicitly (Q1, Q2), those are almost always the "
    "real ones and bare numbers between them are answer content.\n"
    "- Sub-parts like '(a)', '(b)' belong to the question above them — do not split them out.\n"
    "- When genuinely unsure, INCLUDE it: the student reviews the list and deleting a "
    "spare row is easier than noticing a missing question.\n\n"
    'Return STRICT JSON: {"questions": [<id>, <id>, ...]}'
)


async def _ai_select(candidates: list[dict]) -> list[dict] | None:
    """Ask the model which candidates are real questions. None if unavailable."""
    cfg = get_model_config()
    chain = [cfg.get("extractor") or cfg["router"]] + cfg.get("router_fallbacks", [])
    listing = "\n".join(f'{i}. [{c["kind"]}] {c["opening"]}' for i, c in enumerate(candidates))

    for cand in chain:
        if not providers.provider_available(cand["provider"]):
            continue
        try:
            resp = await providers.chat(
                cand["provider"], cand["model"],
                [{"role": "system", "content": _SPLIT_SYS},
                 {"role": "user", "content": listing}],
                json_mode=cand.get("json_mode", False),
                params=cand.get("params"),
                models=cand.get("models"),
            )
            ids = providers.extract_json(resp).get("questions")
            if not isinstance(ids, list) or not ids:
                continue
            wanted = sorted({int(x) for x in ids if str(x).lstrip("-").isdigit()})
            keep = [candidates[i] for i in wanted if 0 <= i < len(candidates)]
            if keep:
                log.info("extractor kept %d of %d candidates", len(keep), len(candidates))
                return keep
        except Exception as e:
            log.warning("extractor %s/%s failed: %s", cand["provider"], cand["model"], e)
            continue
    return None


# ---------------------------------------------------------------- fallback + entry point


def heuristic_extract(raw: str) -> list[dict]:
    """No-model split. Prefers explicit Q markers; falls back to bare numbers."""
    cands = _candidates(raw)
    markers = [c for c in cands if c["kind"] == "marker"]
    kept = markers if len(markers) >= _MARKER_CONFIDENCE else cands
    return _build(raw, kept)


async def extract_questions(raw: str) -> list[dict]:
    cands = _candidates(raw)
    if not cands:
        return []
    kept = await _ai_select(cands)
    return _dedupe(_build(raw, kept) if kept else heuristic_extract(raw))


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
