from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import get_settings

engine = create_engine(
    get_settings().database_url,
    connect_args={"check_same_thread": False},  # SQLite + FastAPI threads
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Columns added after v0.1 shipped. create_all() only creates missing *tables*, so an
# existing prism.db needs these added by hand. Idempotent — safe on every boot.
_ADDED_COLUMNS = {
    "users": [("credits", "INTEGER NOT NULL DEFAULT 0")],
    "projects": [
        ("source_path", "VARCHAR(500) NOT NULL DEFAULT ''"),
        ("unlocked", "BOOLEAN NOT NULL DEFAULT 0"),
        ("unlock_reason", "VARCHAR(20) NOT NULL DEFAULT ''"),
    ],
    "questions": [
        ("target_site", "VARCHAR(20) NOT NULL DEFAULT ''"),
        ("leased_at", "DATETIME"),
        ("source_number", "INTEGER"),
    ],
}


def migrate_columns() -> None:
    if engine.dialect.name != "sqlite":  # Postgres deploys get a real migration tool
        return
    from sqlalchemy import text

    with engine.begin() as conn:
        for table, columns in _ADDED_COLUMNS.items():
            existing = {r[1] for r in conn.execute(text(f"PRAGMA table_info({table})"))}
            if not existing:  # table itself doesn't exist yet — create_all will make it complete
                continue
            for name, ddl in columns:
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
