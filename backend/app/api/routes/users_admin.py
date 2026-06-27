from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.security import hash_password
from app.db.session import get_db
from app.models.hr_action import HrAction
from app.models.user import AccountStatus, User, UserRole
from app.schemas.user import UserPublic
from app.services.audit import write_audit_log
from app.services.user_delete import delete_user_for_admin, is_protected_admin
from app.services.users import approve_user


router = APIRouter()
DEFAULT_RESET_PASSWORD = "Password123"


class CreatePrivilegedUserRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    email: EmailStr
    temporary_password: str = Field(min_length=8, max_length=200)
    role: str = Field(pattern="^(hr_admin|manager|executive)$")


class UpdateUserStatusRequest(BaseModel):
    status: str = Field(pattern="^(active|disabled)$")


class AssignManagerRequest(BaseModel):
    manager_id: uuid.UUID | None = None
    # Required when removing an existing manager assignment: HR documents context for the prior manager before clearing.
    prior_manager_feedback: str | None = Field(default=None, max_length=2000)


class AdminUpdateUserRequest(BaseModel):
    full_name: str | None = Field(None, min_length=2, max_length=200)
    email: EmailStr | None = None
    phone_number: str | None = Field(None, min_length=1, max_length=30)
    country: str | None = Field(None, min_length=1, max_length=120)
    department: str | None = Field(None, min_length=1, max_length=120)
    job_title: str | None = Field(None, min_length=1, max_length=120)
    experience_level: str | None = Field(None, min_length=1, max_length=20)
    primary_skill: str | None = Field(None, min_length=1, max_length=120)
    role: str | None = Field(None, pattern="^(employee|manager|hr_admin|executive)$")
    status: str | None = Field(None, pattern="^(active|disabled|pending_approval)$")
    manager_id: uuid.UUID | None = None


def _to_user_public(u: User) -> UserPublic:
    return UserPublic(
        id=u.id,
        email=u.email,
        full_name=u.full_name,
        phone_number=u.phone_number,
        country=u.country,
        department=u.department,
        job_title=u.job_title,
        experience_level=u.experience_level,
        primary_skill=u.primary_skill,
        role=u.role.value,
        status=u.status.value,
        must_change_password=u.must_change_password,
        manager_id=getattr(u, "manager_id", None),
        created_at=u.created_at,
    )


@router.get("", response_model=list[UserPublic])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.system_admin)),
    q: str | None = Query(default=None),
    role: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
) -> list[UserPublic]:
    query = db.query(User)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter((User.full_name.ilike(like)) | (User.email.ilike(like)) | (User.department.ilike(like)))
    if role:
        query = query.filter(User.role == UserRole(role))
    if status_filter:
        query = query.filter(User.status == AccountStatus(status_filter))
    users = query.order_by(User.created_at.desc()).all()
    return [_to_user_public(u) for u in users]


@router.get("/records", response_model=list[UserPublic])
def list_user_records(
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.system_admin, UserRole.hr_admin)),
    q: str | None = Query(default=None),
    role: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
) -> list[UserPublic]:
    # HR Admin: workforce directory = employees who self-registered only (not managers/HR/system admins).
    query = db.query(User).filter(User.role != UserRole.system_admin)
    if actor.role == UserRole.hr_admin:
        query = query.filter(User.role == UserRole.employee)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter((User.full_name.ilike(like)) | (User.email.ilike(like)) | (User.department.ilike(like)))
    if role:
        query = query.filter(User.role == UserRole(role))
    if status_filter:
        query = query.filter(User.status == AccountStatus(status_filter))
    users = query.order_by(User.created_at.desc()).all()
    return [_to_user_public(u) for u in users]


@router.get("/pending", response_model=list[UserPublic])
def list_pending_users(
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.system_admin, UserRole.hr_admin, UserRole.manager)),
) -> list[UserPublic]:
    q = db.query(User).filter(User.status == AccountStatus.pending_approval)
    # Managers and HR only approve self-service employee registrations (never privileged roles).
    if actor.role in (UserRole.hr_admin, UserRole.manager):
        q = q.filter(User.role == UserRole.employee)
    users = q.order_by(User.created_at.desc()).all()
    return [_to_user_public(u) for u in users]


