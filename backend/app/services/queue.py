"""The one-question-at-a-time worker — the core product mechanic.

A single global asyncio loop drains projects in `processing` status question by
question: cache → route → solve → verify → store. Sequential on purpose: it maximizes
per-answer quality, naturally respects free-tier RPM limits, and makes progress
legible. Questions that need a human (Assist mode) are parked as `assist_waiting`
without blocking the rest of the queue.

State lives in the DB, so a restart resumes exactly where it stopped.
"""
import asyncio
import logging
from datetime import datetime, timezone

from ..db import SessionLocal
from ..models import Answer, Project, Question, UsageLedger
from . import cache, router_agent, solver

log = logging.getLogger("answerbank.queue")

_wake = asyncio.Event()


def wake() -> None:
    """Routes call this after enqueuing work so the worker reacts instantly."""
    _wake.set()


def today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def quota_used(db, user_id: str) -> int:
    row = db.query(UsageLedger).filter_by(user_id=user_id, day=today()).first()
    return row.used if row else 0


def _consume_quota(db, user_id: str) -> None:
    row = db.query(UsageLedger).filter_by(user_id=user_id, day=today()).first()
    if row is None:
        db.add(UsageLedger(user_id=user_id, day=today(), used=1))
    else:
        row.used += 1
    db.commit()


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
    """Pick the oldest pending question of any processing project; solve it fully."""
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

        project = db.get(Project, q.project_id)
        q.status = "answering"
        db.commit()

        try:
            await _answer_question(db, project, q)
        except Exception as e:
            log.exception("question %s failed", q.id)
            q.status = "error"
            q.error = str(e)[:500]
            db.commit()
        _finalize_done_projects(db)
        return True
    finally:
        db.close()


async def _answer_question(db, project: Project, q: Question) -> None:
    # 1. route (skip if a regenerate already fixed the type)
    if not q.qtype:
        route = await router_agent.classify(q.text)
        q.qtype, q.route_reason = route["qtype"], route["reason"]
        db.commit()

    # 2. class cache — free, instant
    hit = cache.lookup(db, q.text, q.marks, q.qtype)
    if hit is not None:
        _store_answer(db, q, content_md=hit.content_md, engine="cache",
                      provider=hit.provider, model=hit.model, verified=hit.verified,
                      verify_note="served from class cache")
        return

    # 3. solve via API chain, or park for Assist mode
    try:
        result = await solver.solve(q.text, q.qtype, q.marks)
    except solver.NoProviderError:
        q.status = "assist_waiting"
        q.assist_prompt = solver.build_assist_prompt(q.text, q.qtype, q.marks)
        db.commit()
        return

    _store_answer(db, q, content_md=result["content_md"], engine="api",
                  provider=result["provider"], model=result["model"],
                  verified=result["verified"], verify_note=result["verify_note"])
    cache.store(db, q.text, q.marks, q.qtype, content_md=result["content_md"],
                provider=result["provider"], model=result["model"], verified=result["verified"])
    _consume_quota(db, project.user_id)


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
    questions are assist_waiting stays 'processing' so the assist panel keeps showing;
    it flips to done when those answers are submitted."""
    for project in db.query(Project).filter_by(status="processing").all():
        states = {qq.status for qq in project.questions}
        if states & {"pending", "answering", "assist_waiting"}:
            continue
        project.status = "done"
        db.commit()
