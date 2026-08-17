"""Endpoints for the Chrome extension.

There is no pairing flow. The extension runs a content script on the Prism web app's
own origin, so it reads the session the student is already signed in with — same origin,
same tokens, nothing to type. Installing the extension is the entire setup.

Work is handed out in **batches spread across distinct AI sites**: three questions, three
tabs, three different assistants, all answering at the same time. That is what keeps a
30-question bank from exhausting anyone's free message cap — it becomes 10 each rather
than 30 on one — and it cuts wall-clock time by roughly the batch size.

Each question still gets its own brand-new chat. Parallel across assistants is not the
same as batched into one thread, which is the failure this product exists to fix.
"""
import base64
import io
import logging
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from ..config import get_extension_config
from ..db import get_db
from ..models import Project, Question, User
from ..security import current_user
from ..services import extractor, solver
from ..services.queue import expire_leases

log = logging.getLogger("prism.extension")

# Figures ride along inside the batch payload as base64. Downscaled first: an AI reads a
# 1400px graph exactly as well as a 4000px one, and the smaller payload keeps the
# message hop to the content script quick.
MAX_FIGURE_PX = 1400
MAX_FIGURE_BYTES = 1_500_000

router = APIRouter(prefix="/api/extension", tags=["extension"])


# The extension folder, packaged on demand so a student never needs the repo.
EXTENSION_DIR = Path(__file__).resolve().parent.parent.parent.parent / "extension"
_SHIPPED = ("manifest.json", "background.js", "popup.html", "popup.js", "popup.css",
            "content/html2md.js", "content/driver.js", "content/bridge.js",
            "icons/16.png", "icons/48.png", "icons/128.png")


@router.get("/download")
def download_extension():
    """Zip of the extension, ready to unzip and load.

    Deliberately unauthenticated: this is client code with nothing secret in it — no keys,
    no prompts, no question banks (see the module docstring). Requiring a token here would
    only mean the download couldn't be a plain link.
    """
    missing = [f for f in _SHIPPED if not (EXTENSION_DIR / f).exists()]
    if missing:
        log.error("extension package incomplete: %s", missing)
        raise HTTPException(500, "Extension package is incomplete on the server")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name in _SHIPPED:
            z.write(EXTENSION_DIR / name, f"prism-extension/{name}")
    return Response(
        buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="prism-extension.zip"'},
    )


@router.get("/document/{project_id}")
def project_document(project_id: str, user: User = Depends(current_user),
                     db: Session = Depends(get_db)):
    """The originally uploaded file, for the extension to attach to a chat."""
    project = db.get(Project, project_id)
    if project is None or project.user_id != user.id:
        raise HTTPException(404, "Project not found")
    path = Path(project.source_path or "")
    if not project.source_path or not path.exists():
        raise HTTPException(404, "This bank was pasted as text — there is no source file")
    kind = path.suffix.lstrip(".").lower()
    media = {"pdf": "application/pdf",
             "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
             "png": "image/png", "jpg": "image/jpeg"}.get(kind, "application/octet-stream")
    return Response(path.read_bytes(), media_type=media, headers={
        "Content-Disposition": f'inline; filename="{project.source_filename or path.name}"'})


@router.get("/config")
def extension_config(_: User = Depends(current_user)):
    """Selectors, per-site strengths and batch size, fetched on every run.

    The hotfix channel: when chatgpt.com renames a button, edit
    backend/extension_selectors.json and every installed extension picks it up on its
    next run. Nobody reinstalls anything.
    """
    return get_extension_config()


def _waiting(db: Session, user: User, project_id: str | None = None):
    q = (db.query(Question)
         .join(Project, Question.project_id == Project.id)
         .filter(Project.user_id == user.id, Question.status == "assist_waiting"))
    if project_id:
        q = q.filter(Project.id == project_id)
    return q.order_by(Project.created_at, Question.idx)


