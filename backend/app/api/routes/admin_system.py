import uuid

from fastapi import APIRouter, Depends, Query, Response, UploadFile, File, HTTPException, status
from sqlalchemy import desc
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.audit_log import AuditLog
from app.models.backup_job import BackupJob, BackupStatus
from app.models.integration import Integration, IntegrationType
from app.models.system_setting import SystemSetting
from app.models.user import User, UserRole
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
        "system_admin": ["user_management", "role_control", "system_config", "integrations", "audit_logs", "import_export", "health", "backup"],
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
    header = "id,email,full_name,role,status,created_at\n"
    lines = [header]
    for u in users:
        lines.append(f"{u.id},{u.email},{u.full_name},{u.role.value},{u.status.value},{u.created_at.isoformat()}\n")
    content = "".join(lines).encode("utf-8")
    return Response(content=content, media_type="text/csv")


@router.post("/import/users")
async def import_users_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.system_admin)),
) -> dict:
    if (file.content_type or "").lower() not in {"text/csv", "application/vnd.ms-excel", "application/octet-stream"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV required")
    data = (await file.read()).decode("utf-8", errors="replace")
    # MVP: accept CSV and store audit event; actual bulk import is enterprise-hardening work (validation, rollback).
    write_audit_log(
        db,
        request=None,
        actor_user_id=admin.id,
        action="admin.import_users_received",
        entity_type="file",
        entity_id=str(uuid.uuid4()),
        meta={"filename": file.filename, "bytes": len(data.encode('utf-8'))},
    )
    return {"ok": True, "note": "CSV received and logged. Bulk import execution can be enabled next."}


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

