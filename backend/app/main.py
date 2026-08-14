import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import Base, engine
from .routers import auth, projects
from .security import RateLimitMiddleware, SecurityHeadersMiddleware
from .services.queue import worker_loop

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("answerbank")


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    Base.metadata.create_all(engine)
    if s.secret_key.startswith("dev-insecure-change-me"):
        log.warning("SECRET_KEY is the dev default — set a real one in backend/.env before exposing this")
    if s.mock_llm:
        log.warning("MOCK_LLM=true — serving canned answers (demo/test mode)")
    worker = asyncio.create_task(worker_loop())
    yield
    worker.cancel()


app = FastAPI(title="AnswerBank", version="0.1.0", lifespan=lifespan,
              docs_url=None, redoc_url=None, openapi_url=None)  # no public API schema in prod posture

# middleware order (outermost last): CORS must wrap everything so even 429s carry CORS headers
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[get_settings().frontend_origin],
    allow_credentials=False,  # bearer tokens, not cookies — no credentialed CORS needed
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth.router)
app.include_router(projects.router)


@app.get("/api/health")
def health():
    s = get_settings()
    from .services.providers import provider_available

    return {
        "ok": True,
        "mock": s.mock_llm,
        "providers": {p: provider_available(p) for p in ("google", "groq", "openrouter")},
    }