@router.post("/{user_id}/approve", response_model=UserPublic)
def approve_pending_user(
    user_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    approver: User = Depends(require_roles(UserRole.system_admin, UserRole.hr_admin, UserRole.manager)),
) -> UserPublic:
    target = db.query(User).filter(User.id == user_id).one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if approver.role in (UserRole.manager, UserRole.hr_admin) and target.role != UserRole.employee:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only employee self-registrations (Employee role) can be approved by this role.",
        )
    try:
        user = approve_user(db, user_id=user_id, approver=approver)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    write_audit_log(
        db,
        request=request,
        actor_user_id=approver.id,
        action="user.approve",
        entity_type="user",
        entity_id=str(user.id),
        meta={"approved_by_role": approver.role.value},
    )

    return _to_user_public(user)


@router.get("/managers")
def list_managers(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.system_admin, UserRole.hr_admin)),
) -> list[dict]:
    rows = (
        db.query(User)
        .filter(User.role == UserRole.manager, User.status == AccountStatus.active)
        .order_by(User.full_name.asc())
        .all()
    )
    return [{"id": str(u.id), "name": u.full_name, "email": u.email} for u in rows]


@router.post("/{user_id}/assign-manager", response_model=UserPublic)
def assign_employee_manager(
    user_id: uuid.UUID,
    payload: AssignManagerRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.system_admin, UserRole.hr_admin)),
) -> UserPublic:
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only employees can be assigned to managers")
    prior_manager_id = user.manager_id

    if payload.manager_id is not None:
        manager = db.query(User).filter(User.id == payload.manager_id).one_or_none()
        if not manager or manager.role != UserRole.manager:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid manager_id")
        user.manager_id = manager.id
    else:
        if prior_manager_id is not None:
            fb = (payload.prior_manager_feedback or "").strip()
            if len(fb) < 12:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Removing a manager assignment requires prior_manager_feedback (at least 12 characters) so the current manager receives context before the employee is unassigned.",
                )
            db.add(
                HrAction(
                    target_user_id=prior_manager_id,
                    created_by_id=actor.id,
                    action_type="manager_assignment_feedback",
                    status="completed",
                    note=fb,
                    payload={
                        "event": "employee_unassigned_from_manager",
                        "employee_id": str(user.id),
                        "employee_name": user.full_name,
                        "employee_email": user.email,
                    },
                )
            )
        user.manager_id = None

    db.commit()
    db.refresh(user)

    write_audit_log(
        db,
        request=request,
        actor_user_id=actor.id,
        action="user.assign_manager",
        entity_type="user",
        entity_id=str(user.id),
        meta={
            "manager_id": str(payload.manager_id) if payload.manager_id else None,
            "cleared_prior_manager": prior_manager_id is not None and payload.manager_id is None,
        },
    )

    return _to_user_public(user)


@router.post("/create-privileged", response_model=UserPublic)
def create_privileged_user(
    payload: CreatePrivilegedUserRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.system_admin)),
) -> UserPublic:
    email = payload.email.strip().lower()
    existing = db.query(User).filter(User.email == email).one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    role = UserRole(payload.role)
    user = User(
        email=email,
        full_name=payload.full_name,
        phone_number="N/A",
        country="N/A",
        department="N/A",
        job_title=payload.role.replace("_", " ").title(),
        experience_level="Expert",
        primary_skill="Management",
        role=role,
        status=AccountStatus.active,
        password_hash=hash_password(payload.temporary_password),
        must_change_password=True,
        approved_by_user_id=admin.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    write_audit_log(
        db,
        request=request,
        actor_user_id=admin.id,
        action="user.create_privileged",
        entity_type="user",
        entity_id=str(user.id),
        meta={"role": user.role.value},
    )

    return _to_user_public(user)


@router.patch("/{user_id}/status", response_model=UserPublic)
def update_user_status(
    user_id: uuid.UUID,
    payload: UpdateUserStatusRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.system_admin)),
) -> UserPublic:
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if is_protected_admin(user):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot change administrator account status")
    user.status = AccountStatus(payload.status)
    db.commit()
    db.refresh(user)

    write_audit_log(
        db,
        request=request,
        actor_user_id=admin.id,
        action="user.status_update",
        entity_type="user",
        entity_id=str(user.id),
        meta={"status": user.status.value},
    )
    return _to_user_public(user)


