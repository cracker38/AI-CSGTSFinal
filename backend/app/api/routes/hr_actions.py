from __future__ import annotations

import csv
import io
import os
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.employee_profile import EmployeeProfile
from app.models.hr_action import HrAction
from app.models.user import AccountStatus, User, UserRole
from app.models.user_skill import SkillSource
from app.services.compliance_certificates import assign_hr_required_certification
from app.services.training_assignments import (
    apply_training_assignment_update,
    ensure_training_attendance_defaults,
    refresh_stale_training_sessions_global,
    training_assignment_to_progress_item,
)
from app.services.training_materials import get_material_download_path, save_training_course_material
from app.schemas.hr_action import (
    ComplianceRenewalRequest,
    CvFeedbackNoteRequest,
    CvValidationDecisionRequest,
    HrActionPublic,
    PromotionRecommendRequest,
    TrainingAssignRequest,
    TrainingEnrollmentReviewRequest,
    TrainingAssignmentProgressUpdate,
)
from app.services.audit import write_audit_log

router = APIRouter()


def _get_employee_or_400(db: Session, user_id: uuid.UUID) -> User:
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Target must be an employee account")
    return user


def _profile_for_user(db: Session, user_id: uuid.UUID) -> EmployeeProfile:
    profile = db.query(EmployeeProfile).filter(EmployeeProfile.user_id == user_id).one_or_none()
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee profile not found")
    return profile


@router.get("/hr/actions/recent", response_model=list[HrActionPublic])
def list_recent_hr_actions(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.hr_admin)),
    limit: int = Query(default=40, ge=1, le=200),
) -> list[HrAction]:
    return db.query(HrAction).order_by(HrAction.created_at.desc()).limit(limit).all()


@router.post("/hr/actions/cv-validation", response_model=HrActionPublic)
def decide_cv_validation(
    body: CvValidationDecisionRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.hr_admin)),
) -> HrAction:
    user = _get_employee_or_400(db, body.user_id)
    profile = _profile_for_user(db, user.id)
    ai = dict(profile.ai_profile or {})
    if body.decision == "approve":
        ai["primary_skill_validated"] = True
        ai["cv_validation_decision"] = "approved"
    else:
        ai["primary_skill_validated"] = False
        ai["cv_validation_decision"] = "rejected"
    if body.note is not None and str(body.note).strip():
        ai["cv_validation_note"] = str(body.note).strip()
    profile.ai_profile = ai
    db.add(profile)

    action = HrAction(
        target_user_id=user.id,
        created_by_id=actor.id,
        action_type="cv_skill_approve" if body.decision == "approve" else "cv_skill_reject",
        status="completed",
        note=body.note,
        payload={"decision": body.decision, "primary_skill": user.primary_skill},
    )
    db.add(action)
    db.commit()
    db.refresh(action)

    write_audit_log(
        db,
        request=request,
        actor_user_id=actor.id,
        action=f"hr.cv_validation.{body.decision}",
        entity_type="user",
        entity_id=str(user.id),
        meta={"hr_action_id": str(action.id), "decision": body.decision},
    )
    return action


@router.post("/hr/actions/cv-feedback-note", response_model=HrActionPublic)
def post_cv_feedback_note(
    body: CvFeedbackNoteRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.hr_admin)),
) -> HrAction:
    user = _get_employee_or_400(db, body.user_id)
    profile = _profile_for_user(db, user.id)
    ai = dict(profile.ai_profile or {})
    note = body.note.strip()
    ai["cv_validation_note"] = note
    ai["cv_validation_note_at"] = datetime.now(timezone.utc).isoformat()
    profile.ai_profile = ai
    db.add(profile)

    action = HrAction(
        target_user_id=user.id,
        created_by_id=actor.id,
        action_type="cv_feedback_note",
        status="completed",
        note=note,
        payload={"channel": "cv_note"},
    )
    db.add(action)
    db.commit()
    db.refresh(action)

    write_audit_log(
        db,
        request=request,
        actor_user_id=actor.id,
        action="hr.cv_feedback_note",
        entity_type="user",
        entity_id=str(user.id),
        meta={"hr_action_id": str(action.id)},
    )
    return action


