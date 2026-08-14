"""Endpoints for the Chrome extension.

The extension is a replacement for the human in Assist mode, nothing more. It receives
one crafted prompt at a time, drives the student's own logged-in AI tab, and posts the
answer back through the existing /api/questions/{id}/assist route.

It deliberately holds nothing of value: no question bank, no prompt templates, no
document builder, no API keys. Strip the server away and the extension is inert.
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import get_extension_config, get_settings
from ..db import get_db
from ..models import PairingCode, Project, Question, User
from ..security import audit, client_ip, create_access_token, create_refresh_token, current_user

router = APIRouter(prefix="/api/extension", tags=["extension"])

# no 0/O/1/I — these get typed by hand off a screen
_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
_CODE_LEN = 8


def _hash(code: str) -> str:
    return hashlib.sha256(code.upper().encode()).hexdigest()


# ---------------------------------------------------------------- pairing


@router.post("/pair")
def create_pairing_code(request: Request, user: User = Depends(current_user),
                        db: Session = Depends(get_db)):
    """Web app → a short code the student types into the extension. The extension never
    sees the account password."""
    s = get_settings()
    db.query(PairingCode).filter_by(user_id=user.id, used=False).update({"used": True})
    code = "".join(secrets.choice(_ALPHABET) for _ in range(_CODE_LEN))
    expires = datetime.now(timezone.utc) + timedelta(seconds=s.pairing_code_ttl_s)
    db.add(PairingCode(user_id=user.id, code_hash=_hash(code), expires_at=expires))
    db.commit()
    audit(db, "pairing_code_issued", user.id, ip=client_ip(request))
    return {"code": code, "expires_in_s": s.pairing_code_ttl_s}


class ClaimIn(BaseModel):
    code: str = Field(min_length=_CODE_LEN, max_length=_CODE_LEN)


@router.post("/claim")
def claim_pairing_code(body: ClaimIn, request: Request, db: Session = Depends(get_db)):
    """Extension → tokens. Single use; the code is burned whether or not it was valid."""
    row = db.query(PairingCode).filter_by(code_hash=_hash(body.code.strip()), used=False).first()
    expired = row is not None and row.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc)
    if row is None or expired:
        if row is not None:
            row.used = True
            db.commit()
        audit(db, "pairing_failed", detail="expired" if expired else "unknown", ip=client_ip(request))
        raise HTTPException(401, "That code is wrong or has expired — generate a new one")

    row.used = True
    db.commit()
    user = db.get(User, row.user_id)
    if user is None:
        raise HTTPException(401, "Account no longer exists")
    audit(db, "extension_paired", user.id, ip=client_ip(request))
    return {
        "access_token": create_access_token(user.id),
        "refresh_token": create_refresh_token(db, user.id),
        "user": {"id": user.id, "email": user.email, "name": user.name},
    }


# ---------------------------------------------------------------- runtime config


@router.get("/config")
def extension_config(_: User = Depends(current_user)):
    """Selectors + question-type→site routing, fetched on every run.

    This is the hotfix channel: when chatgpt.com renames a button, edit
    backend/extension_selectors.json and every installed extension picks it up on its
    next run. Nobody reinstalls anything.
    """
    return get_extension_config()


# ---------------------------------------------------------------- work queue


def _waiting(db: Session, user: User, project_id: str | None = None):
    q = (db.query(Question)
         .join(Project, Question.project_id == Project.id)
         .filter(Project.user_id == user.id, Question.status == "assist_waiting"))
    if project_id:
        q = q.filter(Project.id == project_id)
    return q.order_by(Project.created_at, Question.idx)


@router.get("/projects")
def projects_needing_work(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Question banks with questions parked for the student's own AI."""
    out = []
    for p in (db.query(Project).filter_by(user_id=user.id)
              .order_by(Project.created_at.desc()).all()):
        waiting = sum(1 for q in p.questions if q.status == "assist_waiting")
        if waiting or p.status == "processing":
            out.append({
                "id": p.id, "title": p.title, "status": p.status,
                "engine_mode": p.engine_mode, "total": len(p.questions),
                "waiting": waiting,
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
        remaining = _waiting(db, user).count()
        return {"done": True, "remaining_elsewhere": remaining}

    project = q.project
    total = len(project.questions)
    return {
        "done": False,
        "question_id": q.id,
        "project_id": project.id,
        "project_title": project.title,
        "idx": q.idx + 1,
        "total": total,
        "qtype": q.qtype or "theory",
        "marks": q.marks,
        "prompt": q.assist_prompt,
        "preferred_site": cfg.get("routing", {}).get(q.qtype or "theory",
                                                     cfg.get("default_site", "chatgpt")),
        "waiting": sum(1 for x in project.questions if x.status == "assist_waiting"),
    }
