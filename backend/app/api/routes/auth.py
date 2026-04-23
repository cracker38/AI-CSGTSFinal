from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.security import create_access_token
from app.db.session import get_db
from app.models.user import AccountStatus, User
from app.schemas.auth import ChangePasswordRequest, LoginRequest, TokenResponse
from app.services.audit import write_audit_log
from app.services.users import authenticate_user, change_password


router = APIRouter()


@router.get("/ping")
def ping() -> dict:
    """No database — use to verify the API process and routing (avoids confusing client timeouts)."""
    return {"ok": True}


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
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
