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

# Question banks are frequently bulleted ("\u25a0 Q1. Implement..."), and a bullet glyph is
# not whitespace, so every anchored pattern below has to step over one.
_BULLET = r"^[\s\u25a0\u25aa\u2022\u25cf\u25e6\u2023\u2043\-\*\u2212\u2013]*"
# "Q7." / "Question 7)" — an explicit marker, which a list inside an answer never uses.
_Q_MARKER = re.compile(_BULLET + r"Q(?:uestion)?\s*\.?\s*(\d{1,3})\s*[\.\):]\s*(.*)", re.IGNORECASE)
# "7." / "7)" — a bare number: a question in a plain bank, but also every algorithm step.
_NUM_LINE = re.compile(_BULLET + r"(\d{1,3})\s*[\.\):]\s+(.*)")
# "7Define AI..." — no separator at all. This is what a SPREADSHEET exported to PDF looks
# like: the number is one cell and the question another, and the text layer just runs
# them together. Common enough to matter, ambiguous enough to be a last resort.
_NUM_GLUED = re.compile(r"^\s*(\d{1,3})([A-Za-z\"'“‘].*)$")
# "7" alone on a line, with the question on the line after — same spreadsheet exports,
# when the cell wrapped.
_NUM_ALONE = re.compile(r"^\s*(\d{1,3})\s*$")
# "...Encapsulation.2.Explain Software Engineering..." — some PDFs extract with no line
# breaks at all, so nothing is at the start of a line and every anchored pattern misses.
# Last resort only: scanning mid-line for numbers is how you accidentally split on "1.5".
_INLINE_NUM = re.compile(r"(?<![\d.])(\d{1,3})\.(?=[A-Z\"'“‘])")
_MARKS = re.compile(r"[\(\[]\s*(\d{1,3})\s*(?:marks?|M)\s*[\)\]]|\b(\d{1,3})\s*marks?\b", re.IGNORECASE)

_MARKER_CONFIDENCE = 3     # fewer explicit markers than this and they're incidental
_PREVIEW_CHARS = 110       # of each candidate, shown to the model
_MAX_CANDIDATES = 400      # sanity bound on one upload
_LOOKAHEAD = 3             # lines to search for text belonging to a bare number

# A row whose question lives in an image has no text at all. Dropping it loses exactly
# the diagram questions the figure pipeline exists for, so it is kept with this marker
# and the student fills it in (or deletes it) at the review step.
FIGURE_ONLY = "[This question's content is an image — check the attached figure, or type the question here.]"


# ---------------------------------------------------------------- candidates


def _candidates(raw: str) -> list[dict]:
    """Every line that *could* start a question, with where it starts.

    Four shapes, because question banks arrive in all of them — including spreadsheets
    exported to PDF, where the numbering column and the text column are glued together
    with no punctuation between them.
    """
    lines = raw.split("\n")
    offsets, pos = [], 0
    for line in lines:
        offsets.append(pos)
        pos += len(line) + 1

    out = []
    for i, line in enumerate(lines):
        for kind, pattern in (("marker", _Q_MARKER), ("number", _NUM_LINE), ("glued", _NUM_GLUED)):
            m = pattern.match(line)
            if m:
                out.append({"offset": offsets[i], "kind": kind, "num": int(m.group(1)),
                            "opening": (m.group(2) or "").strip()[:_PREVIEW_CHARS]})
                break
        else:
            m = _NUM_ALONE.match(line)
            if not m:
                continue
            # the cell wrapped: the question is on one of the next few lines
            ahead = next((lines[j].strip() for j in range(i + 1, min(i + 1 + _LOOKAHEAD, len(lines)))
                          if lines[j].strip()), "")
            out.append({"offset": offsets[i], "kind": "alone", "num": int(m.group(1)),
                        "opening": ahead[:_PREVIEW_CHARS] or FIGURE_ONLY})

    if len(out) < _MARKER_CONFIDENCE:
        # Almost nothing sits at the start of a line, which is what a PDF that extracted
        # as one long run looks like. Only take the mid-line scan if it genuinely finds
        # MORE than the anchored pass did — otherwise a perfectly good two-question bank
        # gets its candidates thrown away and the upload reports "no questions detected".
        inline = [{"offset": m.start(), "kind": "inline", "num": int(m.group(1)),
                   "opening": raw[m.end():m.end() + _PREVIEW_CHARS].strip()}
                  for m in _INLINE_NUM.finditer(raw)]
        if len(inline) > len(out):
            out = inline
    return out[:_MAX_CANDIDATES]


def _build(raw: str, kept: list[dict]) -> list[dict]:
    """Slice the document at the kept boundaries."""
    out = []
    for i, c in enumerate(kept):
        end = kept[i + 1]["offset"] if i + 1 < len(kept) else len(raw)
        body = " ".join(raw[c["offset"]:end].split())
        # Drop the leading "Q7." / "7." / "7" — the number is positional, not part of the
        # question. Whichever shape matches, keep only what followed it.
        for pattern in (_Q_MARKER, _NUM_LINE, _NUM_GLUED):
            m = pattern.match(body)
            if m:
                body = (m.group(2) or "").strip()
                break
        else:
            # a bare number with its text on a following line, an inline "7.Define", or
            # nothing at all — which means the question itself is a picture
            body = re.sub(r"^\s*\d{1,3}\s*\.?\s*", "", body)
        # a row with no text is a question whose content is a figure — keep it, marked,
        # rather than silently losing it
        out.append(_finish(body.strip() or FIGURE_ONLY, c["offset"], c.get("num")))
    return _recover_run_on_rows([q for q in out if len(q["text"]) >= 12])


