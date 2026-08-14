"""Class cache: whole classes upload the same question bank. Answer each distinct
question once, serve everyone after that for free. Hash includes marks + type so a
2-mark and a 10-mark phrasing never share an answer."""
import hashlib
import re

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import AnswerCache


def qhash(text: str, marks: int | None, qtype: str) -> str:
    norm = re.sub(r"\s+", " ", text.strip().lower())
    return hashlib.sha256(f"{norm}|{marks}|{qtype}".encode()).hexdigest()


def lookup(db: Session, text: str, marks: int | None, qtype: str) -> AnswerCache | None:
    if not get_settings().class_cache:
        return None
    row = db.query(AnswerCache).filter_by(qhash=qhash(text, marks, qtype)).first()
    if row:
        row.hits += 1
        db.commit()
    return row


def store(db: Session, text: str, marks: int | None, qtype: str, *, content_md: str,
          provider: str, model: str, verified: bool | None) -> None:
    if not get_settings().class_cache:
        return
    h = qhash(text, marks, qtype)
    if db.query(AnswerCache).filter_by(qhash=h).first():
        return
    db.add(AnswerCache(qhash=h, qtype=qtype, content_md=content_md,
                       provider=provider, model=model, verified=verified))
    db.commit()
