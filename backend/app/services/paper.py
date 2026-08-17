"""What a question needs from the paper it came out of.

Two questions get asked about every row, in two different places, so they live here
rather than in whichever router happened to need them first:

  is_visual(q)               — does this question point at something you have to *see*?
                               Drives how the deck groups questions for the student.
  answered_from_document(q)  — should the AI read the original file rather than our
                               extracted text? Drives how the extension answers it.

They are not the same question. Nearly every question in an uploaded paper is answered
from the document, because the file is a better copy of the question than our extraction
is. Only some of them are *about* a picture.
"""
from pathlib import Path

from . import extractor

# Formats where the file itself can hold something our text extraction cannot: figures,
# graphs, circuits, scanned pages, spreadsheet layouts. A .txt has none of that, so
# attaching it would buy an upload's worth of latency and nothing else.
_VISUAL_SOURCES = {".pdf", ".docx", ".png", ".jpg", ".jpeg"}

# Below this, a question's extracted text is too thin to quote as a locator — usually a
# stub, or a placeholder for a row that was pure image.
_QUOTABLE_CHARS = 25

# Answer types whose whole content is a picture, whatever the wording says.
_VISUAL_TYPES = {"graph", "diagram"}


def is_visual(q) -> bool:
    """Is the substance of this question a diagram, graph, table or image?

    Used to group the deck. A student going through a bank wants these separated: they
    are the ones worth checking, because they're the ones where a wrong reading of the
    paper produces a confident wrong answer instead of an obvious blank.
    """
    return (q.text.startswith(extractor.FIGURE_ONLY[:24])
            or bool(q.figures)
            or extractor.mentions_a_figure(q.text)
            or (q.qtype or "") in _VISUAL_TYPES)


def number_is_unique(q) -> bool:
    """Does this question's number point at exactly one question in the paper?

    Spreadsheet exports and multi-section papers restart their numbering, and "answer
    question 11" against two question 11s is a coin toss.
    """
    if q.source_number is None:
        return False
    return sum(1 for other in q.project.questions
               if other.source_number == q.source_number) == 1


def answered_from_document(q) -> bool:
    """Should this question be answered against the uploaded paper itself?

    Yes, for every question in a paper we still have — not only the ones that name a
    figure. The document is simply a better copy of the question than our extraction is:
    it carries the figures, the tables, the sub-parts and the original wording, and the
    model reading it decides which picture belongs to which question far better than any
    anchoring heuristic could. Extraction is then only responsible for *how many*
    questions there are, never for their content.

    The exceptions are the cases where the file adds nothing (pasted text, .txt) or where
    we could not tell the AI which question we mean.
    """
    path = Path(q.project.source_path or "")
    if not q.project.source_path or not path.exists():
        return False              # pasted text — there is no paper to hand over
    if path.suffix.lower() not in _VISUAL_SOURCES:
        return False              # plain text: the extraction already is the document
    if q.source_number is not None:
        return True               # locatable by its own number in the file
    # no number: we can still quote the question — unless it was a pure-image row, in
    # which case only an attached figure can carry it.
    if q.text.startswith(extractor.FIGURE_ONLY[:24]):
        return False
    return len(q.text.strip()) >= _QUOTABLE_CHARS
