import csv
import io
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from sqlalchemy import desc
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.security import hash_password
from app.db.session import get_db
from app.models.audit_log import AuditLog
from app.models.backup_job import BackupJob, BackupStatus
from app.models.integration import Integration, IntegrationType
from app.models.system_setting import SystemSetting
from app.models.employee_profile import EmployeeProfile
from app.models.user import AccountStatus, User, UserRole
from app.schemas.admin import AuditLogPublic
from app.schemas.system_admin import (
    BackupJobPublic,
    BackupRequest,
    IntegrationPublic,
    IntegrationUpsert,
    SystemSettingPublic,
    SystemSettingUpsert,
)
from app.services.audit import write_audit_log


router = APIRouter()

IMPORT_DEFAULT_PASSWORD = "ImportedUser123!"


def _csv_row_norm(raw: dict) -> dict[str, str]:
    return {(str(k) or "").strip().lower(): (str(v) if v is not None else "").strip() for k, v in raw.items()}


def _g(r: dict[str, str], key: str) -> str:
    return r.get(key.lower(), "").strip()


def _apply_user_import_row(db: Session, admin: User, raw: dict) -> str:
    r = _csv_row_norm(raw)
    rid = _g(r, "id")
    email = _g(r, "email")

    user: User | None = None
    if rid:
        try:
            uid = uuid.UUID(rid)
            user = db.query(User).filter(User.id == uid).one_or_none()
        except ValueError:
            user = None
    if user is None and email:
        user = db.query(User).filter(User.email == email.lower()).one_or_none()

    def pick(field: str, default: str = "N/A") -> str:
        v = _g(r, field)
        return v if v else default

    role_str = pick("role", "employee")
    if role_str == UserRole.system_admin.value:
        raise ValueError("system_admin cannot be created or updated via CSV import")

    if user:
        if user.role == UserRole.system_admin:
            if _g(r, "role") or _g(r, "status"):
                raise ValueError("cannot change system_admin role/status via import")
        pairs = [
            ("full_name", "full_name"),
            ("phone_number", "phone_number"),
            ("country", "country"),
            ("department", "department"),
            ("job_title", "job_title"),
            ("experience_level", "experience_level"),
            ("primary_skill", "primary_skill"),
        ]
        for csv_key, attr in pairs:
            if _g(r, csv_key):
                setattr(user, attr, _g(r, csv_key))
        if _g(r, "email"):
            em = _g(r, "email").lower()
            if em != user.email:
                if db.query(User).filter(User.email == em, User.id != user.id).first():
                    raise ValueError("email already in use")
                user.email = em
        if _g(r, "role"):
            user.role = UserRole(role_str)
        if _g(r, "status"):
            user.status = AccountStatus(_g(r, "status"))
        if _g(r, "password"):
            user.password_hash = hash_password(_g(r, "password"))
            user.must_change_password = True
        mid_s = _g(r, "manager_id")
        if mid_s and user.role == UserRole.employee:
            mid = uuid.UUID(mid_s)
            mgr = db.query(User).filter(User.id == mid, User.role == UserRole.manager).one_or_none()
            if not mgr:
                raise ValueError("invalid manager_id")
            user.manager_id = mid
        elif _g(r, "manager_id") == "" and user.role == UserRole.employee:
            user.manager_id = None
        db.flush()
        return "updated"

    if not email:
        raise ValueError("email is required to create a user")

    role = UserRole(role_str)
    status_s = pick("status", "pending_approval")
    acc_status = AccountStatus(status_s)
    pw_plain = _g(r, "password") or IMPORT_DEFAULT_PASSWORD
    nu = User(
        email=email.lower(),
        full_name=pick("full_name", "Imported User"),
        phone_number=pick("phone_number"),
        country=pick("country"),
        department=pick("department"),
        job_title=pick("job_title"),
        experience_level=pick("experience_level", "Intermediate"),
        primary_skill=pick("primary_skill", "general"),
        role=role,
        status=acc_status,
        password_hash=hash_password(pw_plain),
        must_change_password=True,
        approved_by_user_id=admin.id,
    )
    mid_s = _g(r, "manager_id")
    if mid_s and role == UserRole.employee:
        mid = uuid.UUID(mid_s)
        mgr = db.query(User).filter(User.id == mid, User.role == UserRole.manager).one_or_none()
        if not mgr:
            raise ValueError("invalid manager_id")
        nu.manager_id = mid
    db.add(nu)
    db.flush()
    if role == UserRole.employee:
        db.add(EmployeeProfile(user_id=nu.id, headline=None, cv_extract={}, ai_profile={}))
    db.flush()
    return "created"