@router.post("/{user_id}/force-password-change", response_model=UserPublic)
def force_password_change(
    user_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.system_admin)),
) -> UserPublic:
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.must_change_password = True
    db.commit()
    db.refresh(user)

    write_audit_log(
        db,
        request=request,
        actor_user_id=admin.id,
        action="user.force_password_change",
        entity_type="user",
        entity_id=str(user.id),
        meta={},
    )
    return _to_user_public(user)



@router.patch("/{user_id}", response_model=UserPublic)
def admin_update_user(
    user_id: uuid.UUID,
    payload: AdminUpdateUserRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.system_admin)),
) -> UserPublic:
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return _to_user_public(user)

    if user.role == UserRole.system_admin and (updates.get("role") is not None or updates.get("status") is not None):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="System administrator role and status cannot be changed here.",
        )
    if user.role == UserRole.hr_admin and updates.get("status") is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="HR administrator status cannot be changed here.",
        )

    if updates.get("email"):
        new_email = str(updates["email"]).strip().lower()
        clash = db.query(User).filter(User.email == new_email, User.id != user_id).one_or_none()
        if clash:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already in use")
        user.email = new_email

    if updates.get("full_name") is not None:
        user.full_name = updates["full_name"]
    if updates.get("phone_number") is not None:
        user.phone_number = updates["phone_number"]
    if updates.get("country") is not None:
        user.country = updates["country"]
    if updates.get("department") is not None:
        user.department = updates["department"]
    if updates.get("job_title") is not None:
        user.job_title = updates["job_title"]
    if updates.get("experience_level") is not None:
        user.experience_level = updates["experience_level"]
    if updates.get("primary_skill") is not None:
        user.primary_skill = updates["primary_skill"]

    if updates.get("role") is not None:
        user.role = UserRole(updates["role"])

    if updates.get("status") is not None:
        user.status = AccountStatus(updates["status"])

    if "manager_id" in updates:
        if user.role != UserRole.employee:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="manager_id applies only to employees")
        mid = updates["manager_id"]
        if mid is not None:
            mgr = db.query(User).filter(User.id == mid, User.role == UserRole.manager).one_or_none()
            if not mgr:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid manager_id")
            user.manager_id = mid
        else:
            user.manager_id = None

    db.commit()
    db.refresh(user)

    write_audit_log(
        db,
        request=request,
        actor_user_id=admin.id,
        action="user.admin_update",
        entity_type="user",
        entity_id=str(user.id),
        meta={"fields": list(updates.keys())},
    )
    return _to_user_public(user)


@router.delete("/{user_id}")
def admin_delete_user(
    user_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.system_admin)),
) -> dict[str, Any]:
    target = db.query(User).filter(User.id == user_id).one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    meta = {"email": target.email, "role": target.role.value}
    try:
        delete_user_for_admin(db, admin_id=admin.id, user_id=user_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    write_audit_log(
        db,
        request=request,
        actor_user_id=admin.id,
        action="user.admin_delete",
        entity_type="user",
        entity_id=str(user_id),
        meta=meta,
    )
    return {"ok": True}


@router.post("/{user_id}/reset-password-default", response_model=UserPublic)
def reset_password_default(
    user_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.system_admin)),
) -> UserPublic:
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role == UserRole.system_admin:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot reset system admin password")

    user.password_hash = hash_password(DEFAULT_RESET_PASSWORD)
    user.must_change_password = True
    user.status = AccountStatus.active
    db.commit()
    db.refresh(user)

    write_audit_log(
        db,
        request=request,
        actor_user_id=admin.id,
        action="user.reset_password_default",
        entity_type="user",
        entity_id=str(user.id),
        meta={"default_password": True, "must_change_password": True},
    )
    return _to_user_public(user)
