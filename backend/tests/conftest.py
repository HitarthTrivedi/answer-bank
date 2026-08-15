"""Shared test setup.

`get_settings()` is lru_cached and `db.engine` is built at import time, so configuration
is process-wide and whichever test module imported first would otherwise win. Env goes
here, before any test module is imported, and everyone shares one client.
"""
import os

os.environ["MOCK_LLM"] = "true"        # canned ROUTING decisions (never answers)
os.environ["MOCK_PAYMENTS"] = "true"
os.environ["PROVIDER_MIN_INTERVAL_S"] = "0"
os.environ["DATABASE_URL"] = "sqlite:///./test_prism.db"
os.environ["FREE_BANKS"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

_DB_FILES = ("test_prism.db", "test_prism.db-wal", "test_prism.db-shm")


@pytest.fixture(scope="session")
def client():
    for f in _DB_FILES:  # never inherit a previous run's state
        if os.path.exists(f):
            os.remove(f)
    with TestClient(app) as c:  # `with` runs lifespan → starts the worker
        yield c
    for f in _DB_FILES:
        if os.path.exists(f):
            os.remove(f)