@router.get("/audit-logs", response_model=list[AuditLogPublic])
def list_audit_logs(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.system_admin)),
    limit: int = Query(50, ge=1, le=200),
) -> list[AuditLogPublic]:
    logs = db.query(AuditLog).order_by(desc(AuditLog.created_at)).limit(limit).all()
    return [
        AuditLogPublic(
            id=l.id,
            created_at=l.created_at,
            actor_user_id=l.actor_user_id,
            action=l.action,
            entity_type=l.entity_type,
            entity_id=l.entity_id,
            meta=l.meta or {},
            ip_address=l.ip_address,
            user_agent=l.user_agent,
        )
        for l in logs
    ]


@router.get("/health")
def system_health(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.system_admin)),
) -> dict:
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    return {"ok": True, "db_ok": db_ok}


@router.get("/roles-permissions")
def roles_permissions(
    _: User = Depends(require_roles(UserRole.system_admin)),
) -> dict:
    # Roles are fixed in this MVP; this is the explicit permission matrix the UI can display.
    matrix = {
        "employee": ["self_profile", "self_skills", "self_assessment", "self_gaps", "training_recs", "goals", "notifications"],
        "manager": ["team_directory", "team_gaps", "approvals", "team_projects", "availability", "alerts"],
        "hr_admin": ["org_records", "org_gaps", "training_planning", "budget", "compliance", "recruitment_insights", "cv_validation"],
        "system_admin": ["user_management", "role_control", "audit_logs", "import_export", "health"],
    }
    return {"matrix": matrix}


@router.get("/settings", response_model=list[SystemSettingPublic])
def list_settings(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.system_admin)),
) -> list[SystemSettingPublic]:
    rows = db.query(SystemSetting).order_by(SystemSetting.key.asc()).all()
    return [
        SystemSettingPublic(
            id=r.id,
            key=r.key,
            value=r.value or {},
            updated_by_user_id=r.updated_by_user_id,
            updated_at=r.updated_at,
        )
        for r in rows
    ]


@router.put("/settings", response_model=SystemSettingPublic)
def upsert_setting(
    payload: SystemSettingUpsert,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.system_admin)),
) -> SystemSettingPublic:
    row = db.query(SystemSetting).filter(SystemSetting.key == payload.key).one_or_none()
    if not row:
        row = SystemSetting(key=payload.key, value=payload.value, updated_by_user_id=admin.id)
        db.add(row)
    else:
        row.value = payload.value
        row.updated_by_user_id = admin.id
    db.commit()
    db.refresh(row)

    write_audit_log(
        db,
        request=None,
        actor_user_id=admin.id,
        action="admin.setting_upsert",
        entity_type="system_setting",
        entity_id=str(row.id),
        meta={"key": row.key},
    )

    return SystemSettingPublic(
        id=row.id,
        key=row.key,
        value=row.value or {},
        updated_by_user_id=row.updated_by_user_id,
        updated_at=row.updated_at,
    )


@router.get("/integrations", response_model=list[IntegrationPublic])
def list_integrations(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.system_admin)),
) -> list[IntegrationPublic]:
    rows = db.query(Integration).order_by(Integration.name.asc()).all()
    return [
        IntegrationPublic(
            id=r.id,
            name=r.name,
            type=r.type.value,
            enabled=r.enabled,
            config=r.config or {},
            updated_by_user_id=r.updated_by_user_id,
            updated_at=r.updated_at,
        )
        for r in rows
    ]


