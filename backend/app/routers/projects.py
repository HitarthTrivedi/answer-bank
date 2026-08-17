import asyncio
import base64
import logging
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import DATA_DIR, get_settings
from ..db import SessionLocal, get_db
from ..models import Answer, AnswerAsset, Figure, Project, Question, User
from ..security import audit, client_ip, current_user
from ..services import (billing, cache, diagrams, explainer, export, extractor, ingest,
                        paper, solver, verify)
from ..services.queue import wake

log = logging.getLogger("prism.projects")
router = APIRouter(prefix="/api", tags=["projects"])

# ---------------------------------------------------------------- helpers


def _own_project(db: Session, user: User, project_id: str) -> Project:
    project = db.get(Project, project_id)
    if project is None or project.user_id != user.id:
        raise HTTPException(404, "Project not found")
    return project


def _own_question(db: Session, user: User, question_id: str) -> Question:
    q = db.get(Question, question_id)
    if q is None or q.project.user_id != user.id:
        raise HTTPException(404, "Question not found")
    return q


def _own_answer(db: Session, user: User, answer_id: str) -> Answer:
    a = db.get(Answer, answer_id)
    if a is None or a.question.project.user_id != user.id:
        raise HTTPException(404, "Answer not found")
    return a


def _question_dict(q: Question) -> dict:
    d = {
        "id": q.id, "idx": q.idx, "text": q.text, "marks": q.marks,
        # the number this question carried in the uploaded file — sent back on review so
        # a save can't lose the only handle we have for "answer question 7 of that paper"
        "source_number": q.source_number,
        "status": q.status, "qtype": q.qtype, "route_reason": q.route_reason,
        "error": q.error, "target_site": q.target_site,
        "figures": [{"id": f.id, "url": f"/api/figures/{f.id}"} for f in q.figures],
        # flags a question that points at something the AI cannot see
        "needs_figure": extractor.mentions_a_figure(q.text) and not q.figures,
        # is the substance of this question a diagram/graph/table/image? The deck groups
        # on this, because those are the ones worth a second look
        "visual": paper.is_visual(q),
        # still offered while a tab holds the lease, so a student can always paste by hand
        "assist_prompt": q.assist_prompt if q.status in ("assist_waiting", "assist_running") else "",
        "answer": None,
    }
    if q.answer is not None:
        d["answer"] = {
            "id": q.answer.id, "content_md": q.answer.content_md, "engine": q.answer.engine,
            "provider": q.answer.provider, "model": q.answer.model,
            "verified": q.answer.verified, "verify_note": q.answer.verify_note,
            "explain_md": q.answer.explain_md,
        }
    return d


def _project_dict(p: Project, with_questions: bool = False) -> dict:
    counts: dict[str, int] = {}
    for q in p.questions:
        counts[q.status] = counts.get(q.status, 0) + 1
    d = {
        "id": p.id, "title": p.title, "status": p.status, "error": p.error,
        "source_filename": p.source_filename, "created_at": p.created_at.isoformat(),
        "total": len(p.questions), "counts": counts, "unlocked": p.unlocked,
    }
    if with_questions:
        d["questions"] = [_question_dict(q) for q in p.questions]
    return d


# ---------------------------------------------------------------- create + extract


