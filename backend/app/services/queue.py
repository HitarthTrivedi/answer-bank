"""The one-question-at-a-time worker — the core product mechanic.

A single global asyncio loop drains projects in `processing` status question by
question: cache → route → hand to the browser. Sequential on purpose: it maximizes
per-answer quality and makes progress legible.

This server never answers anything itself. Every question that isn't already in the
class cache is parked as `assist_waiting` with a crafted prompt, and the student's own
AI — driven by the Chrome extension, or pasted by hand — produces the answer.

State lives in the DB, so a restart resumes exactly where it stopped.
"""
import asyncio
import logging

from ..db import SessionLocal
from ..models import Answer, Project, Question
from . import cache, router_agent, solver

log = logging.getLogger("answerbank.queue")

_wake = asyncio.Event()


def wake() -> None:
    """Routes call this after enqueuing work so the worker reacts instantly."""
    _wake.set()


async def worker_loop() -> None:
    log.info("answer worker started")
    _requeue_stale()
    while True:
        try:
            worked = await _process_next()
        except Exception:  # worker must never die
            log.exception("worker iteration failed")
            worked = False
        if not worked:
            try:
                await asyncio.wait_for(_wake.wait(), timeout=3.0)
            except asyncio.TimeoutError:
                pass
            _wake.clear()


def _requeue_stale() -> None:
    """After a crash/restart, questions stuck in 'answering' go back to 'pending'."""
    db = SessionLocal()
    try:
        db.query(Question).filter_by(status="answering").update({"status": "pending"})
        db.commit()
    finally:
        db.close()


async def _process_next() -> bool:
    """Pick the oldest pending question of any processing project; route it."""
    db = SessionLocal()
    try:
        q = (
            db.query(Question)
            .join(Project, Question.project_id == Project.id)
            .filter(Project.status == "processing", Question.status == "pending")
            .order_by(Project.created_at, Question.idx)
            .first()
        )
        if q is None:
            _finalize_done_projects(db)
            return False

        q.status = "answering"
        db.commit()

        try:
            _route_question(db, q)
        except Exception as e:
            log.exception("question %s failed", q.id)
            q.status = "error"
            q.error = str(e)[:500]
            db.commit()
        _finalize_done_projects(db)
        return True
    finally:
        db.close()


def _route_question(db, q: Question) -> None:
    # 1. classify (skip if a regenerate already fixed the type)
    if not q.qtype:
        route = router_agent.classify(q.text)
        q.qtype, q.route_reason = route["qtype"], route["reason"]
        db.commit()

    # 2. class cache — free, instant, and it outranks the browser: a question the class
    #    already answered shouldn't cost anyone another trip through ChatGPT.
    hit = cache.lookup(db, q.text, q.marks, q.qtype)
    if hit is not None:
        _store_answer(db, q, content_md=hit.content_md, engine="cache",
                      provider=hit.provider, model=hit.model, verified=hit.verified,
                      verify_note="served from class cache")
        return

    # 3. hand it to the student's own AI
    q.status = "assist_waiting"
    q.assist_prompt = solver.build_assist_prompt(q.text, q.qtype, q.marks)
    db.commit()


def _store_answer(db, q: Question, **kw) -> None:
    existing = db.query(Answer).filter_by(question_id=q.id).first()
    if existing:
        db.delete(existing)
        db.flush()
    db.add(Answer(question_id=q.id, **kw))
    q.status = "answered"
    q.error = ""
    db.commit()


def _finalize_done_projects(db) -> None:
    """processing → done once nothing is pending/answering. A project whose only open
    questions are assist_waiting stays 'processing' so the run keeps showing as live;
    it flips to done when those answers come back."""
    for project in db.query(Project).filter_by(status="processing").all():
        states = {qq.status for qq in project.questions}
        if states & {"pending", "answering", "assist_waiting"}:
            continue
        project.status = "done"
        db.commit()