@router.put("/integrations", response_model=IntegrationPublic)
def upsert_integration(
    payload: IntegrationUpsert,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.system_admin)),
) -> IntegrationPublic:
    row = db.query(Integration).filter(Integration.name == payload.name).one_or_none()
    if not row:
        row = Integration(
            name=payload.name,
            type=IntegrationType(payload.type),
            enabled=payload.enabled,
            config=payload.config,
            updated_by_user_id=admin.id,
        )
        db.add(row)
    else:
        row.type = IntegrationType(payload.type)
        row.enabled = payload.enabled
        row.config = payload.config
        row.updated_by_user_id = admin.id
    db.commit()
    db.refresh(row)

    write_audit_log(
        db,
        request=None,
        actor_user_id=admin.id,
        action="admin.integration_upsert",
        entity_type="integration",
        entity_id=str(row.id),
        meta={"name": row.name, "type": row.type.value, "enabled": row.enabled},
    )

    return IntegrationPublic(
        id=row.id,
        name=row.name,
        type=row.type.value,
        enabled=row.enabled,
        config=row.config or {},
        updated_by_user_id=row.updated_by_user_id,
        updated_at=row.updated_at,
    )


@router.get("/export/users.csv")
def export_users_csv(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.system_admin)),
) -> Response:
    users = db.query(User).order_by(User.created_at.asc()).all()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "id",
            "email",
            "full_name",
            "phone_number",
            "country",
            "department",
            "job_title",
            "experience_level",
            "primary_skill",
            "role",
            "status",
            "must_change_password",
            "manager_id",
            "created_at",
        ]
    )
    for u in users:
        writer.writerow(
            [
                str(u.id),
                u.email,
                u.full_name,
                u.phone_number,
                u.country,
                u.department,
                u.job_title,
                u.experience_level,
                u.primary_skill,
                u.role.value,
                u.status.value,
                "true" if u.must_change_password else "false",
                str(u.manager_id) if getattr(u, "manager_id", None) else "",
                u.created_at.isoformat() if u.created_at else "",
            ]
        )
    content = buf.getvalue().encode("utf-8-sig")
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="users_export.csv"'},
    )


@router.post("/import/users")
async def import_users_csv(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.system_admin)),
) -> dict:
    if (file.content_type or "").lower() not in {"text/csv", "application/vnd.ms-excel", "application/octet-stream"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV required")
    raw_bytes = await file.read()
    data = raw_bytes.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(data))
    if not reader.fieldnames:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV must include a header row")

    created = 0
    updated = 0
    errors: list[dict] = []
    for i, row in enumerate(reader, start=2):
        try:
            kind = _apply_user_import_row(db, admin, row)
            db.commit()
            if kind == "created":
                created += 1
            else:
                updated += 1
        except Exception as e:
            db.rollback()
            errors.append({"row": i, "detail": str(e)[:400]})

    write_audit_log(
        db,
        request=request,
        actor_user_id=admin.id,
        action="admin.import_users",
        entity_type="file",
        entity_id=str(uuid.uuid4()),
        meta={"filename": file.filename, "created": created, "updated": updated, "error_count": len(errors)},
    )
    return {
        "ok": len(errors) == 0,
        "created": created,
        "updated": updated,
        "errors": errors,
        "message": f"Import finished: {created} created, {updated} updated, {len(errors)} row errors.",
    }


@router.get("/backups", response_model=list[BackupJobPublic])
def list_backups(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.system_admin)),
    limit: int = Query(30, ge=1, le=200),
) -> list[BackupJobPublic]:
    rows = db.query(BackupJob).order_by(desc(BackupJob.created_at)).limit(limit).all()
    return [
        BackupJobPublic(
            id=r.id,
            status=r.status.value,
            label=r.label,
            requested_by_user_id=r.requested_by_user_id,
            created_at=r.created_at,
            started_at=r.started_at,
            completed_at=r.completed_at,
            meta=r.meta or {},
        )
        for r in rows
    ]


@router.post("/backups", response_model=BackupJobPublic)
def request_backup(
    payload: BackupRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.system_admin)),
) -> BackupJobPublic:
    job = BackupJob(status=BackupStatus.requested, label=payload.label, requested_by_user_id=admin.id, meta={})
    db.add(job)
    db.commit()
    db.refresh(job)

    write_audit_log(
        db,
        request=None,
        actor_user_id=admin.id,
        action="admin.backup_requested",
        entity_type="backup_job",
        entity_id=str(job.id),
        meta={"label": job.label},
    )

    return BackupJobPublic(
        id=job.id,
        status=job.status.value,
        label=job.label,
        requested_by_user_id=job.requested_by_user_id,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        meta=job.meta or {},
    )

