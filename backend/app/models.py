import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _id() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    projects: Mapped[list["Project"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), index=True)  # sha256 of the opaque token
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class Project(Base):
    """One uploaded question bank."""
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    # draft -> extracting -> review -> processing -> done | error
    status: Mapped[str] = mapped_column(String(20), default="draft")
    source_filename: Mapped[str] = mapped_column(String(255), default="")
    raw_text: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    user: Mapped["User"] = relationship(back_populates="projects")
    questions: Mapped[list["Question"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="Question.idx"
    )


class Question(Base):
    __tablename__ = "questions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    idx: Mapped[int] = mapped_column(Integer)  # order within the project
    text: Mapped[str] = mapped_column(Text)
    marks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # pending -> answering -> answered | assist_waiting | error
    status: Mapped[str] = mapped_column(String(20), default="pending")
    qtype: Mapped[str] = mapped_column(String(20), default="")        # numerical|code|graph|diagram|theory
    route_reason: Mapped[str] = mapped_column(String(300), default="")
    assist_prompt: Mapped[str] = mapped_column(Text, default="")      # set when waiting on manual paste-back
    error: Mapped[str] = mapped_column(Text, default="")

    project: Mapped["Project"] = relationship(back_populates="questions")
    answer: Mapped["Answer | None"] = relationship(
        back_populates="question", cascade="all, delete-orphan", uselist=False
    )


class Answer(Base):
    __tablename__ = "answers"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    question_id: Mapped[str] = mapped_column(
        ForeignKey("questions.id", ondelete="CASCADE"), unique=True, index=True
    )
    content_md: Mapped[str] = mapped_column(Text)
    engine: Mapped[str] = mapped_column(String(20))                  # api | assist | cache
    provider: Mapped[str] = mapped_column(String(40), default="")
    model: Mapped[str] = mapped_column(String(120), default="")
    verified: Mapped[bool | None] = mapped_column(Boolean, nullable=True)  # numericals only
    verify_note: Mapped[str] = mapped_column(String(300), default="")
    explain_md: Mapped[str] = mapped_column(Text, default="")        # lazy ELI5, cached once generated
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    question: Mapped["Question"] = relationship(back_populates="answer")
    assets: Mapped[list["AnswerAsset"]] = relationship(back_populates="answer", cascade="all, delete-orphan")


class AnswerAsset(Base):
    """Rendered artifacts attached to an answer: graph PNGs, mermaid PNGs posted by the client."""
    __tablename__ = "answer_assets"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    answer_id: Mapped[str] = mapped_column(ForeignKey("answers.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))    # graph | mermaid
    key: Mapped[str] = mapped_column(String(64))     # ties asset to a specific fence in the markdown
    path: Mapped[str] = mapped_column(String(500))   # file under data/assets/
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    answer: Mapped["Answer"] = relationship(back_populates="assets")
    __table_args__ = (UniqueConstraint("answer_id", "kind", "key"),)


class AnswerCache(Base):
    """Class cache: identical question (normalized hash) answered once, reused for everyone."""
    __tablename__ = "answer_cache"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    qhash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    qtype: Mapped[str] = mapped_column(String(20))
    content_md: Mapped[str] = mapped_column(Text)
    provider: Mapped[str] = mapped_column(String(40), default="")
    model: Mapped[str] = mapped_column(String(120), default="")
    verified: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    hits: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class UsageLedger(Base):
    """Daily solved-question count per user — quota enforcement + future billing."""
    __tablename__ = "usage_ledger"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    day: Mapped[str] = mapped_column(String(10))  # YYYY-MM-DD (UTC)
    used: Mapped[int] = mapped_column(Integer, default=0)
    __table_args__ = (UniqueConstraint("user_id", "day"),)


class AuditLog(Base):
    """Security-relevant events: logins, failures, uploads, exports."""
    __tablename__ = "audit_log"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(String(32), default="", index=True)
    event: Mapped[str] = mapped_column(String(60))
    detail: Mapped[str] = mapped_column(String(500), default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    at: Mapped[datetime] = mapped_column(DateTime, default=_now)
