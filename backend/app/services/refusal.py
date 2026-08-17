"""Is this text an answer, or an AI explaining why it couldn't answer?

Two real incidents made this module exist:

  * "No file appears to be attached to this chat — the uploads folder is empty." was
    accepted as an answer, stored, CACHED, and then served to the same student 15 more
    times. One failed upload became a permanently wrong answer for the whole class.
  * Test fixtures posted through /assist during development ended up in the class cache
    of the dev database and were served to a real upload of a real question bank.

The second one is a process problem (a dev cache now starts empty and MOCK answers are
never cached). The first is structural: an AI that couldn't see the paper still replies
politely, in fluent markdown, and nothing downstream can tell it from a real answer —
except the words it uses. So we look at the words.

Deliberately conservative: match only phrasings that are ABOUT the failure itself, near
the start of the text, where a refusal states its business. A real answer that happens to
discuss missing data three paragraphs in must never be rejected.
"""
import re

# How much of the head of the text a refusal marker may appear in. Refusals lead with the
# problem; answers lead with the answer.
_HEAD = 400

_MARKERS = [
    r"no (?:file|document|paper|pdf|attachment|image)s? (?:appears? to be|is|was|were|has been)? ?\battach",
    r"(?:file|document|attachment) (?:is|seems to be|appears to be) (?:missing|empty|corrupt)",
    r"uploads? folder is empty",
    r"i (?:can(?:no|')t|cannot|am unable to|couldn'?t) (?:see|find|open|read|access) (?:the|any|your) "
    r"(?:file|document|paper|pdf|attachment|image|figure|question)",
    r"(?:the|your) (?:question|content|image|figure) (?:.{0,40})?(?:is|are|appears?) missing",
    r"please (?:re-?)?(?:upload|attach|provide|paste|share) (?:the|your|a) "
    r"(?:file|document|paper|pdf|question|image|figure)",
    r"could you (?:please )?(?:re-?)?(?:upload|attach|provide|share)",
    r"^NOT_FOUND\b",
    r"i don'?t see (?:a|any|the) (?:file|document|attachment|question)",
]
_PATTERN = re.compile("|".join(f"(?:{m})" for m in _MARKERS), re.IGNORECASE)

# Below this an "answer" is a shrug whatever its words ("Sure!", "I can help with that.").
MIN_ANSWER_CHARS = 40


def looks_like_a_refusal(text: str) -> str | None:
    """The matched phrase if this reads as a can't-answer, else None."""
    head = text.strip()[:_HEAD]
    m = _PATTERN.search(head)
    return m.group(0) if m else None