# Row numbers a spreadsheet export can bury inside the previous row's text: "…Explain
# problem characteristics 7 8Write A* algorithm" is questions 6, 7 and 8, and only the
# first survives a line-anchored pass. A number is only treated as a row number when the
# next thing after it starts a new question — a capital, a quote, another row number, or
# the end of the text.
_ROW_NUMBER_FOLLOWS = re.compile(r"\s*(?:[A-Z\"“'‘]|\d|$)")
_RUNON_LIMIT = 20


def _split_at_row_number(text: str, number: int) -> tuple[str, str] | None:
    """Split `text` where `number` is used as a row number. None if it isn't in there."""
    padded = " " + text                       # so a leading "8Write" still has a boundary
    for m in re.finditer(rf"(?<=[\s.,;:!?\)\]\"”'’]){number}(?![\d.])", padded):
        if not _ROW_NUMBER_FOLLOWS.match(padded, m.end()):
            continue                          # "there are 8 apples" is prose, not a row
        return padded[1:m.start()].rstrip(), padded[m.end():].strip()
    return None


def _recover_run_on_rows(questions: list[dict]) -> list[dict]:
    """Recover questions that a run-on row swallowed.

    Only runs where the numbering *proves* something is missing: a jump from 6 to 9 means
    7 and 8 are somewhere, and the only place they can be is inside question 6's text. A
    contiguous run is left completely alone, which is what keeps this from second-guessing
    a bank that extracted perfectly.
    """
    out: list[dict] = []
    for i, q in enumerate(questions):
        n = q.get("number")
        nxt = questions[i + 1] if i + 1 < len(questions) else None
        stop = nxt.get("number") if nxt else None          # None = last row, open-ended
        if n is None or (stop is not None and stop <= n + 1):
            out.append(q)
            continue

        pieces: list[tuple[int, str]] = []
        text, num = q["text"], n
        while (stop is None or num + 1 < stop) and len(pieces) < _RUNON_LIMIT:
            found = _split_at_row_number(text, num + 1)
            if found is None:
                break
            head, text = found
            pieces.append((num, head))
            num += 1
        if not pieces:
            out.append(q)
            continue
        pieces.append((num, text))

        # spread the recovered rows across the span the original occupied, so figures
        # anchored by character offset still land on the right one
        end = nxt["offset"] if nxt else q["offset"] + max(len(q["text"]), 1)
        step = max((end - q["offset"]) // len(pieces), 1)
        for j, (number, body) in enumerate(pieces):
            out.append(_finish(body.strip() or FIGURE_ONLY, q["offset"] + j * step, number))
    return out


def _finish(text: str, offset: int = 0, number: int | None = None) -> dict:
    m = _MARKS.search(text)
    return {"text": text, "marks": int(m.group(1) or m.group(2)) if m else None,
            "offset": offset, "number": number}


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
    """No-model split, most-reliable shape first.

    Tiering matters: "Q1." is unambiguous, "1." is usually right, and "1Define" is a
    guess that would misfire on ordinary prose. Take the strongest signal the document
    actually offers and ignore the weaker ones — mixing them is what shreds a document.
    """
    cands = _candidates(raw)
    for tier in ("marker", "number", "inline"):
        hits = [c for c in cands if c["kind"] == tier]
        if len(hits) >= _MARKER_CONFIDENCE:
            return _build(raw, hits)
    # nothing punctuated: a spreadsheet export, so accept the glued/bare-number shapes
    return _build(raw, cands)


def _restore_numbered_gaps(cands: list[dict], kept: list[dict]) -> list[dict]:
    """Put back candidates the model dropped from inside a numbering run.

    The model judges candidates by their opening text, so a row whose question is nothing
    but a picture reads as empty and gets dropped — losing precisely the diagram questions
    this product goes to such lengths to answer. But a bank that runs 1…27 obviously has a
    10, so a missing number *inside the kept range* is restored rather than trusted away.

    Only inside the range, and only numbers not already present: numbered steps inside an
    answer either reuse numbers we already have or sit outside the run, so neither comes
    back through here.
    """
    numbers = [c["num"] for c in kept if c.get("num")]
    if len(numbers) < _MARKER_CONFIDENCE:
        return kept
    lo, hi, have = min(numbers), max(numbers), set(numbers)
    offsets = {c["offset"] for c in kept}
    extra = [c for c in cands
             if c.get("num") and lo < c["num"] < hi
             and c["num"] not in have and c["offset"] not in offsets]
    if not extra:
        return kept
    log.info("extractor restored %d numbered row(s) the model dropped", len(extra))
    return sorted(kept + extra, key=lambda c: c["offset"])


async def extract_questions(raw: str) -> list[dict]:
    cands = _candidates(raw)
    if not cands:
        return []
    kept = await _ai_select(cands)
    if not kept:
        return _dedupe(heuristic_extract(raw))
    return _dedupe(_build(raw, _restore_numbered_gaps(cands, kept)))


def _dedupe(questions: list[dict]) -> list[dict]:
    seen, out = set(), []
    for q in questions:
        # Two picture rows have identical placeholder text and are still two different
        # questions — collapsing them is the same silent loss the placeholder exists to
        # prevent, so only real text is deduplicated.
        if q["text"] == FIGURE_ONLY:
            out.append(q)
            continue
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
