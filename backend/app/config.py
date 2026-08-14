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

    # --- billing (paywall sits on DOCX export only; answering is always free) ---
    free_banks: int = 1                     # question banks a new user can export without paying
    credit_packs: str = (                   # JSON: what a credit costs in bulk. 1 credit = 1 bank.
        '[{"credits": 1, "inr": 20, "label": "One bank"},'
        ' {"credits": 6, "inr": 99, "label": "Six banks"},'
        ' {"credits": 15, "inr": 199, "label": "Semester pack"}]'
    )
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""
    mock_payments: bool = True              # orders self-complete; no gateway needed for dev/demo
    payment_callback_url: str = "http://localhost:5173/app/billing"

    # --- chrome extension ---
    pairing_code_ttl_s: int = 300           # how long a pairing code stays claimable
    extension_origin_regex: str = r"chrome-extension://[a-z]{32}"

    model_config = {"env_file": str(BASE_DIR / ".env"), "env_file_encoding": "utf-8"}

    @property
    def packs(self) -> list[dict]:
        return json.loads(self.credit_packs)


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


@lru_cache
def get_extension_config() -> dict:
    """DOM selectors the Chrome extension uses to drive chatgpt.com / claude.ai / gemini.
    Served to the extension at runtime so a UI change on their side is a one-file server
    fix, not a re-install for every student."""
    path = BASE_DIR / "extension_selectors.json"
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)