@router.post("/projects")
async def create_project(
    request: Request,
    title: str = Form(min_length=1, max_length=200),
    text: str = Form(default=""),
    file: UploadFile | None = File(default=None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if file is None and not text.strip():
        raise HTTPException(400, "Provide a file or pasted text")

    raw_text, source_name, figures = text, "pasted text", []
    if file is not None:
        data = await file.read()
        safe_name = re.sub(r"[^\w.\- ]", "_", file.filename or "upload")[:120]
        kind = ingest.validate_upload(data, safe_name)
        stored = DATA_DIR / "uploads" / f"{uuid.uuid4().hex}.{kind}"
        stored.write_bytes(data)
        doc = ingest.extract_document(data, kind)
        raw_text, figures = doc["text"], doc["figures"]
        source_name = safe_name

    if len(raw_text.strip()) < 12:
        raise HTTPException(422, "No usable text found in the source")

    project = Project(user_id=user.id, title=title.strip(), status="extracting",
                      source_filename=source_name, raw_text=raw_text[:500_000],
                      source_path=str(stored) if file is not None else "")
    db.add(project)
    db.commit()

    for fig in figures:
        path = DATA_DIR / "assets" / f"fig_{uuid.uuid4().hex}.{fig['ext']}"
        path.write_bytes(fig["bytes"])
        db.add(Figure(project_id=project.id, anchor=fig["anchor"], path=str(path), ext=fig["ext"]))
    if figures:
        db.commit()

    audit(db, "project_created", user.id,
          detail=f"{project.id} ({source_name}, {len(figures)} figure(s))", ip=client_ip(request))

    asyncio.create_task(_run_extraction(project.id))
    return _project_dict(project)


async def _run_extraction(project_id: str) -> None:
    db = SessionLocal()
    try:
        project = db.get(Project, project_id)
        if project is None:
            return
        try:
            found = await extractor.extract_questions(project.raw_text)
            if not found:
                project.status = "error"
                project.error = ("No questions detected. Number them like '1.' / 'Q2)' "
                                 "or edit the text and try again.")
            else:
                kept = found[:get_settings().max_questions_per_bank]
                rows = []
                for i, q in enumerate(kept):
                    row = Question(project_id=project.id, idx=i, text=q["text"][:4000],
                                   marks=q["marks"], source_number=q.get("number"))
                    db.add(row)
                    rows.append((row, q.get("offset", 0)))
                db.flush()
                _attach_figures(db, project, rows)
                project.status = "review"
        except Exception as e:
            log.exception("extraction failed for %s", project_id)
            project.status = "error"
            project.error = f"Extraction failed: {e}"
        db.commit()
    finally:
        db.close()


def _attach_figures(db, project: Project, rows: list) -> None:
    """Give each figure to the question whose text span contains it.

    Position is all we have and it is usually right: a figure sits with the question that
    refers to it. Deliberately conservative — a figure past the last question, or in a
    project with no questions, stays unattached rather than being guessed onto something.
    A wrong figure is worse than none, because the AI answers confidently about it.
    """
    figures = db.query(Figure).filter_by(project_id=project.id).order_by(Figure.anchor).all()
    if not figures or not rows:
        return
    bounds = [(row, start, rows[i + 1][1] if i + 1 < len(rows) else None)
              for i, (row, start) in enumerate(rows)]
    for fig in figures:
        for row, start, end in bounds:
            if fig.anchor >= start and (end is None or fig.anchor < end):
                fig.question_id = row.id
                break
    db.commit()


# ---------------------------------------------------------------- read / edit / delete


@router.get("/projects")
def list_projects(user: User = Depends(current_user), db: Session = Depends(get_db)):
    projects = (db.query(Project).filter_by(user_id=user.id)
                .order_by(Project.created_at.desc()).all())
    return [_project_dict(p) for p in projects]


@router.get("/projects/{project_id}")
def get_project(project_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _project_dict(_own_project(db, user, project_id), with_questions=True)


@router.delete("/projects/{project_id}")
def delete_project(project_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = _own_project(db, user, project_id)
    db.delete(project)
    db.commit()
    audit(db, "project_deleted", user.id, detail=project_id)
    return {"ok": True}


class QuestionEdit(BaseModel):
    # the row this edit belongs to. Without it a review save is a delete-and-recreate,
    # which silently throws away everything the file told us about the question.
    id: str | None = Field(default=None, max_length=32)
    text: str = Field(min_length=5, max_length=4000)
    marks: int | None = Field(default=None, ge=1, le=100)
    number: int | None = Field(default=None, ge=1, le=999)


class QuestionsUpdate(BaseModel):
    questions: list[QuestionEdit] = Field(min_length=1, max_length=200)


@router.put("/projects/{project_id}/questions")
def update_questions(project_id: str, body: QuestionsUpdate,
                     user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Save the student's review of the extracted questions (pre-processing only).

    Edited **in place**, not replaced. Two things hang off a question row that the review
    screen never shows and the student cannot retype: the number the question carried in
    the uploaded file, and the figures anchored to it. Recreating the rows dropped the
    number and set every figure's question_id to NULL — so after review, the questions
    whose meaning lived in a picture had neither the picture nor a way to point the AI at
    them in the original paper. Matching on id keeps both.
    """
    project = _own_project(db, user, project_id)
    if project.status not in ("review", "error"):
        raise HTTPException(409, "Questions can only be edited before processing starts")

    existing = {q.id: q for q in project.questions}
    for i, edit in enumerate(body.questions):
        row = existing.pop(edit.id, None) if edit.id else None
        if row is None:                      # a question the student added by hand
            row = Question(project_id=project.id, source_number=edit.number)
            project.questions.append(row)
        elif edit.number is not None:
            row.source_number = edit.number
        row.idx = i
        row.text = edit.text.strip()
        row.marks = edit.marks
    for removed in existing.values():   # questions the student deleted
        project.questions.remove(removed)   # delete-orphan on the relationship does the rest

    project.status = "review"
    project.error = ""
    db.commit()
    return _project_dict(project, with_questions=True)


# ---------------------------------------------------------------- processing


@router.post("/projects/{project_id}/start")
def start_processing(project_id: str, request: Request,
                     user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = _own_project(db, user, project_id)
    if project.status not in ("review", "done"):
        raise HTTPException(409, f"Cannot start from status '{project.status}'")
    pending = [q for q in project.questions if q.status == "pending"]
    if not pending:
        raise HTTPException(409, "No pending questions to process")

    project.status = "processing"
    db.commit()
    audit(db, "processing_started", user.id,
          detail=f"{project.id} ({len(pending)} q)", ip=client_ip(request))
    wake()
    return _project_dict(project)


@router.post("/questions/{question_id}/regenerate")
def regenerate(question_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = _own_question(db, user, question_id)
    if q.answer is not None:
        db.delete(q.answer)
    # drop the cache entry so regenerate produces a fresh answer, not the cached one
    ch = cache.qhash(q.text, q.marks, q.qtype) if q.qtype else None
    if ch:
        from ..models import AnswerCache
        db.query(AnswerCache).filter_by(qhash=ch).delete()
    q.status = "pending"
    q.assist_prompt = ""
    q.leased_at = None
    q.error = ""
    q.project.status = "processing"
    db.commit()
    wake()
    return {"ok": True}


class AnswerEdit(BaseModel):
    content_md: str = Field(min_length=1, max_length=60_000)


@router.put("/answers/{answer_id}")
def edit_answer(answer_id: str, body: AnswerEdit,
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = _own_answer(db, user, answer_id)
    a.content_md = body.content_md
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- assist mode


class AssistSubmit(BaseModel):
    content_md: str = Field(min_length=10, max_length=60_000)


@router.post("/questions/{question_id}/assist")
def submit_assist(question_id: str, body: AssistSubmit,
                  user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Paste-back from the student's own ChatGPT/Claude tab."""
    q = _own_question(db, user, question_id)
    if q.status not in ("assist_waiting", "assist_running"):
        raise HTTPException(409, "This question is not waiting for an assist answer")

    verified, note = (None, "")
    if q.qtype == "numerical":
        verified, note = verify.check_numerical(body.content_md)

    if q.answer is not None:
        db.delete(q.answer)
        db.flush()
    db.add(Answer(question_id=q.id, content_md=body.content_md.strip(), engine="assist",
                  provider="assist", model="student-supplied", verified=verified, verify_note=note))
    q.status = "answered"
    q.assist_prompt = ""
    q.leased_at = None
    db.commit()
    db.refresh(q)  # reload the answer relationship so the response carries it
    cache.store(db, q.text, q.marks, q.qtype or "theory", content_md=body.content_md.strip(),
                provider="assist", model="student-supplied", verified=verified)
    wake()  # let the worker flip the project to done if this was the last one
    return _question_dict(q)


# ---------------------------------------------------------------- explain-me


@router.post("/questions/{question_id}/explain")
async def explain_me(question_id: str, user: User = Depends(current_user),
                     db: Session = Depends(get_db)):
    """The one thing Prism's own AI writes.

    Answers always come from the student's browser AI. An explanation doesn't: it's a
    short re-read of an answer already on screen, clicked on a whim, and routing that
    through a browser tab would spend one of the student's free messages on something
    worth far less. Stored on the answer, so a second click is instant and free.

    With no key configured it degrades to a paste-it-yourself prompt, like everything else.
    """
    q = _own_question(db, user, question_id)
    if q.answer is None:
        raise HTTPException(409, "Answer this question first")
    if q.answer.explain_md:
        return {"explain_md": q.answer.explain_md, "assist_prompt": ""}

    text = await explainer.explain(q.text, q.answer.content_md)
    if text:
        q.answer.explain_md = text
        db.commit()
        return {"explain_md": text, "assist_prompt": ""}

    return {"explain_md": "",
            "assist_prompt": solver.build_explain_assist_prompt(q.text, q.answer.content_md)}


class ExplainSubmit(BaseModel):
    explain_md: str = Field(min_length=10, max_length=30_000)


@router.post("/questions/{question_id}/explain/assist")
def submit_explain(question_id: str, body: ExplainSubmit,
                   user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = _own_question(db, user, question_id)
    if q.answer is None:
        raise HTTPException(409, "Answer this question first")
    q.answer.explain_md = body.explain_md.strip()
    db.commit()
    return {"explain_md": q.answer.explain_md}


# ---------------------------------------------------------------- assets (rendered figures)


class AssetIn(BaseModel):
    kind: str = Field(pattern="^(mermaid)$")
    key: str = Field(min_length=8, max_length=64, pattern="^[a-f0-9]+$")
    png_base64: str = Field(max_length=3_000_000)  # ~2MB binary


@router.post("/answers/{answer_id}/assets")
def upload_asset(answer_id: str, body: AssetIn,
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Client-rendered mermaid PNG, stored so the DOCX export can embed the figure."""
    a = _own_answer(db, user, answer_id)
    try:
        png = base64.b64decode(body.png_base64, validate=True)
    except Exception:
        raise HTTPException(400, "Invalid base64")
    if not png.startswith(b"\x89PNG"):
        raise HTTPException(400, "Asset must be a PNG")

    existing = db.query(AnswerAsset).filter_by(answer_id=a.id, kind=body.kind, key=body.key).first()
    if existing:
        return {"ok": True}
    path = DATA_DIR / "assets" / f"{a.id}_{body.kind}_{body.key}.png"
    path.write_bytes(png)
    db.add(AnswerAsset(answer_id=a.id, kind=body.kind, key=body.key, path=str(path)))
    db.commit()
    return {"ok": True}


@router.get("/answers/{answer_id}/graph/{key}.png")
def graph_png(answer_id: str, key: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Server-rendered graphspec plot. Rendered once, cached on disk as an asset."""
    a = _own_answer(db, user, answer_id)
    if not re.fullmatch(r"[a-f0-9]{8,64}", key):
        raise HTTPException(400, "Bad key")

    existing = db.query(AnswerAsset).filter_by(answer_id=a.id, kind="graph", key=key).first()
    if existing and Path(existing.path).exists():
        return Response(Path(existing.path).read_bytes(), media_type="image/png")

    for m in diagrams.GRAPHSPEC_FENCE.finditer(a.content_md):
        spec_text = m.group(1)
        if diagrams.spec_key(spec_text) == key:
            png = diagrams.render_graphspec(spec_text)
            if png is None:
                raise HTTPException(422, "Graph spec could not be rendered")
            path = DATA_DIR / "assets" / f"{a.id}_graph_{key}.png"
            path.write_bytes(png)
            if not existing:
                db.add(AnswerAsset(answer_id=a.id, kind="graph", key=key, path=str(path)))
                db.commit()
            return Response(png, media_type="image/png")
    raise HTTPException(404, "No graphspec with this key in the answer")


@router.get("/figures/{figure_id}")
def get_figure(figure_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fig = db.get(Figure, figure_id)
    if fig is None or fig.project.user_id != user.id:
        raise HTTPException(404, "Figure not found")
    path = Path(fig.path)
    if not path.exists():
        raise HTTPException(404, "Figure file is missing")
    return Response(path.read_bytes(),
                    media_type="image/png" if fig.ext == "png" else "image/jpeg")


# ---------------------------------------------------------------- export


@router.get("/projects/{project_id}/export")
def export_docx(project_id: str, request: Request,
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = _own_project(db, user, project_id)
    if not any(q.answer is not None for q in project.questions):
        raise HTTPException(409, "Nothing answered yet — nothing to export")
    # the product's one paid moment; raises 402 with the paywall payload if unaffordable
    how = billing.ensure_unlocked(db, user, project)
    data = export.build_docx(project, db, buyer=user.name)
    audit(db, "export_docx", user.id, detail=f"{project_id} ({how})", ip=client_ip(request))
    safe_title = re.sub(r"[^\w\- ]", "", project.title)[:60].strip() or "answers"
    return Response(
        data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.docx"'},
    )
