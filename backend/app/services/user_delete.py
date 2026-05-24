"""Hard-delete a user and dependent rows (system admin tool)."""

from __future__ import annotations

import uuid

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.backup_job import BackupJob
from app.models.cv_document import CvDocument
from app.models.employee_profile import EmployeeProfile
from app.models.hr_action import HrAction
from app.models.login_otp import LoginOtp
from app.models.manager_project import EmployeeProjectDailyReport, ManagerProject, ProjectAssignment
from app.models.master_data import CatalogRequest
from app.models.user_skill import UserSkill
from app.models.user import User, UserRole

PROTECTED_ADMIN_ROLES = frozenset({UserRole.system_admin, UserRole.hr_admin})


def is_protected_admin(user: User) -> bool:
    return user.role in PROTECTED_ADMIN_ROLES


def delete_user_for_admin(db: Session, *, admin_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """
    Remove user and owned/linked rows. Raises ValueError for business rule violations.
    """
    if admin_id == user_id:
        raise ValueError("Cannot delete your own account")

    target = db.query(User).filter(User.id == user_id).one_or_none()
    if not target:
        raise ValueError("User not found")

    if is_protected_admin(target):
        raise ValueError("Cannot delete administrator accounts")

    db.query(User).filter(User.manager_id == user_id).update({User.manager_id: None}, synchronize_session=False)
    db.query(User).filter(User.approved_by_user_id == user_id).update({User.approved_by_user_id: None}, synchronize_session=False)

    db.query(ManagerProject).filter(ManagerProject.manager_id == user_id).delete(synchronize_session=False)
    db.query(ProjectAssignment).filter(ProjectAssignment.employee_id == user_id).delete(synchronize_session=False)
    db.query(EmployeeProjectDailyReport).filter(EmployeeProjectDailyReport.employee_id == user_id).delete(synchronize_session=False)

    db.query(HrAction).filter((HrAction.target_user_id == user_id) | (HrAction.created_by_id == user_id)).delete(
        synchronize_session=False
    )

    db.query(CatalogRequest).filter(
        or_(CatalogRequest.requested_by_user_id == user_id, CatalogRequest.reviewed_by_user_id == user_id)
    ).delete(synchronize_session=False)

    db.query(LoginOtp).filter(LoginOtp.user_id == user_id).delete(synchronize_session=False)
    db.query(UserSkill).filter(UserSkill.user_id == user_id).delete(synchronize_session=False)
    db.query(CvDocument).filter(CvDocument.user_id == user_id).delete(synchronize_session=False)
    db.query(EmployeeProfile).filter(EmployeeProfile.user_id == user_id).delete(synchronize_session=False)
    db.query(BackupJob).filter(BackupJob.requested_by_user_id == user_id).delete(synchronize_session=False)

    db.delete(target)
    db.commit()
