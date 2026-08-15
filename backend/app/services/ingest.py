"""File → raw text + the figures embedded in it.

Figures matter because a question bank full of "from the graph in Fig. 3" is otherwise
answered blind — the AI never sees the graph and invents a confident wrong answer, which
is the worst possible failure for an exam document.

We do NOT interpret figures here. No OCR, no vision model, no cost. We keep the pixels
and their position, and the student's own browser AI reads them when it answers — it is
better at it than tesseract and it is already paid for.
"""
import io
import logging
import zipfile
from pathlib import Path

from fastapi import HTTPException

from ..config import get_settings

log = logging.getLogger("prism.ingest")

# What separates a figure from a bullet glyph, a rule or a logo is its SIZE ON THE PAGE,
# not its file size. Line-art — exactly what exam diagrams are — compresses to almost
# nothing, so a byte threshold would throw away the clearest circuit diagram while
# keeping a noisy JPEG watermark. Bytes are only a floor against 1x1 junk.
MIN_FIGURE_BYTES = 200
MIN_FIGURE_PX = 120

MAGIC = {
    "pdf": b"%PDF",
    "docx": b"PK\x03\x04",
    "png": b"\x89PNG",
    "jpg": b"\xff\xd8\xff",
}


def sniff_kind(data: bytes, claimed_ext: str) -> str:
    """Return the real file kind from content, cross-checked against the claimed extension."""
    ext = claimed_ext.lower().lstrip(".")
    if ext == "jpeg":
        ext = "jpg"
    if ext in ("txt", "md"):
        try:
            data.decode("utf-8")
            return "txt"
        except UnicodeDecodeError:
            raise HTTPException(400, "Text file is not valid UTF-8")
    magic = MAGIC.get(ext)
    if magic is None:
        raise HTTPException(400, f"Unsupported file type: .{ext}")
    if not data.startswith(magic):
        raise HTTPException(400, f"File content does not match its .{ext} extension")
    if ext == "docx":
        # a real docx is a zip containing [Content_Types].xml
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                if "[Content_Types].xml" not in z.namelist():
                    raise HTTPException(400, "Not a valid .docx archive")
        except zipfile.BadZipFile:
            raise HTTPException(400, "Not a valid .docx archive")
    return ext


def validate_upload(data: bytes, filename: str) -> str:
    s = get_settings()
    if len(data) > s.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"File exceeds {s.max_upload_mb} MB limit")
    if len(data) == 0:
        raise HTTPException(400, "Empty file")
    ext = Path(filename).suffix.lstrip(".").lower()
    if ext not in {e.strip() for e in s.allowed_extensions.split(",")}:
        raise HTTPException(400, f"Extension .{ext} not allowed")
    return sniff_kind(data, ext)


def extract_text(data: bytes, kind: str) -> str:
    return extract_document(data, kind)["text"]


def extract_document(data: bytes, kind: str) -> dict:
    """Returns {text, figures}. `figures` is a list of
    {bytes, ext, anchor} where `anchor` is the character offset in `text` that the figure
    sits nearest to — that offset is what later maps a figure onto a question."""
    if kind == "txt":
        return {"text": data.decode("utf-8"), "figures": []}
    if kind == "pdf":
        return _pdf_document(data)
    if kind == "docx":
        return _docx_document(data)
    if kind in ("png", "jpg"):
        # the upload IS the figure: no OCR, hand the whole thing to the browser AI
        return {"text": _image_text(data), "figures": [{"bytes": data, "ext": kind, "anchor": 0}]}
    raise HTTPException(400, f"Cannot extract text from kind '{kind}'")


def _usable_figure(raw: bytes) -> tuple[bool, str]:
    """Big enough to be a real figure? Returns (ok, extension)."""
    if len(raw) < MIN_FIGURE_BYTES:
        return False, ""
    try:
        from PIL import Image

        with Image.open(io.BytesIO(raw)) as im:
            # both dimensions must be reasonable AND the area substantial, so a thin
            # decorative rule (900x8) is rejected while a small diagram is kept
            if min(im.size) < MIN_FIGURE_PX or im.width * im.height < MIN_FIGURE_PX ** 2 * 2:
                return False, ""
            return True, "png" if im.format == "PNG" else "jpg"
    except Exception:
        return False, ""


def _pdf_document(data: bytes) -> dict:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    pages, figures, offset = [], [], 0
    for page in reader.pages:
        body = page.extract_text() or ""
        # anchor every figure on this page to where the page's text starts, so a figure
        # lands on a question from the same page rather than a neighbouring one
        try:
            for img in page.images:
                ok, ext = _usable_figure(img.data)
                if ok:
                    figures.append({"bytes": img.data, "ext": ext, "anchor": offset})
        except Exception as e:      # a malformed XObject must never fail the upload
            log.warning("could not read images on a page: %s", e)
        pages.append(body)
        offset += len(body) + 2     # the "\n\n" join below

    text = "\n\n".join(pages).strip()
    if len(text) < 40 * max(1, len(pages)) and len(text) < 200:
        raise HTTPException(
            422,
            "This PDF looks scanned (no text layer). Export it with OCR first, "
            "or paste the questions as text.",
        )
    return {"text": text, "figures": figures}


_BLIP = "{http://schemas.openxmlformats.org/drawingml/2006/main}blip"
_EMBED = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed"


def _docx_document(data: bytes) -> dict:
    import docx

    d = docx.Document(io.BytesIO(data))
    lines, figures, offset = [], [], 0
    rels = d.part.related_parts

    for para in d.paragraphs:
        # a paragraph can carry inline images; anchor them where the paragraph sits
        for blip in para._p.iter(_BLIP):
            rid = blip.get(_EMBED)
            part = rels.get(rid) if rid else None
            if part is None:
                continue
            ok, ext = _usable_figure(part.blob)
            if ok:
                figures.append({"bytes": part.blob, "ext": ext, "anchor": offset})
        if para.text.strip():
            lines.append(para.text)
            offset += len(para.text) + 1

    # tables become pipe-delimited text — the house style keeps tabular data AS a table
    for table in d.tables:
        for row in table.rows:
            row_text = " | ".join(cell.text for cell in row.cells)
            if row_text.strip():
                lines.append(row_text)
                offset += len(row_text) + 1

    return {"text": "\n".join(lines), "figures": figures}


def _image_text(data: bytes) -> str:
    try:
        import pytesseract
        from PIL import Image

        text = pytesseract.image_to_string(Image.open(io.BytesIO(data)))
        if not text.strip():
            raise HTTPException(422, "OCR found no text in this image")
        return text
    except ImportError:
        raise HTTPException(
            422,
            "Image OCR needs tesseract installed (brew install tesseract && pip install pytesseract). "
            "Until then, paste the questions as text.",
        )
