import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import User
from ..security import (
    audit,
    client_ip,
    create_access_token,
    create_refresh_token,
    current_user,
    hash_password,
    revoke_refresh_token,
    rotate_refresh_token,
    verify_password,
)
from ..services.queue import quota_used

router = APIRouter(prefix="/api/auth", tags=["auth"])

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class RegisterIn(BaseModel):
    email: str = Field(max_length=255)
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=200)


class LoginIn(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(max_length=200)


class RefreshIn(BaseModel):
    refresh_token: str = Field(max_length=200)


def _token_response(db: Session, user: User) -> dict:
    return {
        "access_token": create_access_token(user.id),
        "refresh_token": create_refresh_token(db, user.id),
        "user": {"id": user.id, "email": user.email, "name": user.name},
    }


@router.post("/register")
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if not _EMAIL.match(email):
        raise HTTPException(400, "Invalid email address")
    if db.query(User).filter_by(email=email).first():
        raise HTTPException(409, "An account with this email already exists")
    user = User(email=email, name=body.name.strip(), password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    audit(db, "register", user.id, ip=client_ip(request))
    return _token_response(db, user)


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(email=body.email.strip().lower()).first()
    if user is None or not verify_password(body.password, user.password_hash):
        audit(db, "login_failed", detail=body.email[:100], ip=client_ip(request))
        # identical error for unknown email vs wrong password — no user enumeration
        raise HTTPException(401, "Invalid email or password")
    audit(db, "login", user.id, ip=client_ip(request))
    return _token_response(db, user)


@router.post("/refresh")
def refresh(body: RefreshIn, db: Session = Depends(get_db)):
    rotated = rotate_refresh_token(db, body.refresh_token)
    if rotated is None:
        raise HTTPException(401, "Refresh token invalid or expired")
    user_id, new_refresh = rotated
    return {"access_token": create_access_token(user_id), "refresh_token": new_refresh}


@router.post("/logout")
def logout(body: RefreshIn, db: Session = Depends(get_db)):
    revoke_refresh_token(db, body.refresh_token)
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = get_settings()
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "quota": {"daily": s.daily_question_quota, "used_today": quota_used(db, user.id)},
    }