@router.post("/hr/actions/training-assign", response_model=HrActionPublic)
def assign_training(
    body: TrainingAssignRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.hr_admin)),
) -> HrAction:
    user = _get_employee_or_400(db, body.user_id)
    if user.status != AccountStatus.active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Employee must be active")

    now_iso = datetime.now(timezone.utc).isoformat()
    link_meta = resolve_official_course_link(
        catalog_course_id=body.catalog_course_id,
        program_name=body.program_name,
        target_skill=body.target_skill,
        official_url=body.official_url,
        provider=body.provider,
    )
    payload = ensure_training_attendance_defaults(
        {
            "program_name": body.program_name,
            "target_skill": body.target_skill,
            "estimated_cost": body.estimated_cost,
            "progress_pct": 0,
            "assigned_at": now_iso,
            "source": "hr_assignment",
            "official_url": link_meta.get("official_url"),
            "provider": link_meta.get("provider"),
            "catalog_course_id": link_meta.get("catalog_course_id"),
        }
    )
    action = HrAction(
        target_user_id=user.id,
        created_by_id=actor.id,
        action_type="training_assign",
        status="assigned",
        note=body.note,
        payload=payload,
    )
    db.add(action)
    db.commit()
    db.refresh(action)

    write_audit_log(
        db,
        request=request,
        actor_user_id=actor.id,
        action="hr.training.assign",
        entity_type="user",
        entity_id=str(user.id),
        meta={"hr_action_id": str(action.id), **payload},
    )
    return action


@router.get("/hr/training-enrollment-requests")
def list_training_enrollment_requests(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.hr_admin)),
) -> list[dict]:
    rows = (
        db.query(HrAction, User)
        .join(User, User.id == HrAction.target_user_id)
        .filter(HrAction.action_type == "training_assign", HrAction.status == "pending")
        .order_by(HrAction.created_at.desc())
        .limit(200)
        .all()
    )
    out = []
    for action, employee in rows:
        payload = action.payload or {}
        out.append(
            {
                "id": str(action.id),
                "employee_id": str(employee.id),
                "employee_name": employee.full_name,
                "employee_email": employee.email,
                "program_name": payload.get("program_name"),
                "target_skill": payload.get("target_skill"),
                "provider": payload.get("provider"),
                "official_url": payload.get("official_url"),
                "requested_at": payload.get("requested_at"),
                "note": action.note,
                "created_at": action.created_at.isoformat() if action.created_at else None,
            }
        )
    return out


@router.post("/hr/training-enrollment-requests/{action_id}/approve", response_model=HrActionPublic)
def approve_training_enrollment_request(
    action_id: uuid.UUID,
    body: TrainingEnrollmentReviewRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.hr_admin)),
) -> HrAction:
    action = db.query(HrAction).filter(HrAction.id == action_id).one_or_none()
    if not action or action.action_type != "training_assign" or action.status != "pending":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pending enrollment request not found")
    now_iso = datetime.now(timezone.utc).isoformat()
    payload = ensure_training_attendance_defaults(dict(action.payload or {}))
    payload["approved_at"] = now_iso
    payload["approved_by"] = str(actor.id)
    payload["assigned_at"] = now_iso
    payload["source"] = "hr_approved_enrollment"
    action.payload = payload
    action.status = "assigned"
    if body.note and body.note.strip():
        action.note = body.note.strip()[:2000]
    db.add(action)
    db.commit()
    db.refresh(action)
    write_audit_log(
        db,
        request=request,
        actor_user_id=actor.id,
        action="hr.training.enrollment_approve",
        entity_type="hr_action",
        entity_id=str(action.id),
        meta={"target_user_id": str(action.target_user_id), "program_name": payload.get("program_name")},
    )
    return action


@router.post("/hr/training-enrollment-requests/{action_id}/reject", response_model=HrActionPublic)
def reject_training_enrollment_request(
    action_id: uuid.UUID,
    body: TrainingEnrollmentReviewRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.hr_admin)),
) -> HrAction:
    action = db.query(HrAction).filter(HrAction.id == action_id).one_or_none()
    if not action or action.action_type != "training_assign" or action.status != "pending":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pending enrollment request not found")
    payload = dict(action.payload or {})
    payload["rejected_at"] = datetime.now(timezone.utc).isoformat()
    payload["rejected_by"] = str(actor.id)
    action.payload = payload
    action.status = "rejected"
    if body.note and body.note.strip():
        action.note = body.note.strip()[:2000]
    db.add(action)
    db.commit()
    db.refresh(action)
    write_audit_log(
        db,
        request=request,
        actor_user_id=actor.id,
        action="hr.training.enrollment_reject",
        entity_type="hr_action",
        entity_id=str(action.id),
        meta={"target_user_id": str(action.target_user_id)},
    )
    return action


