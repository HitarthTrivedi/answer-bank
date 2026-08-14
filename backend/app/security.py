"""Password hashing (stdlib scrypt — no external crypto deps), JWTs, auth dependency,
rate limiting, security headers, audit logging."""
import hashlib
import hmac
import os
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware

from .config import get_settings
from .db import get_db
from .models import AuditLog, RefreshToken, User

# ---------------- passwords (scrypt, per-user salt) ----------------

_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 64}


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    h = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"{salt.hex()}${h.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, hash_hex = stored.split("$", 1)
        h = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), **_SCRYPT)
        return hmac.compare_digest(h.hex(), hash_hex)
    except Exception:
        return False


# ---------------- JWT access + opaque refresh tokens ----------------


def create_access_token(user_id: str) -> str:
    s = get_settings()
    payload = {
        "sub": user_id,
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=s.access_token_minutes),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, s.secret_key, algorithm="HS256")


def create_refresh_token(db: Session, user_id: str) -> str:
    """Opaque random token; only its sha256 is stored, so a DB leak can't replay sessions."""
    raw = secrets.token_urlsafe(48)
    db.add(
        RefreshToken(
            user_id=user_id,
            token_hash=hashlib.sha256(raw.encode()).hexdigest(),
            expires_at=datetime.now(timezone.utc) + timedelta(days=get_settings().refresh_token_days),
        )
    )
    db.commit()
    return raw


def rotate_refresh_token(db: Session, raw: str) -> tuple[str, str] | None:
    """Validate + revoke the presented token, issue a new pair. Returns (user_id, new_refresh)."""
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    row = db.query(RefreshToken).filter_by(token_hash=token_hash, revoked=False).first()
    exp = row.expires_at.replace(tzinfo=timezone.utc) if row else None
    if not row or exp < datetime.now(timezone.utc):
        return None
    row.revoked = True
    db.commit()
    return row.user_id, create_refresh_token(db, row.user_id)


def revoke_refresh_token(db: Session, raw: str) -> None:
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    db.query(RefreshToken).filter_by(token_hash=token_hash).update({"revoked": True})
    db.commit()


_bearer = HTTPBearer(auto_error=False)


def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, get_settings().secret_key, algorithms=["HS256"])
        if payload.get("type") != "access":
            raise HTTPException(401, "Invalid token type")
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token")
    user = db.get(User, payload["sub"])
    if user is None:
        raise HTTPException(401, "User no longer exists")
    return user


# ---------------- audit ----------------


def audit(db: Session, event: str, user_id: str = "", detail: str = "", ip: str = "") -> None:
    db.add(AuditLog(user_id=user_id, event=event, detail=detail[:500], ip=ip))
    db.commit()


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


# ---------------- middleware: rate limit + security headers ----------------


class RateLimitMiddleware(BaseHTTPMiddleware):
    """In-memory sliding window per IP. Auth endpoints are throttled hard against
    credential stuffing; everything else gets a generous general limit."""

    AUTH_LIMIT = (10, 60)      # 10 requests / 60s on /api/auth/login|register
    GENERAL_LIMIT = (240, 60)  # 240 requests / 60s overall

    def __init__(self, app):
        super().__init__(app)
        self._hits: dict[str, deque] = defaultdict(deque)

    def _allow(self, key: str, limit: int, window: int) -> bool:
        now = time.monotonic()
        dq = self._hits[key]
        while dq and dq[0] < now - window:
            dq.popleft()
        if len(dq) >= limit:
            return False
        dq.append(now)
        return True

    async def dispatch(self, request: Request, call_next):
        ip = request.client.host if request.client else "?"
        path = request.url.path
        if path.startswith("/api/auth/login") or path.startswith("/api/auth/register"):
            if not self._allow(f"auth:{ip}", *self.AUTH_LIMIT):
                return _too_many()
        if not self._allow(f"gen:{ip}", *self.GENERAL_LIMIT):
            return _too_many()
        return await call_next(request)


def _too_many():
    from starlette.responses import JSONResponse

    return JSONResponse({"detail": "Too many requests, slow down."}, status_code=429)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        resp = await call_next(request)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        # API serves JSON + a few images; nothing here should ever execute scripts.
        resp.headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self'"
        return resp
