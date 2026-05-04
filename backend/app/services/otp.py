from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.login_otp import LoginOtp

OTP_RESEND_COOLDOWN_SECONDS = 60
OTP_RESEND_WINDOW_MINUTES = 15
OTP_RESEND_MAX_IN_WINDOW = 5


def _hash_otp(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def create_login_otp(db: Session, *, user_id: UUID) -> tuple[LoginOtp, str]:
    db.query(LoginOtp).filter(LoginOtp.user_id == user_id).delete()
    code = f"{secrets.randbelow(1_000_000):06d}"
    row = LoginOtp(
        user_id=user_id,
        otp_hash=_hash_otp(code),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.otp_expire_minutes),
        attempts=0,
        max_attempts=5,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, code


def get_login_otp(db: Session, *, otp_id: UUID, user_id: UUID) -> LoginOtp | None:
    return (
        db.query(LoginOtp)
        .filter(LoginOtp.id == otp_id, LoginOtp.user_id == user_id)
        .one_or_none()
    )


def otp_resend_wait_seconds(db: Session, *, user_id: UUID) -> int:
    latest = (
        db.query(LoginOtp)
        .filter(LoginOtp.user_id == user_id)
        .order_by(LoginOtp.created_at.desc())
        .first()
    )
    if not latest:
        return 0
    now = datetime.now(timezone.utc)
    created = latest.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    elapsed = (now - created).total_seconds()
    return max(0, OTP_RESEND_COOLDOWN_SECONDS - int(elapsed))


def has_excessive_resend_volume(db: Session, *, user_id: UUID) -> bool:
    now = datetime.now(timezone.utc)
    since = now - timedelta(minutes=OTP_RESEND_WINDOW_MINUTES)
    count = db.query(LoginOtp).filter(LoginOtp.user_id == user_id, LoginOtp.created_at >= since).count()
    return count >= OTP_RESEND_MAX_IN_WINDOW


def verify_login_otp(db: Session, *, otp_id: UUID, user_id: UUID, otp_code: str) -> bool:
    row = get_login_otp(db, otp_id=otp_id, user_id=user_id)
    if not row:
        return False

    now = datetime.now(timezone.utc)
    expires_at = row.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < now:
        return False
    if row.attempts >= row.max_attempts:
        return False

    if row.otp_hash != _hash_otp(otp_code.strip()):
        row.attempts += 1
        db.commit()
        return False

    db.delete(row)
    db.commit()
    return True