@router.get("/hr/training-assignments")
def list_open_training_assignments(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.hr_admin)),
    status_filter: str | None = Query(default=None, alias="status"),
) -> list[dict]:
    refresh_stale_training_sessions_global(db)
    q = (
        db.query(HrAction, User)
        .join(User, User.id == HrAction.target_user_id)
        .filter(HrAction.action_type == "training_assign")
        .order_by(HrAction.updated_at.desc())
    )
    if status_filter:
        q = q.filter(HrAction.status == status_filter)
    else:
        q = q.filter(HrAction.status.in_(["assigned", "in_progress"]))
    rows = q.limit(200).all()
    out = []
    for action, employee in rows:
        item = training_assignment_to_progress_item(action)
        out.append(
            {
                "id": item["id"],
                "employee_id": str(employee.id),
                "employee_name": employee.full_name,
                "employee_email": employee.email,
                "program_name": item["course"],
                "target_skill": item["skill"],
                "progress_pct": item["progress_pct"],
                "status": item["status"],
                "learning_state": item["learning_state"],
                "session_active": item["session_active"],
                "attendance_tier": item["attendance_tier"],
                "total_learning_seconds": item["total_learning_seconds"],
                "total_learning_display": item["total_learning_display"],
                "sessions_completed": item["sessions_completed"],
                "sessions_log": item["sessions_log"],
                "last_heartbeat_at": item["last_heartbeat_at"],
                "course_material_available": item.get("course_material_available"),
                "course_material_kind": item.get("course_material_kind"),
                "course_material_filename": item.get("course_material_filename"),
                "created_at": action.created_at.isoformat() if action.created_at else None,
                "updated_at": action.updated_at.isoformat() if action.updated_at else None,
            }
        )
    return out


@router.get("/hr/training-attendance-sessions/export")
def export_training_attendance_sessions(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.hr_admin)),
) -> Response:
    """CSV audit: one row per closed session (plus assignments with no sessions yet)."""
    refresh_stale_training_sessions_global(db)
    q = (
        db.query(HrAction, User)
        .join(User, User.id == HrAction.target_user_id)
        .filter(HrAction.action_type == "training_assign")
        .filter(HrAction.status.in_(["assigned", "in_progress", "completed"]))
        .order_by(HrAction.updated_at.desc())
        .limit(500)
    )
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "employee_email",
            "employee_name",
            "assignment_id",
            "course",
            "skill",
            "course_material_kind",
            "course_material_filename",
            "assignment_status",
            "attendance_tier",
            "total_verified_seconds",
            "progress_pct",
            "session_started_at",
            "session_ended_at",
            "session_billed_seconds",
            "closed_by",
        ]
    )
    for action, employee in q.all():
        item = training_assignment_to_progress_item(action)
        logs = list(item.get("sessions_log") or [])
        base = [
            employee.email or "",
            employee.full_name or "",
            str(action.id),
            item["course"],
            item["skill"],
            item.get("course_material_kind") or "",
            item.get("course_material_filename") or "",
            action.status,
            item["attendance_tier"],
            item["total_learning_seconds"],
            item["progress_pct"],
        ]
        if not logs:
            w.writerow(base + ["", "", "", "no_sessions_yet"])
        else:
            for entry in logs:
                w.writerow(
                    base
                    + [
                        entry.get("started_at") or "",
                        entry.get("ended_at") or "",
                        entry.get("seconds", ""),
                        entry.get("closed_by") or "",
                    ]
                )
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="training-attendance-sessions.csv"',
        },
    )


@router.post("/hr/training-assignments/{action_id}/course-material", response_model=HrActionPublic)
async def hr_upload_training_course_material(
    action_id: uuid.UUID,
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.hr_admin)),
) -> HrAction:
    action = db.query(HrAction).filter(HrAction.id == action_id).one_or_none()
    if not action or action.action_type != "training_assign":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Training assignment not found")
    upload_root = os.path.join(os.getcwd(), "uploads")
    try:
        action = await save_training_course_material(db, action, upload_root, file)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    write_audit_log(
        db,
        request=request,
        actor_user_id=actor.id,
        action="hr.training.course_material_upload",
        entity_type="hr_action",
        entity_id=str(action.id),
        meta={"target_user_id": str(action.target_user_id)},
    )
    return action


