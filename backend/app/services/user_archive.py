"""Soft-archive user accounts (retain records, revoke platform access)."""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.models.user import AccountStatus, User
from app.services.user_delete import is_protected_admin


def archive_user_for_admin(db: Session, *, admin_id: uuid.UUID, user_id: uuid.UUID) -> User:
    if admin_id == user_id:
        raise ValueError("Cannot archive your own account")

    target = db.query(User).filter(User.id == user_id).one_or_none()
    if not target:
        raise ValueError("User not found")

    if is_protected_admin(target):
        raise ValueError("Administrator accounts cannot be archived")

    if target.status == AccountStatus.archived:
        raise ValueError("User is already archived")

    db.query(User).filter(User.manager_id == user_id).update({User.manager_id: None}, synchronize_session=False)
    target.manager_id = None
    target.status = AccountStatus.archived
    db.commit()
    db.refresh(target)
    return target


def restore_user_for_admin(db: Session, *, user_id: uuid.UUID) -> User:
    target = db.query(User).filter(User.id == user_id).one_or_none()
    if not target:
        raise ValueError("User not found")

    if target.status != AccountStatus.archived:
        raise ValueError("Only archived accounts can be restored")

    target.status = AccountStatus.active
    db.commit()
    db.refresh(target)
    return target
