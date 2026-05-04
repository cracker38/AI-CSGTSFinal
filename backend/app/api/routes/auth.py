from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.security import create_access_token
from app.db.session import get_db
from app.models.user import AccountStatus, User
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    LoginResponse,
    ResendOtpRequest,
    ResendOtpResponse,
    TokenResponse,
    VerifyOtpRequest,
)
from app.services.audit import write_audit_log
from app.services.emailing import send_login_otp_email
from app.services.otp import (
    OTP_RESEND_COOLDOWN_SECONDS,
    create_login_otp,
    get_login_otp,
    has_excessive_resend_volume,
    otp_resend_wait_seconds,
    verify_login_otp,
)
from app.services.users import authenticate_user, change_password


router = APIRouter()


def _send_login_otp(db: Session, *, user: User, request: Request, action: str) -> LoginResponse:
    otp_row, otp_code = create_login_otp(db, user_id=user.id)
    try:
        send_login_otp_email(to_email=user.email, otp_code=otp_code)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to send OTP email: {e}")

    write_audit_log(
        db,
        request=request,
        actor_user_id=user.id,
        action=action,
        entity_type="user",
        entity_id=str(user.id),
        meta={"role": user.role.value, "otp_request_id": str(otp_row.id)},
    )
    return LoginResponse(requires_otp=True, otp_request_id=str(otp_row.id))


@router.get("/ping")
def ping() -> dict:
    """No database — use to verify the API process and routing (avoids confusing client timeouts)."""
    return {"ok": True}


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> LoginResponse:
    user = authenticate_user(db, email=payload.email, password=payload.password)
    if not user:
        write_audit_log(
            db,
            request=request,
            actor_user_id=None,
            action="auth.login_failed",
            entity_type="user",
            entity_id=str(payload.email),
            meta={},
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if user.status != AccountStatus.active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account not active")

    return _send_login_otp(db, user=user, request=request, action="auth.login_otp_sent")


@router.post("/verify-otp", response_model=TokenResponse)
def verify_otp(payload: VerifyOtpRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.query(User).filter(User.email == payload.email.strip().lower()).one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if user.status != AccountStatus.active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account not active")

    try:
        otp_id = UUID(payload.otp_request_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OTP request id")

    ok = verify_login_otp(db, otp_id=otp_id, user_id=user.id, otp_code=payload.otp_code)
    if not ok:
        write_audit_log(
            db,
            request=request,
            actor_user_id=user.id,
            action="auth.login_otp_failed",
            entity_type="user",
            entity_id=str(user.id),
            meta={},
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired OTP")

    token = create_access_token(subject=str(user.id), role=user.role.value)
    write_audit_log(
        db,
        request=request,
        actor_user_id=user.id,
        action="auth.login",
        entity_type="user",
        entity_id=str(user.id),
        meta={"role": user.role.value},
    )
    return TokenResponse(access_token=token, role=user.role.value, must_change_password=user.must_change_password)


@router.post("/resend-otp", response_model=ResendOtpResponse)
def resend_otp(payload: ResendOtpRequest, request: Request, db: Session = Depends(get_db)) -> ResendOtpResponse:
    user = db.query(User).filter(User.email == payload.email.strip().lower()).one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    if user.status != AccountStatus.active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account not active")

    try:
        otp_id = UUID(payload.otp_request_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OTP request id")

    existing = get_login_otp(db, otp_id=otp_id, user_id=user.id)
    if not existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OTP session not found or expired")

    wait = otp_resend_wait_seconds(db, user_id=user.id)
    if wait > 0:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=f"Please wait {wait}s before resending OTP")
    if has_excessive_resend_volume(db, user_id=user.id):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many OTP requests. Please try again later.")

    login_response = _send_login_otp(db, user=user, request=request, action="auth.login_otp_resent")
    return ResendOtpResponse(
        otp_request_id=login_response.otp_request_id or "",
        resend_cooldown_seconds=OTP_RESEND_COOLDOWN_SECONDS,
    )


@router.get("/me")
def me(user: User = Depends(get_current_user)) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role.value,
        "status": user.status.value,
        "must_change_password": user.must_change_password,
    }


@router.post("/change-password")
def change_password_endpoint(
    payload: ChangePasswordRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    try:
        change_password(db, user=user, current_password=payload.current_password, new_password=payload.new_password)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    write_audit_log(
        db,
        request=request,
        actor_user_id=user.id,
        action="auth.change_password",
        entity_type="user",
        entity_id=str(user.id),
        meta={},
    )
    return {"ok": True}
