"""Credits and the export paywall.

The product's one paid moment: answering questions is always free, downloading the
finished DOCX costs one credit per question bank. Unlocking is stored on the Project,
so a student who paid can re-download forever — you charge for the document, not the
click.

Credits move only through `post()`, which writes an append-only CreditTxn row alongside
the cached User.credits balance. Nothing else may touch User.credits.
"""
from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import CreditTxn, Project, User


def post(db: Session, user: User, delta: int, reason: str, ref: str = "") -> CreditTxn:
    """Move `delta` credits and record why. Commits."""
    if delta < 0 and user.credits + delta < 0:
        raise HTTPException(402, "Not enough credits")
    user.credits = (user.credits or 0) + delta
    txn = CreditTxn(user_id=user.id, delta=delta, reason=reason, ref=ref[:120],
                    balance_after=user.credits)
    db.add(txn)
    db.commit()
    return txn


def free_banks_used(db: Session, user: User) -> int:
    return (db.query(Project)
            .filter_by(user_id=user.id, unlocked=True, unlock_reason="free")
            .count())


def free_banks_left(db: Session, user: User) -> int:
    return max(0, get_settings().free_banks - free_banks_used(db, user))


def status(db: Session, user: User) -> dict:
    s = get_settings()
    return {
        "credits": user.credits or 0,
        "free_banks_left": free_banks_left(db, user),
        "price_inr": s.packs[0]["inr"] if s.packs else 20,
        "packs": s.packs,
        "mock_payments": s.mock_payments,
    }


def ensure_unlocked(db: Session, user: User, project: Project) -> str:
    """Gate for DOCX export. Returns how it was unlocked, or raises 402 with everything
    the paywall UI needs to render itself."""
    if project.unlocked:
        return project.unlock_reason or "unlocked"

    if free_banks_left(db, user) > 0:
        project.unlocked, project.unlock_reason = True, "free"
        db.commit()
        return "free"

    if (user.credits or 0) > 0:
        post(db, user, -1, "spend", ref=project.id)
        project.unlocked, project.unlock_reason = True, "credit"
        db.commit()
        return "credit"

    raise HTTPException(402, detail={
        "code": "payment_required",
        "message": "This question bank needs 1 credit to download.",
        **status(db, user),
    })
