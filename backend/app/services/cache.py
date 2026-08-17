"""Class cache: whole classes upload the same question bank. Answer each distinct
question once, serve everyone after that for free. Hash includes marks + type so a
2-mark and a 10-mark phrasing never share an answer.

A cache this powerful amplifies whatever it stores. A wrong answer served once is one
wrong answer; the same answer cached is wrong for every classmate forever, with no tab
opening to hint that anything happened at all. So storing is guarded harder than
answering: refusals never go in (an AI saying "no file attached" was once cached and
served 15 times), and neither do shrug-length replies. And never point dev scripts at a
database a real bank will ever touch — test fixtures posted through /assist once ended up
cached and served to a real upload."""
import hashlib
import re

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import AnswerCache
from . import refusal


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
    if len(content_md.strip()) < refusal.MIN_ANSWER_CHARS:
        return
    if refusal.looks_like_a_refusal(content_md):
        return  # "no file attached" is not an answer, however politely it is phrased
    h = qhash(text, marks, qtype)
    if db.query(AnswerCache).filter_by(qhash=h).first():
        return
    db.add(AnswerCache(qhash=h, qtype=qtype, content_md=content_md,
                       provider=provider, model=model, verified=verified))
    db.commit()
