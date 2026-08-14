"""Central settings. Everything tunable lives in .env — no magic numbers in code."""
import json
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/
DATA_DIR = BASE_DIR.parent / "data"


class Settings(BaseSettings):
    # --- security ---
    secret_key: str = "dev-insecure-change-me-padded-to-32-bytes!"  # startup logs a loud warning if unchanged
    access_token_minutes: int = 30
    refresh_token_days: int = 7

    # --- server ---
    frontend_origin: str = "http://localhost:5173"
    database_url: str = f"sqlite:///{DATA_DIR / 'answerbank.db'}"

    # --- uploads ---
    max_upload_mb: int = 15
    allowed_extensions: str = "pdf,docx,txt,md,png,jpg,jpeg"

    # --- quotas / pacing ---
    daily_question_quota: int = 60          # solved questions per user per day
    provider_min_interval_s: float = 4.0    # global pacing between calls to the same provider (15 RPM ≈ 4s)
    llm_timeout_s: float = 120.0

    # --- providers (all optional; product still works key-less via Assist mode) ---
    google_api_key: str = ""
    groq_api_key: str = ""
    openrouter_api_key: str = ""
    mock_llm: bool = False                  # deterministic canned answers for dev/demo/tests

    # --- features ---
    class_cache: bool = True                # share answers for identical questions across users

    model_config = {"env_file": str(BASE_DIR / ".env"), "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "uploads").mkdir(exist_ok=True)
    (DATA_DIR / "assets").mkdir(exist_ok=True)
    return s


@lru_cache
def get_model_config() -> dict:
    """Role→model mapping. Edit backend/models.json — never hardcode model strings in code."""
    path = BASE_DIR / "models.json"
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)