@router.get("/hr/training-assignments/{action_id}/course-material")
def hr_download_training_course_material(
    action_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.hr_admin)),
) -> FileResponse:
    action = db.query(HrAction).filter(HrAction.id == action_id).one_or_none()
    if not action or action.action_type != "training_assign":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Training assignment not found")
    upload_root = os.path.join(os.getcwd(), "uploads")
    path, fname, media_type = get_material_download_path(action, upload_root)
    return FileResponse(path, filename=fname, media_type=media_type)


@router.patch("/hr/training-assignments/{action_id}", response_model=HrActionPublic)
def hr_update_training_assignment(
    action_id: uuid.UUID,
    body: TrainingAssignmentProgressUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.hr_admin)),
) -> HrAction:
    action = db.query(HrAction).filter(HrAction.id == action_id).one_or_none()
    if not action or action.action_type != "training_assign":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Training assignment not found")
    try:
        action = apply_training_assignment_update(db, action, body, skill_source_on_complete=SkillSource.manager)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    write_audit_log(
        db,
        request=request,
        actor_user_id=actor.id,
        action="hr.training.progress",
        entity_type="hr_action",
        entity_id=str(action.id),
        meta={"target_user_id": str(action.target_user_id), "status": action.status},
    )
    return action


@router.post("/hr/actions/compliance-renewal", response_model=HrActionPublic)
def mark_compliance_renewal(
    body: ComplianceRenewalRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.hr_admin)),
) -> HrAction:
    user = _get_employee_or_400(db, body.user_id)
    profile = _profile_for_user(db, user.id)
    ai = dict(profile.ai_profile or {})

    cert_label = (body.certification or "").strip()
    is_missing_row = cert_label.lower() in {"none", ""} or body.required_certification

    if is_missing_row:
        req_name = (body.required_certification or "").strip()
        if not req_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Required certification name is required when the employee has no certificate on file.",
            )
        entry = assign_hr_required_certification(
            profile,
            required_certification=req_name,
            due_date=body.due_date,
            note=body.note,
            assigned_by=actor.id,
        )
        db.add(profile)
        action = HrAction(
            target_user_id=user.id,
            created_by_id=actor.id,
            action_type="compliance_requirement",
            status="completed",
            note=body.note,
            payload={
                "required_certification": req_name,
                "due_date": entry.get("due_date"),
                "requirement_id": entry.get("id"),
            },
        )
        db.add(action)
        db.commit()
        db.refresh(action)
        write_audit_log(
            db,
            request=request,
            actor_user_id=actor.id,
            action="hr.compliance.requirement_assigned",
            entity_type="user",
            entity_id=str(user.id),
            meta={"hr_action_id": str(action.id), "required_certification": req_name},
        )
        return action

    valid_until = body.renewed_until or (date.today() + timedelta(days=365))
    renewals = list(ai.get("hr_compliance_renewals") or [])
    renewals.append(
        {
            "certification": body.certification,
            "valid_until": valid_until.isoformat(),
            "recorded_at": datetime.now(timezone.utc).isoformat(),
            "recorded_by": str(actor.id),
            "note": body.note,
        }
    )
    ai["hr_compliance_renewals"] = renewals
    profile.ai_profile = ai
    db.add(profile)

    action = HrAction(
        target_user_id=user.id,
        created_by_id=actor.id,
        action_type="compliance_renewal",
        status="completed",
        note=body.note,
        payload={"certification": body.certification, "valid_until": valid_until.isoformat()},
    )
    db.add(action)
    db.commit()
    db.refresh(action)

    write_audit_log(
        db,
        request=request,
        actor_user_id=actor.id,
        action="hr.compliance.renewal",
        entity_type="user",
        entity_id=str(user.id),
        meta={"hr_action_id": str(action.id), "certification": body.certification},
    )
    return action


@router.post("/hr/actions/promotion-recommend", response_model=HrActionPublic)
def recommend_promotion(
    body: PromotionRecommendRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.hr_admin)),
) -> HrAction:
    user = _get_employee_or_400(db, body.user_id)
    payload = {"readiness_score": body.readiness_score}
    action = HrAction(
        target_user_id=user.id,
        created_by_id=actor.id,
        action_type="promotion_recommend",
        status="completed",
        note=body.note,
        payload={k: v for k, v in payload.items() if v is not None},
    )
    db.add(action)
    db.commit()
    db.refresh(action)

    write_audit_log(
        db,
        request=request,
        actor_user_id=actor.id,
        action="hr.promotion.recommend",
        entity_type="user",
        entity_id=str(user.id),
        meta={"hr_action_id": str(action.id), **action.payload},
    )
    return action
