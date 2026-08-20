"""Repair fenced blocks that lost their language on the way out of a chat window.

Gemini renders every code block under a "Code snippet" header with no language class in
the DOM, so a perfectly good ```mermaid diagram arrives as a bare ``` block — and the
deck shows a diagram as source code. The content itself is unambiguous: a block that
starts with `flowchart TD` is Mermaid whatever the fence says, and a JSON object with
"expressions" is a graphspec. Sniff and relabel. Runs on every answer that comes in, so
a student pasting by hand gets the same repair.
"""
import re

_MERMAID_START = re.compile(
    r"^\s*(?:%%\{.*?\}%%\s*)?(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)\b"
    r"|^\s*(?:sequenceDiagram|erDiagram|classDiagram|stateDiagram(?:-v2)?|gantt|pie|"
    r"mindmap|journey|gitGraph|timeline|quadrantChart|requirementDiagram|C4Context)\b",
    re.IGNORECASE,
)
_GRAPHSPEC_HINT = re.compile(r'^\s*\{[\s\S]*"(?:expressions|xrange)"', re.IGNORECASE)
_FENCE = re.compile(r"```([^\n`]*)\n([\s\S]*?)```", re.MULTILINE)
# the label Gemini's UI prints above a code block, which the scraper faithfully kept
_GEMINI_LABEL = re.compile(r"^[ \t]*Code snippet[ \t]*\n", re.MULTILINE)


def sniff(body: str) -> str | None:
    if _MERMAID_START.search(body):
        return "mermaid"
    if _GRAPHSPEC_HINT.search(body):
        return "graphspec"
    return None


def repair(markdown: str) -> str:
    """Relabel language-less fences whose content gives them away; drop UI chrome."""
    markdown = _GEMINI_LABEL.sub("", markdown)

    def fix(m: re.Match) -> str:
        lang, body = m.group(1).strip(), m.group(2)
        if lang:
            return m.group(0)
        guess = sniff(body)
        return f"```{guess}\n{body}```" if guess else m.group(0)

    return _FENCE.sub(fix, markdown)
