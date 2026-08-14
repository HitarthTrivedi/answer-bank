"""Endpoints for the Chrome extension.

There is no pairing flow. The extension runs a content script on the AnswerBank web app's
own origin, so it reads the session the student is already signed in with — same origin,
same tokens, nothing to type. Installing the extension is the entire setup.

It receives one crafted prompt at a time and posts one answer back through the existing
/api/questions/{id}/assist route. It holds no question bank, no prompt templates, no
document builder and no keys: strip the server away and it is inert.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..config import get_extension_config
from ..db import get_db
from ..models import Project, Question, User
from ..security import current_user

router = APIRouter(prefix="/api/extension", tags=["extension"])


@router.get("/config")
def extension_config(_: User = Depends(current_user)):
    """Selectors + question-type→site routing, fetched on every run.

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
        waiting = sum(1 for q in p.questions if q.status == "assist_waiting")
        if waiting or p.status == "processing":
            out.append({
                "id": p.id, "title": p.title, "status": p.status,
                "total": len(p.questions), "waiting": waiting,
                "answered": sum(1 for q in p.questions if q.status == "answered"),
            })
    return out


@router.get("/work")
def next_work(project_id: str | None = None, user: User = Depends(current_user),
              db: Session = Depends(get_db)):
    """One question at a time — same mechanic as the server worker, same reason."""
    cfg = get_extension_config()
    q = _waiting(db, user, project_id).first()
    if q is None:
        return {"done": True, "remaining_elsewhere": _waiting(db, user).count()}

    project = q.project
    return {
        "done": False,
        "question_id": q.id,
        "project_id": project.id,
        "project_title": project.title,
        "idx": q.idx + 1,
        "total": len(project.questions),
        "qtype": q.qtype or "theory",
        "marks": q.marks,
        "prompt": q.assist_prompt,
        "preferred_site": cfg.get("routing", {}).get(q.qtype or "theory",
                                                     cfg.get("default_site", "chatgpt")),
        "waiting": sum(1 for x in project.questions if x.status == "assist_waiting"),
    }
