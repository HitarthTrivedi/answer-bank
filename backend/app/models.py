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
    # cached balance; CreditTxn is the source of truth and can always rebuild it
    credits: Mapped[int] = mapped_column(Integer, default=0)
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
    # the uploaded file itself, kept so it can be handed whole to an AI that reads
    # figures better than any extraction we could do
    source_path: Mapped[str] = mapped_column(String(500), default="")
    raw_text: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str] = mapped_column(Text, default="")
    # export paywall — unlocking is per question bank, so re-downloads are always free
    unlocked: Mapped[bool] = mapped_column(Boolean, default=False)
    unlock_reason: Mapped[str] = mapped_column(String(20), default="")  # free | credit | grant
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
    # the number this question carried in the uploaded file ("Q7." -> 7). Needed to ask
    # an AI holding the whole document to "answer question 7".
    source_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    text: Mapped[str] = mapped_column(Text)
    marks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # pending -> answering -> answered | assist_waiting | error
    status: Mapped[str] = mapped_column(String(20), default="pending")
    qtype: Mapped[str] = mapped_column(String(20), default="")        # numerical|code|graph|diagram|theory
    route_reason: Mapped[str] = mapped_column(String(300), default="")
    target_site: Mapped[str] = mapped_column(String(20), default="")  # which browser AI the router picked
    # set when a batch is handed to the extension, so two tabs never get the same question
    leased_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    assist_prompt: Mapped[str] = mapped_column(Text, default="")      # set when waiting on manual paste-back
    error: Mapped[str] = mapped_column(Text, default="")

    project: Mapped["Project"] = relationship(back_populates="questions")
    figures: Mapped[list["Figure"]] = relationship(
        primaryjoin="Question.id == Figure.question_id", viewonly=True
    )
    answer: Mapped["Answer | None"] = relationship(
        back_populates="question", cascade="all, delete-orphan", uselist=False
    )


class Figure(Base):
    """An image lifted out of the uploaded file — a plotted graph, a circuit, a table
    someone screenshotted. We never interpret it: the student's own browser AI reads it
    when it answers, which costs us nothing and beats any OCR we could run.

    `anchor` is the character offset in the project's raw text where the figure sat,
    which is how it finds its way onto the right question.
    """
    __tablename__ = "figures"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[str | None] = mapped_column(
        ForeignKey("questions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    anchor: Mapped[int] = mapped_column(Integer, default=0)
    path: Mapped[str] = mapped_column(String(500))
    ext: Mapped[str] = mapped_column(String(8), default="png")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    project: Mapped["Project"] = relationship()


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


class CreditTxn(Base):
    """Append-only credit ledger. Never edited — a correction is another row.
    User.credits is a cache of the running total; `balance_after` lets us audit it."""
    __tablename__ = "credit_txns"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    delta: Mapped[int] = mapped_column(Integer)                       # +bought, -spent
    reason: Mapped[str] = mapped_column(String(20))                   # purchase | spend | grant | refund
    ref: Mapped[str] = mapped_column(String(120), default="")         # project id / order id
    balance_after: Mapped[int] = mapped_column(Integer)
    at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class Order(Base):
    """A credit purchase. Credits are granted only by the verified payment webhook,
    never by the client claiming success."""
    __tablename__ = "orders"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    credits: Mapped[int] = mapped_column(Integer)
    amount_paise: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="created")  # created | paid | failed
    provider: Mapped[str] = mapped_column(String(20), default="")        # razorpay | mock
    provider_ref: Mapped[str] = mapped_column(String(120), default="", index=True)
    pay_url: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AuditLog(Base):
    """Security-relevant events: logins, failures, uploads, exports."""
    __tablename__ = "audit_log"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(String(32), default="", index=True)
    event: Mapped[str] = mapped_column(String(60))
    detail: Mapped[str] = mapped_column(String(500), default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    at: Mapped[datetime] = mapped_column(DateTime, default=_now)
