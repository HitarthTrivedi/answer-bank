"""File → raw text. Validates by magic bytes (never trusts extensions/filenames),
caps size, and degrades gracefully when OCR isn't available."""
import io
import zipfile
from pathlib import Path

from fastapi import HTTPException

from ..config import get_settings

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
    if kind == "txt":
        return data.decode("utf-8")
    if kind == "pdf":
        return _pdf_text(data)
    if kind == "docx":
        return _docx_text(data)
    if kind in ("png", "jpg"):
        return _image_text(data)
    raise HTTPException(400, f"Cannot extract text from kind '{kind}'")


def _pdf_text(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    pages = [(page.extract_text() or "") for page in reader.pages]
    text = "\n\n".join(pages).strip()
    if len(text) < 40 * max(1, len(pages)) and len(text) < 200:
        # near-empty text layer => scanned PDF
        raise HTTPException(
            422,
            "This PDF looks scanned (no text layer). Export it with OCR first, "
            "or paste the questions as text.",
        )
    return text


def _docx_text(data: bytes) -> str:
    import docx

    d = docx.Document(io.BytesIO(data))
    parts = [p.text for p in d.paragraphs]
    for table in d.tables:
        for row in table.rows:
            parts.append(" | ".join(cell.text for cell in row.cells))
    return "\n".join(p for p in parts if p.strip())


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
