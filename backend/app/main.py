import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import Base, engine, migrate_columns
from .routers import auth, billing, extension, projects
from .security import RateLimitMiddleware, SecurityHeadersMiddleware
from .services.queue import worker_loop

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("prism")


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    Base.metadata.create_all(engine)
    migrate_columns()  # adds post-v0.1 columns to an existing prism.db
    if s.secret_key.startswith("dev-insecure-change-me"):
        log.warning("SECRET_KEY is the dev default — set a real one in backend/.env before exposing this")
    if s.mock_payments:
        log.warning("MOCK_PAYMENTS=true — credit purchases complete without a gateway")
    worker = asyncio.create_task(worker_loop())
    yield
    worker.cancel()


app = FastAPI(title="Prism", version="0.1.0", lifespan=lifespan,
              docs_url=None, redoc_url=None, openapi_url=None)  # no public API schema in prod posture

# middleware order (outermost last): CORS must wrap everything so even 429s carry CORS headers
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[get_settings().frontend_origin],
    # the Chrome extension calls this API from chrome-extension://<id>
    allow_origin_regex=get_settings().extension_origin_regex,
    allow_credentials=False,  # bearer tokens, not cookies — no credentialed CORS needed
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(billing.router)
app.include_router(extension.router)


@app.get("/api/health")
def health():
    return {"ok": True, "engine": "browser", "mock_payments": get_settings().mock_payments}
