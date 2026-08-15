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
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..config import get_extension_config
from ..db import get_db
from ..models import Project, Question, User
from ..security import current_user
from ..services.queue import expire_leases

router = APIRouter(prefix="/api/extension", tags=["extension"])


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
        })
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