@router.get("/projects")
def projects_needing_work(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Question banks with questions waiting on the student's own AI."""
    out = []
    for p in (db.query(Project).filter_by(user_id=user.id)
              .order_by(Project.created_at.desc()).all()):
        waiting = sum(1 for q in p.questions if q.status in ("assist_waiting", "assist_running"))
        if waiting or p.status == "processing":
            out.append({
                "id": p.id, "title": p.title, "status": p.status,
                "total": len(p.questions), "waiting": waiting,
                "answered": sum(1 for q in p.questions if q.status == "answered"),
            })
    return out


# Formats where the file itself can hold something our text extraction cannot: figures,
# graphs, circuits, scanned pages, spreadsheet layouts. A .txt has none of that, so
# attaching it would buy an upload's worth of latency and nothing else.
_VISUAL_SOURCES = {".pdf", ".docx", ".png", ".jpg", ".jpeg"}

# Below this, a question's extracted text is too thin to quote as a locator — usually a
# stub or a placeholder for a row that was pure image.
_QUOTABLE_CHARS = 25


def _number_is_unique(q: Question) -> bool:
    """Does this question's number point at exactly one question in the paper?"""
    if q.source_number is None:
        return False
    return sum(1 for other in q.project.questions
               if other.source_number == q.source_number) == 1


def _wants_the_document(q: Question) -> bool:
    """Should this question be answered against the uploaded paper itself?

    Yes, for every question in a paper we still have — not only the ones that name a
    figure. The document is simply a better copy of the question than our extraction is:
    it carries the figures, the tables, the sub-parts and the original wording, and the
    model reading it decides which picture belongs to which question far better than any
    anchoring heuristic could. Extraction is then only responsible for *how many*
    questions there are and what each is called, never for their content.

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


def _figure_payload(q: Question) -> list[dict]:
    """The question's figures, downscaled, base64'd, ready for the extension to paste
    into the chat. We never look at what they contain — the student's own AI reads them,
    which costs us nothing and is better than any OCR we could run."""
    out = []
    for fig in q.figures:
        path = Path(fig.path)
        if not path.exists():
            continue
        try:
            raw = path.read_bytes()
            from PIL import Image

            with Image.open(io.BytesIO(raw)) as im:
                if max(im.size) > MAX_FIGURE_PX or len(raw) > MAX_FIGURE_BYTES:
                    im = im.convert("RGB")
                    im.thumbnail((MAX_FIGURE_PX, MAX_FIGURE_PX), Image.LANCZOS)
                    buf = io.BytesIO()
                    im.save(buf, format="JPEG", quality=85)
                    raw = buf.getvalue()
                    mime = "image/jpeg"
                else:
                    mime = "image/png" if fig.ext == "png" else "image/jpeg"
            out.append({"id": fig.id, "mime": mime,
                        "data": base64.b64encode(raw).decode()})
        except Exception as e:
            log.warning("skipping unreadable figure %s: %s", fig.id, e)
    return out


def _assign(questions: list[Question], sites: list[str], size: int) -> list[tuple[Question, str]]:
    """Pick up to `size` questions, each on a *different* site.

    Pass 1 honours the router's per-question choice. Pass 2 fills any slot the first pass
    left empty, ignoring preference — an even spread across assistants matters more than
    a perfect match, because an exhausted free tier answers nothing at all.
    """
    chosen: list[tuple[Question, str]] = []
    used: set[str] = set()
    taken: set[str] = set()

    for q in questions:
        if len(chosen) >= size:
            break
        site = q.target_site
        if site in sites and site not in used:
            chosen.append((q, site))
            used.add(site)
            taken.add(q.id)

    spare = [s for s in sites if s not in used]
    for q in questions:
        if len(chosen) >= size or not spare:
            break
        if q.id in taken:
            continue
        chosen.append((q, spare.pop(0)))
        taken.add(q.id)

    return chosen


def _lease(db: Session, user: User, project_id: str | None, exclude: str, size: int) -> dict:
    """Lease up to `size` questions, one per available site.

    Leasing (status `assist_running` + `leased_at`) is what stops two tabs picking up the
    same question. A tab that dies mid-answer strands its lease, which the worker expires
    back into the pool.
    """
    expire_leases()
    cfg = get_extension_config()

    blocked = {s.strip() for s in exclude.split(",") if s.strip()}
    sites = [s for s in cfg.get("sites", {}) if s not in blocked]
    if not sites:
        return {"batch": [], "done": False, "waiting": _waiting(db, user, project_id).count(),
                "error": "no_sites_available"}

    # a small pool so pass 2 has room to spread, not just the first `size`
    pool = _waiting(db, user, project_id).limit(size * 4).all()
    if not pool:
        return {"batch": [], "done": True, "waiting": 0,
                "remaining_elsewhere": _waiting(db, user).count()}

    now = datetime.now(timezone.utc)
    batch = []
    for q, site in _assign(pool, sites, size):
        q.status = "assist_running"
        q.leased_at = now
        batch.append({
            "question_id": q.id,
            "project_id": q.project_id,
            "project_title": q.project.title,
            "idx": q.idx + 1,
            "total": len(q.project.questions),
            "qtype": q.qtype,
            "marks": q.marks,
            "prompt": q.assist_prompt,
            "site": site,
            "route_reason": q.route_reason,
            "figures": _figure_payload(q),
        })
        if _wants_the_document(q):
            # A number only identifies a question if the paper uses it once. Spreadsheet
            # exports and multi-section papers restart their numbering, and "answer
            # question 11" against two different question 11s is a coin toss — so when the
            # number is ambiguous we drop it and let the prompt quote the question instead.
            number = q.source_number if _number_is_unique(q) else None
            batch[-1]["document"] = {
                "url": f"/api/extension/document/{q.project_id}",
                "filename": q.project.source_filename or "question-paper.pdf",
                "number": number,
            }
            batch[-1]["prompt"] = solver.build_document_prompt(
                q.text, q.qtype or "theory", q.marks, number)
            # If the AI can't find the question in the paper it answers NOT_FOUND, and the
            # extension retries in a fresh chat with the plain prompt — a miss costs one
            # extra chat, never a lost question.
            batch[-1]["fallback_prompt"] = q.assist_prompt
    db.commit()

    return {
        "batch": batch,
        "done": False,
        "waiting": _waiting(db, user, project_id).count(),
    }


@router.get("/batch")
def next_batch(
    project_id: str | None = None,
    exclude: str = Query(default="", description="comma-separated sites the student isn't signed into"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """A batch of questions to answer concurrently — one per available assistant."""
    size = int(get_extension_config().get("batch_size", 3))
    return _lease(db, user, project_id, exclude, size)


@router.get("/work")
def next_work(project_id: str | None = None, user: User = Depends(current_user),
              db: Session = Depends(get_db)):
    """Single-question form — the manual paste-back path and the tests. Leases exactly
    one, so it can never strand the rest of a batch."""
    result = _lease(db, user, project_id, "", 1)
    if not result["batch"]:
        return {"done": True, "remaining_elsewhere": result.get("remaining_elsewhere", 0)}
    item = result["batch"][0]
    return {"done": False, "preferred_site": item["site"], "waiting": result["waiting"], **item}
