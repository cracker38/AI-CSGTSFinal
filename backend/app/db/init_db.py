from __future__ import annotations

import logging

from sqlalchemy.orm import Session
from sqlalchemy import inspect, text

from app.core.config import settings
from app.core.security import hash_password
from app.models.employee_profile import EmployeeProfile
from app.models.master_data import DepartmentCatalog, JobTitleCatalog
from app.models.skill import Skill
from app.models.user import AccountStatus, User, UserRole

logger = logging.getLogger(__name__)


def ensure_default_system_admin(db: Session) -> None:
    email = settings.default_system_admin_email.strip().lower()
    user = db.query(User).filter(User.email == email).one_or_none()
    if user:
        if user.role != UserRole.system_admin:
            logger.warning(
                "DEFAULT_SYSTEM_ADMIN_EMAIL %r is already used by a %s account; cannot seed system admin. "
                "Pick a different DEFAULT_SYSTEM_ADMIN_EMAIL or free that email in the database.",
                email,
                user.role.value,
            )
            return
        if settings.sync_default_admin_password_on_startup:
            user.password_hash = hash_password(settings.default_system_admin_password)
            db.commit()
        return

    # One active system admin with a different email (e.g. after changing .env): align email + password.
    admins = (
        db.query(User)
        .filter(User.role == UserRole.system_admin, User.status == AccountStatus.active)
        .all()
    )
    if len(admins) == 1:
        lone = admins[0]
        lone.email = email
        lone.password_hash = hash_password(settings.default_system_admin_password)
        lone.must_change_password = True
        db.commit()
        return

    user = User(
        email=email,
        full_name="System Admin",
        phone_number="N/A",
        country="N/A",
        department="IT",
        job_title="System Administrator",
        experience_level="Expert",
        primary_skill="Administration",
        role=UserRole.system_admin,
        status=AccountStatus.active,
        password_hash=hash_password(settings.default_system_admin_password),
        must_change_password=True,
    )
    db.add(user)
    db.flush()
    db.add(EmployeeProfile(user_id=user.id, headline="Default System Admin", cv_extract={}, ai_profile={}))
    db.commit()


def ensure_master_catalogs(db: Session) -> None:
    # Bootstrap catalogs from existing users/skills so registration has real DB-driven options.
    existing_departments = {name for (name,) in db.query(DepartmentCatalog.name).all()}
    existing_job_titles = {name for (name,) in db.query(JobTitleCatalog.name).all()}
    existing_skills = {name.lower() for (name,) in db.query(Skill.name).all()}

    user_rows = db.query(User.department, User.job_title, User.primary_skill).all()
    changed = False
    for department, job_title, primary_skill in user_rows:
        if department and department != "N/A" and department not in existing_departments:
            db.add(DepartmentCatalog(name=department, active=True))
            existing_departments.add(department)
            changed = True
        if job_title and job_title != "N/A" and job_title not in existing_job_titles:
            db.add(JobTitleCatalog(name=job_title, active=True))
            existing_job_titles.add(job_title)
            changed = True
        if primary_skill and primary_skill.lower() not in existing_skills:
            db.add(Skill(name=primary_skill, category="general"))
            existing_skills.add(primary_skill.lower())
            changed = True
    if changed:
        db.commit()


def ensure_team_assignment_schema(db: Session) -> None:
    """
    Dev-friendly schema patching.
    Adds `users.manager_id` if missing so employee->manager assignment is supported.
    """
    bind = db.get_bind()
    inspector = inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("users")}
    if "manager_id" in cols:
        return
    # SQLite / Postgres: ADD COLUMN works for nullable columns.
    with bind.connect() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN manager_id UUID NULL"))
        conn.commit()
