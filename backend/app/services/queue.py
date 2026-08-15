"""The one-question-at-a-time worker — the core product mechanic.

A single global asyncio loop drains projects in `processing` status question by
question: cache → route → hand to the browser. Sequential on purpose: it maximizes
per-answer quality and makes progress legible.

This server never *answers* anything. It routes: a small model reads each question,
decides what kind of answer it needs and which of the student's browser AIs is best
placed to write it. The question is then parked as `assist_waiting` with a crafted
prompt, and the extension (or a student pasting by hand) produces the answer.

State lives in the DB, so a restart resumes exactly where it stopped.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from ..db import SessionLocal
from ..models import Answer, Project, Question
from . import cache, router_agent, solver

log = logging.getLogger("prism.queue")

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


# question lifecycle:
#   pending -> answering (server routing it, brief)
#           -> assist_waiting (routed, waiting for a browser tab)
#           -> assist_running (leased to a specific tab right now)
#           -> answered | error
LEASE_TTL_S = 600


def _requeue_stale() -> None:
    """After a crash/restart, un-stick anything that was mid-flight."""
    db = SessionLocal()
    try:
        db.query(Question).filter_by(status="answering").update({"status": "pending"})
        db.query(Question).filter_by(status="assist_running").update(
            {"status": "assist_waiting", "leased_at": None})
        db.commit()
    finally:
        db.close()


def expire_leases() -> int:
    """A tab that was closed mid-answer would strand its question forever. Anything held
    longer than the lease goes back in the pool for the next batch."""
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=LEASE_TTL_S)
    db = SessionLocal()
    try:
        n = (db.query(Question)
             .filter(Question.status == "assist_running", Question.leased_at < cutoff)
             .update({"status": "assist_waiting", "leased_at": None}, synchronize_session=False))
        if n:
            db.commit()
            log.info("expired %s stale answer lease(s)", n)
        return n
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
            expire_leases()
            _finalize_done_projects(db)
            return False

        q.status = "answering"
        db.commit()

        try:
            await _route_question(db, q)
        except Exception as e:
            log.exception("question %s failed", q.id)
            q.status = "error"
            q.error = str(e)[:500]
            db.commit()
        _finalize_done_projects(db)
        return True
    finally:
        db.close()


async def _route_question(db, q: Question) -> None:
    # 1. route: what kind of answer, and which browser AI should write it
    if not q.qtype:
        route = await router_agent.classify(q.text)
        q.qtype = route["qtype"]
        q.route_reason = route["reason"]
        q.target_site = route["site"]
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
        if states & {"pending", "answering", "assist_waiting", "assist_running"}:
            continue
        project.status = "done"
        db.commit()
