from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.core.security import hash_password, verify_password
from app.models.employee_profile import EmployeeProfile
from app.models.user import AccountStatus, User, UserRole


def authenticate_user(db: Session, *, email: str, password: str) -> User | None:
    email_n = email.strip().lower()
    user = db.query(User).filter(User.email == email_n).one_or_none()
    if not user:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def create_employee_pending(
    db: Session,
    *,
    full_name: str,
    email: str,
    password: str,
    phone_number: str,
    country: str,
    department: str,
    job_title: str,
    experience_level: str,
    primary_skill: str,
) -> User:
    email_n = email.strip().lower()
    existing = db.query(User).filter(User.email == email_n).one_or_none()
    if existing:
        raise ValueError("Email already registered")

    user = User(
        email=email_n,
        full_name=full_name,
        phone_number=phone_number,
        country=country,
        department=department,
        job_title=job_title,
        experience_level=experience_level,
        primary_skill=primary_skill,
        role=UserRole.employee,
        status=AccountStatus.pending_approval,
        password_hash=hash_password(password),
        must_change_password=False,
    )
    db.add(user)
    db.flush()
    db.add(EmployeeProfile(user_id=user.id, headline=None, cv_extract={}, ai_profile={}))
    db.commit()
    db.refresh(user)
    return user


def approve_user(db: Session, *, user_id: uuid.UUID, approver: User) -> User:
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user:
        raise ValueError("User not found")
    user.status = AccountStatus.active
    user.approved_by_user_id = approver.id
    # If a manager approves an employee, assign them to that manager automatically.
    if approver.role == UserRole.manager and user.role == UserRole.employee:
        user.manager_id = approver.id
    db.commit()
    db.refresh(user)
    return user


def change_password(db: Session, *, user: User, current_password: str, new_password: str) -> None:
    if not verify_password(current_password, user.password_hash):
        raise ValueError("Invalid current password")
    user.password_hash = hash_password(new_password)
    user.must_change_password = False
    db.commit()
