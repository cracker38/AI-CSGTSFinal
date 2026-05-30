from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.employee_profile import EmployeeProfile
from app.models.hr_action import HrAction
from app.models.manager_project import ManagerProject, ProjectAssignment, ProjectSkillRequirement, ProjectStatus
from app.models.skill import Skill
from app.models.user import User
from app.models.user_skill import SkillSource, UserSkill
from app.schemas.hr_action import MaterialReadingProgressUpdate, TrainingAssignmentProgressUpdate
from app.services.employee_competency import (
    build_employee_cv_competency,
    competency_summary_dict,
    training_competency_boost_pct,
    workforce_competency_index,
)
from app.services.training_catalog import resolve_official_course_link

# Heartbeat gap after which an open session is auto-paused (employee idle / closed browser).
def stale_heartbeat_seconds() -> int:
    try:
        return max(120, int(settings.training_stale_heartbeat_seconds))
    except (TypeError, ValueError):
        return 30 * 60
# Ignore very short sessions (accidental double-clicks).
MIN_SESSION_SECONDS = 60

LEARNING_NOT_ATTENDING = "not_attending"
LEARNING_IN_SESSION = "in_session"
LEARNING_PAUSED = "paused"


def _parse_iso(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        s = value.replace("Z", "+00:00")
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _seconds_between(start: datetime, end: datetime) -> int:
    return max(0, int((end - start).total_seconds()))


def _format_duration(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds}s"
    m, s = divmod(seconds, 60)
    if m < 60:
        return f"{m}m {s}s" if s else f"{m}m"
    h, m = divmod(m, 60)
    return f"{h}h {m}m"


def ensure_training_attendance_defaults(payload: dict) -> dict:
    p = dict(payload or {})
    if not p.get("learning_state"):
        p["learning_state"] = LEARNING_NOT_ATTENDING
    p.setdefault("total_learning_seconds", 0)
    p.setdefault("sessions_log", [])
    return p


def apply_stale_autopause_if_needed(action: HrAction, *, now: datetime | None = None) -> bool:
    """Close an abandoned in-session state. Returns True if payload was mutated (caller should commit)."""
    if action.status in ("completed", "cancelled"):
        return False
    now = now or datetime.now(timezone.utc)
    payload = ensure_training_attendance_defaults(dict(action.payload or {}))
    if payload.get("learning_state") != LEARNING_IN_SESSION:
        action.payload = payload
        return False
    started = _parse_iso(payload.get("current_session_started_at"))
    last_hb = _parse_iso(payload.get("last_heartbeat_at")) or started
    if not last_hb:
        payload["learning_state"] = LEARNING_PAUSED
        payload["session_autopause_reason"] = "missing_timestamps"
        payload["current_session_started_at"] = None
        action.payload = payload
        return True
    if _seconds_between(last_hb, now) <= stale_heartbeat_seconds():
        action.payload = payload
        return False

    # Stale: close session from start to last heartbeat (capped, professional attendance).
    session_end = last_hb
    if started:
        raw_sec = _seconds_between(started, session_end)
        billable = max(0, raw_sec) if raw_sec >= MIN_SESSION_SECONDS else 0
        if billable:
            payload["total_learning_seconds"] = int(payload.get("total_learning_seconds") or 0) + billable
            log = list(payload.get("sessions_log") or [])
            log.append(
                {
                    "started_at": started.isoformat(),
                    "ended_at": session_end.isoformat(),
                    "seconds": billable,
                    "closed_by": "auto_idle_timeout",
                }
            )
            payload["sessions_log"] = log[-100:]
    payload["learning_state"] = LEARNING_PAUSED
    payload["current_session_started_at"] = None
    payload["session_autopause_reason"] = f"no_heartbeat_{stale_heartbeat_seconds()}s"
    payload["last_autopause_at"] = now.isoformat()
    action.payload = payload
    return True


def refresh_stale_training_sessions(db: Session, user_id: uuid.UUID) -> None:
    rows = (
        db.query(HrAction)
        .filter(
            HrAction.target_user_id == user_id,
            HrAction.action_type == "training_assign",
            HrAction.status.in_(["assigned", "in_progress"]),
        )
        .all()
    )
    changed = False
    for r in rows:
        if apply_stale_autopause_if_needed(r):
            changed = True
            db.add(r)
    if changed:
        db.commit()


def refresh_stale_training_sessions_global(db: Session) -> None:
    rows = (
        db.query(HrAction)
        .filter(
            HrAction.action_type == "training_assign",
            HrAction.status.in_(["assigned", "in_progress"]),
        )
        .all()
    )
    changed = False
    for r in rows:
        if apply_stale_autopause_if_needed(r):
            changed = True
            db.add(r)
    if changed:
        db.commit()


def _require_hr_approved_training(action: HrAction) -> None:
    if action.status == "pending":
        raise ValueError("This training is pending HR approval. You will be notified when HR approves and uploads course content.")
    if action.status == "rejected":
        raise ValueError("This training request was declined by HR.")


def start_training_session(db: Session, action: HrAction) -> HrAction:
    if action.action_type != "training_assign":
        raise ValueError("Not a training assignment")
    _require_hr_approved_training(action)
    if action.status in ("completed", "cancelled"):
        raise ValueError("Training is not active")
    if apply_stale_autopause_if_needed(action):
        db.add(action)
        db.commit()
        db.refresh(action)
    payload = ensure_training_attendance_defaults(dict(action.payload or {}))
    if payload.get("learning_state") == LEARNING_IN_SESSION:
        return action
    now_iso = _now_iso()
    payload["learning_state"] = LEARNING_IN_SESSION
    payload["current_session_started_at"] = now_iso
    payload["last_heartbeat_at"] = now_iso
    payload["session_started_count"] = int(payload.get("session_started_count") or 0) + 1
    action.payload = payload
    if action.status == "assigned":
        action.status = "in_progress"
    db.add(action)
    db.commit()
    db.refresh(action)
    return action


def _close_open_session_payload(payload: dict, ended_at: datetime, *, closed_by: str) -> dict:
    p = ensure_training_attendance_defaults(dict(payload))
    if p.get("learning_state") != LEARNING_IN_SESSION:
        return p
    started = _parse_iso(p.get("current_session_started_at"))
    last_hb = _parse_iso(p.get("last_heartbeat_at")) or started
    if not started:
        p["learning_state"] = LEARNING_PAUSED
        p["current_session_started_at"] = None
        return p
    end = last_hb if last_hb and last_hb <= ended_at else ended_at
    raw_sec = _seconds_between(started, end)
    billable = raw_sec if raw_sec >= MIN_SESSION_SECONDS else 0
    if billable:
        p["total_learning_seconds"] = int(p.get("total_learning_seconds") or 0) + billable
        log = list(p.get("sessions_log") or [])
        log.append(
            {
                "started_at": started.isoformat(),
                "ended_at": end.isoformat(),
                "seconds": billable,
                "closed_by": closed_by,
            }
        )
        p["sessions_log"] = log[-100:]
    p["learning_state"] = LEARNING_PAUSED
    p["current_session_started_at"] = None
    p["last_session_ended_at"] = end.isoformat()
    return p


def end_training_session(db: Session, action: HrAction) -> HrAction:
    if action.action_type != "training_assign":
        raise ValueError("Not a training assignment")
    _require_hr_approved_training(action)
    if action.status in ("completed", "cancelled"):
        raise ValueError("Training is not active")
    if apply_stale_autopause_if_needed(action):
        db.add(action)
        db.commit()
        db.refresh(action)
    payload = ensure_training_attendance_defaults(dict(action.payload or {}))
    if payload.get("learning_state") != LEARNING_IN_SESSION:
        return action
    ended_at = datetime.now(timezone.utc)
    action.payload = _close_open_session_payload(payload, ended_at, closed_by="employee_end")
    db.add(action)
    db.commit()
    db.refresh(action)
    return action


def training_session_heartbeat(db: Session, action: HrAction) -> HrAction:
    if action.action_type != "training_assign":
        raise ValueError("Not a training assignment")
    _require_hr_approved_training(action)
    if action.status in ("completed", "cancelled"):
        raise ValueError("Training is not active")
    if apply_stale_autopause_if_needed(action):
        db.add(action)
        db.commit()
        db.refresh(action)
    payload = ensure_training_attendance_defaults(dict(action.payload or {}))
    if payload.get("learning_state") != LEARNING_IN_SESSION:
        raise ValueError("No active learning session; start a session first")
    now_iso = _now_iso()
    payload["last_heartbeat_at"] = now_iso
    action.payload = payload
    db.add(action)
    db.commit()
    db.refresh(action)
    return action


def _recompute_material_progress_pct(payload: dict) -> int:
    kind = str(payload.get("course_material_kind") or "").lower()
    if kind == "pdf":
        total = int(payload.get("material_pdf_total_pages") or 0)
        if total <= 0:
            return int(payload.get("material_progress_pct") or 0)
        raw = payload.get("material_pdf_completed_pages") or []
        if not isinstance(raw, list):
            return 0
        pages: set[int] = set()
        for p in raw:
            try:
                n = int(p)
                if 1 <= n <= total:
                    pages.add(n)
            except (TypeError, ValueError):
                continue
        return min(100, int(round(100 * len(pages) / total)))
    if kind == "video":
        dur = float(payload.get("material_video_duration_sec") or 0)
        mx = float(payload.get("material_video_max_position_sec") or 0)
        if dur <= 0:
            return int(payload.get("material_progress_pct") or 0)
        return min(100, int(round(100 * min(mx, dur) / dur)))
    return int(payload.get("material_progress_pct") or 0)


def apply_material_reading_progress(
    db: Session,
    action: HrAction,
    body: MaterialReadingProgressUpdate,
) -> HrAction:
    """Record PDF page or video watch progress; may raise course progress % while in_session."""
    if action.action_type != "training_assign":
        raise ValueError("Not a training assignment")
    if action.status in ("completed", "cancelled"):
        raise ValueError("Training is not editable")
    apply_stale_autopause_if_needed(action)
    payload = ensure_training_attendance_defaults(dict(action.payload or {}))
    if not (payload.get("course_material_stored") or "").strip():
        raise ValueError("No course material uploaded for this assignment")

    kind = str(payload.get("course_material_kind") or "").lower()
    has_pdf = body.pdf_page_completed is not None
    has_vid = body.video_position_sec is not None and body.video_duration_sec is not None
    if not has_pdf and not has_vid:
        raise ValueError("Send pdf_page_completed or video position and duration")

    if has_pdf:
        if kind != "pdf":
            raise ValueError("This assignment is not a PDF course file")
        if body.pdf_total_pages is not None:
            payload["material_pdf_total_pages"] = int(body.pdf_total_pages)
        total = int(payload.get("material_pdf_total_pages") or 0)
        if total <= 0:
            raise ValueError("PDF total pages missing")
        pg = int(body.pdf_page_completed or 0)
        if not (1 <= pg <= total):
            raise ValueError("Invalid page number")
        raw_pages = payload.get("material_pdf_completed_pages") or []
        pages_int: list[int] = []
        if isinstance(raw_pages, list):
            for p in raw_pages:
                try:
                    pages_int.append(int(p))
                except (TypeError, ValueError):
                    pass
        if pg not in pages_int:
            pages_int.append(pg)
        pages_int = sorted({p for p in pages_int if 1 <= p <= total})
        payload["material_pdf_completed_pages"] = pages_int[-2000:]
    else:
        if kind != "video":
            raise ValueError("This assignment is not a video course file")
        dur = float(body.video_duration_sec or 0)
        pos = float(body.video_position_sec or 0)
        if dur <= 0:
            raise ValueError("Video duration required")
        payload["material_video_duration_sec"] = dur
        prev_mx = float(payload.get("material_video_max_position_sec") or 0)
        payload["material_video_max_position_sec"] = max(prev_mx, min(pos, dur))

    mp = _recompute_material_progress_pct(payload)
    payload["material_progress_pct"] = mp
    payload["material_progress_at"] = _now_iso()

    if payload.get("learning_state") == LEARNING_IN_SESSION:
        cur = int(payload.get("progress_pct") or 0)
        if mp > cur:
            payload["progress_pct"] = mp
            if action.status == "assigned" and mp > 0:
                action.status = "in_progress"
            if not payload.get("started_at"):
                payload["started_at"] = _now_iso()
        payload["last_heartbeat_at"] = _now_iso()

    action.payload = payload
    db.add(action)
    db.commit()
    db.refresh(action)
    return action


def training_assignment_to_progress_item(action: HrAction) -> dict:
    """Build one row for GET training-progress (after optional stale refresh)."""
    payload = ensure_training_attendance_defaults(dict(action.payload or {}))
    st = action.status
    course = payload.get("program_name") or "Training Program"
    skill = payload.get("target_skill") or "general"
    progress = int(payload.get("progress_pct") or 0)
    progress = max(0, min(100, progress))
    cert = str(payload.get("certificate_status") or ("Issued" if st == "completed" else "Pending"))
    learning_state = str(payload.get("learning_state") or LEARNING_NOT_ATTENDING)
    total_sec = int(payload.get("total_learning_seconds") or 0)
    in_session = learning_state == LEARNING_IN_SESSION
    last_hb = payload.get("last_heartbeat_at")

    attendance_tier = "not_started"
    if st == "completed":
        attendance_tier = "completed"
    elif in_session:
        attendance_tier = "actively_learning"
    elif total_sec > 0 or (payload.get("sessions_log") or []):
        attendance_tier = "in_training_program"
    elif st == "in_progress" or st == "assigned":
        attendance_tier = "enrolled"

    stored = (payload.get("course_material_stored") or "").strip()
    mat_kind = (payload.get("course_material_kind") or "").strip().lower() or None
    mat_name = (payload.get("course_material_filename") or "").strip() or None
    mat_pct = _recompute_material_progress_pct(payload) if stored else 0
    pdf_total = int(payload.get("material_pdf_total_pages") or 0)
    pdf_pages = payload.get("material_pdf_completed_pages") or []
    pdf_done = 0
    if mat_kind == "pdf" and pdf_total > 0 and isinstance(pdf_pages, list):
        pdf_done = len(
            {
                int(p)
                for p in pdf_pages
                if (isinstance(p, (int, float)) or (isinstance(p, str) and str(p).strip().lstrip("-").isdigit()))
                and 1 <= int(p) <= pdf_total
            }
        )
    vid_dur = float(payload.get("material_video_duration_sec") or 0)
    vid_mx = float(payload.get("material_video_max_position_sec") or 0)
    link_meta = resolve_official_course_link(
        catalog_course_id=payload.get("catalog_course_id"),
        program_name=course,
        target_skill=skill,
        official_url=payload.get("official_url"),
        provider=payload.get("provider"),
    )
    return {
        "id": str(action.id),
        "course": course,
        "skill": skill,
        "course_material_available": bool(stored),
        "course_material_kind": mat_kind if stored else None,
        "course_material_filename": mat_name if stored else None,
        "material_progress_pct": mat_pct if stored else None,
        "material_pdf_total_pages": pdf_total if mat_kind == "pdf" and pdf_total else None,
        "material_pdf_pages_done_count": pdf_done if mat_kind == "pdf" and pdf_total else None,
        "material_video_watch_pct": (min(100, int(round(100 * vid_mx / vid_dur))) if mat_kind == "video" and vid_dur > 0 else None),
        "material_video_max_position_sec": (round(vid_mx, 3) if mat_kind == "video" and vid_dur > 0 else None),
        "material_progress_at": payload.get("material_progress_at"),
        "progress_pct": 100 if st == "completed" else progress,
        "certificate_status": cert,
        "status": st,
        "source": payload.get("source"),
        "learning_state": learning_state,
        "session_active": in_session,
        "attendance_tier": attendance_tier,
        "total_learning_seconds": total_sec,
        "total_learning_display": _format_duration(total_sec),
        "sessions_completed": len(payload.get("sessions_log") or []),
        "last_heartbeat_at": last_hb,
        "current_session_started_at": payload.get("current_session_started_at"),
        "started_at": payload.get("started_at"),
        "updated_at": action.updated_at.isoformat() if action.updated_at else None,
        "completed_at": payload.get("completed_at") if st == "completed" else None,
        "sessions_log": list(payload.get("sessions_log") or []),
        "official_url": link_meta.get("official_url"),
        "provider": link_meta.get("provider"),
        "catalog_course_id": link_meta.get("catalog_course_id"),
        "ai_course_link": bool(link_meta.get("official_url")),
    }


def _training_level_boost_from_verified_time(verified_seconds: int) -> int:
    """
    Stronger inventory gains when the employee actually spent verified time on the course.
    Capped per completion so one program cannot jump from 0 → 5 alone.
    """
    sec = max(0, int(verified_seconds or 0))
    if sec >= 7200:
        return 3
    if sec >= 3600:
        return 2
    if sec >= 1800:
        return 2
    return 1


def _bump_skill_for_training(
    db: Session,
    user_id: uuid.UUID,
    target_skill: str,
    source: SkillSource,
    *,
    boost: int = 1,
) -> tuple[str, int, int]:
    """
    Raise UserSkill for the target skill using canonical names (same keys as gap engine).
    Returns (canonical_skill, new_level, previous_level). Missing profile → ("", 0, 0).
    """
    raw = (target_skill or "").strip()
    if not raw:
        return "", 0, 0
    canon = normalize_skill_name(raw) or raw.lower().strip()
    if not canon:
        return "", 0, 0
    boost = max(1, min(3, int(boost)))

    skill = db.query(Skill).filter(Skill.name == canon).one_or_none()
    if not skill:
        skill = db.query(Skill).filter(func.lower(Skill.name) == canon.lower()).one_or_none()
    if not skill:
        skill = Skill(name=canon[:120], category="training")
        db.add(skill)
        db.flush()

    row = db.query(UserSkill).filter(UserSkill.user_id == user_id, UserSkill.skill_id == skill.id).one_or_none()
    if row:
        prev = int(row.level)
        row.level = min(5, prev + boost)
        row.source = source
        db.add(row)
        return canon, int(row.level), prev

    initial = min(5, max(2, boost))
    db.add(UserSkill(user_id=user_id, skill_id=skill.id, level=initial, source=source))
    return canon, initial, 0


def _apply_training_project_impacts(db: Session, user_id: uuid.UUID, canon: str, new_level: int) -> None:
    """If the skill maps to an assigned project requirement, record alignment (project logic hook)."""
    if not canon or new_level <= 0:
        return
    profile = db.query(EmployeeProfile).filter(EmployeeProfile.user_id == user_id).one_or_none()
    if not profile:
        return
    impacts: list[dict] = []
    rows = (
        db.query(ManagerProject.name, ProjectSkillRequirement.required_level, Skill.name)
        .join(ProjectSkillRequirement, ProjectSkillRequirement.project_id == ManagerProject.id)
        .join(Skill, Skill.id == ProjectSkillRequirement.skill_id)
        .join(ProjectAssignment, ProjectAssignment.project_id == ManagerProject.id)
        .filter(
            ProjectAssignment.employee_id == user_id,
            ManagerProject.status.in_([ProjectStatus.active, ProjectStatus.draft]),
        )
        .all()
    )
    for pname, req_lvl, sk_name in rows:
        if normalize_skill_name(sk_name) != canon:
            continue
        req_i = int(req_lvl)
        impacts.append(
            {
                "project_name": pname,
                "skill": canon,
                "required_level": req_i,
                "your_level_after_training": new_level,
                "meets_project_requirement": new_level >= req_i,
            }
        )
    if not impacts:
        return
    ai = dict(profile.ai_profile or {})
    ai["last_training_project_impacts"] = impacts
    log = list(ai.get("training_project_impact_log") or [])
    log.append({"at": datetime.now(timezone.utc).isoformat(), "impacts": impacts})
    ai["training_project_impact_log"] = log[-20:]
    profile.ai_profile = ai
    db.add(profile)


def _refresh_workforce_competency_index(db: Session, user_id: uuid.UUID) -> float | None:
    profile = db.query(EmployeeProfile).filter(EmployeeProfile.user_id == user_id).one_or_none()
    if not profile:
        return None
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if not user:
        return None
    competency = build_employee_cv_competency(db, user, profile)
    base = competency_summary_dict(competency)
    rows = db.query(UserSkill.level).filter(UserSkill.user_id == user_id).all()
    avg_skill = sum(int(r[0]) for r in rows) / max(1, len(rows)) if rows else 0.0
    ai = dict(profile.ai_profile or {})
    growth = float(ai.get("profile_growth_index") or 0)
    boost = training_competency_boost_pct(profile)
    wci = workforce_competency_index(
        cv_quality_score=float(base["quality_score"]),
        avg_skill_level=avg_skill,
        profile_growth_index=growth,
        training_boost_pct=boost,
    )
    ai["workforce_competency_index"] = wci
    profile.ai_profile = ai
    db.add(profile)
    return wci


def _notify_competency_gain(
    db: Session,
    user_id: uuid.UUID,
    *,
    skill: str,
    previous_level: int,
    new_level: int,
    program_name: str,
) -> None:
    profile = db.query(EmployeeProfile).filter(EmployeeProfile.user_id == user_id).one_or_none()
    if not profile or new_level <= previous_level:
        return
    ai = dict(profile.ai_profile or {})
    notes = list(ai.get("employee_notifications") or [])
    delta = new_level - previous_level
    notes.insert(
        0,
        {
            "type": "competency_gain",
            "message": (
                f"Competency increased: {skill.replace('-', ' ').title()} "
                f"level {previous_level or '—'} → {new_level} after completing {program_name}."
            ),
            "skill": skill,
            "previous_level": previous_level,
            "new_level": new_level,
            "level_delta": delta,
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    ai["employee_notifications"] = notes[:40]
    profile.ai_profile = ai
    db.add(profile)


def reconcile_training_skill_bumps(db: Session, user_id: uuid.UUID, *, skill_source: SkillSource) -> bool:
    """
    Idempotent backfill: completed trainings missing inventory bumps still raise competency.
    Returns True if any row was updated (caller may commit).
    """
    profile = db.query(EmployeeProfile).filter(EmployeeProfile.user_id == user_id).one_or_none()
    if not profile:
        return False
    ai = dict(profile.ai_profile or {})
    completed_ids = {
        str(entry.get("hr_action_id"))
        for entry in (ai.get("training_completions") or [])
        if isinstance(entry, dict) and entry.get("hr_action_id")
    }
    rows = (
        db.query(HrAction)
        .filter(
            HrAction.target_user_id == user_id,
            HrAction.action_type == "training_assign",
            HrAction.status == "completed",
        )
        .all()
    )
    changed = False
    for action in rows:
        if str(action.id) in completed_ids:
            continue
        payload = ensure_training_attendance_defaults(dict(action.payload or {}))
        program = str(payload.get("program_name") or "Training Program")
        skill_name = str(payload.get("target_skill") or "general")
        verified_sec = int(payload.get("total_learning_seconds") or 0)
        boost = _training_level_boost_from_verified_time(verified_sec)
        canon, new_lvl, prev_lvl = _bump_skill_for_training(
            db, user_id, skill_name, skill_source, boost=boost
        )
        if not canon or new_lvl <= 0:
            continue
        _append_completion_profile(
            db,
            user_id,
            program,
            skill_name,
            action.id,
            canonical_skill=canon,
            verified_seconds=verified_sec,
            level_boost=boost,
            new_level=new_lvl,
            previous_level=prev_lvl,
        )
        _apply_training_project_impacts(db, user_id, canon, new_lvl)
        _notify_competency_gain(
            db,
            user_id,
            skill=canon,
            previous_level=prev_lvl,
            new_level=new_lvl,
            program_name=program,
        )
        changed = True
    if changed:
        _refresh_workforce_competency_index(db, user_id)
    return changed


def _append_completion_profile(
    db: Session,
    user_id: uuid.UUID,
    program_name: str,
    target_skill: str,
    hr_action_id: uuid.UUID,
    *,
    canonical_skill: str,
    verified_seconds: int,
    level_boost: int,
    new_level: int,
    previous_level: int = 0,
) -> None:
    profile = db.query(EmployeeProfile).filter(EmployeeProfile.user_id == user_id).one_or_none()
    if not profile:
        return
    ai = dict(profile.ai_profile or {})
    hist = list(ai.get("training_completions") or [])
    entry = {
        "program_name": program_name,
        "target_skill": target_skill,
        "canonical_skill": canonical_skill,
        "hr_action_id": str(hr_action_id),
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "verified_learning_seconds": int(verified_seconds),
        "level_boost": int(level_boost),
        "inventory_level_before": int(previous_level),
        "inventory_level_after": int(new_level),
    }
    hist.append(entry)
    ai["training_completions"] = hist[-50:]

    stats = dict(ai.get("training_stats") or {})
    stats["completed_count"] = int(stats.get("completed_count") or 0) + 1
    stats["total_verified_seconds"] = int(stats.get("total_verified_seconds") or 0) + int(verified_seconds)
    stats["last_completed_at"] = entry["completed_at"]
    ai["training_stats"] = stats

    growth = min(
        100.0,
        float(stats["completed_count"]) * 10.0 + min(40.0, float(stats["total_verified_seconds"]) / 3600.0 * 3.0),
    )
    ai["profile_growth_index"] = round(growth, 2)

    conf = float(ai.get("confidence") or 0.5)
    ai["confidence"] = round(min(0.95, conf + 0.04 + min(0.06, level_boost * 0.02)), 3)

    profile.ai_profile = ai
    db.add(profile)


def apply_training_assignment_update(
    db: Session,
    action: HrAction,
    body: TrainingAssignmentProgressUpdate,
    *,
    skill_source_on_complete: SkillSource,
    require_active_session_for_progress_change: bool = False,
    require_minimum_verified_time_to_complete: bool = False,
    require_full_progress_for_completion: bool = False,
    allow_progress_pct_auto_complete: bool = True,
) -> HrAction:
    if action.action_type != "training_assign":
        raise ValueError("Not a training assignment")
    _require_hr_approved_training(action)
    if action.status == "completed":
        raise ValueError("Training is already completed")
    if action.status == "cancelled":
        raise ValueError("Training assignment was cancelled")

    stale_dirty = apply_stale_autopause_if_needed(action)

    has_any_update = (
        bool(body.mark_completed)
        or body.progress_pct is not None
        or (body.note is not None and str(body.note).strip())
        or body.certificate_status is not None
    )
    if not has_any_update:
        if stale_dirty:
            db.add(action)
            db.commit()
            db.refresh(action)
        return action

    payload = ensure_training_attendance_defaults(dict(action.payload or {}))
    now_iso = _now_iso()
    now_dt = datetime.now(timezone.utc)

    mark_done = body.mark_completed or (
        allow_progress_pct_auto_complete
        and body.progress_pct is not None
        and body.progress_pct >= 100
    )

    if mark_done and body.mark_completed and require_full_progress_for_completion:
        current_progress = int(payload.get("progress_pct") or 0)
        if current_progress < 100:
            raise ValueError(
                "Course progress must reach 100% before you can mark complete. "
                "Finish the course material while a learning session is active, then click Mark complete."
            )

    if body.note:
        payload["last_progress_note"] = body.note.strip()[:2000]
        payload["last_progress_at"] = now_iso

    if mark_done:
        if payload.get("learning_state") == LEARNING_IN_SESSION:
            payload = _close_open_session_payload(payload, now_dt, closed_by="completion")
        if require_minimum_verified_time_to_complete:
            total_sec = int(payload.get("total_learning_seconds") or 0)
            if total_sec < MIN_SESSION_SECONDS:
                raise ValueError(
                    "Verified time on this course is below the minimum required to complete. "
                    "Start a learning session, study with the session active, then mark complete."
                )
        payload["progress_pct"] = 100
        payload["completed_at"] = now_iso
        payload["certificate_status"] = (body.certificate_status or "Issued").strip()[:80]
        payload["learning_state"] = "completed"
        if body.note:
            payload["completion_note"] = body.note.strip()[:2000]
        action.status = "completed"
        program = str(payload.get("program_name") or "Training Program")
        skill_name = str(payload.get("target_skill") or "general")
        verified_sec = int(payload.get("total_learning_seconds") or 0)
        boost = _training_level_boost_from_verified_time(verified_sec)
        canon, new_lvl, prev_lvl = _bump_skill_for_training(
            db, action.target_user_id, skill_name, skill_source_on_complete, boost=boost
        )
        if canon and new_lvl > 0:
            _append_completion_profile(
                db,
                action.target_user_id,
                program,
                skill_name,
                action.id,
                canonical_skill=canon,
                verified_seconds=verified_sec,
                level_boost=boost,
                new_level=new_lvl,
                previous_level=prev_lvl,
            )
            _apply_training_project_impacts(db, action.target_user_id, canon, new_lvl)
            _notify_competency_gain(
                db,
                action.target_user_id,
                skill=canon,
                previous_level=prev_lvl,
                new_level=new_lvl,
                program_name=program,
            )
            wci = _refresh_workforce_competency_index(db, action.target_user_id)
            payload["competency_impact"] = {
                "skill": canon,
                "previous_level": prev_lvl,
                "new_level": new_lvl,
                "level_boost": boost,
                "workforce_competency_index": wci,
            }
    else:
        if body.progress_pct is not None:
            new_p = int(body.progress_pct)
            old_p = int(payload.get("progress_pct") or 0)
            if require_active_session_for_progress_change and new_p != old_p:
                if payload.get("learning_state") != LEARNING_IN_SESSION:
                    raise ValueError(
                        "Start a learning session before changing course progress; "
                        "attendance is only counted while a session is active."
                    )
            payload["progress_pct"] = new_p
            if action.status == "assigned" and new_p > 0:
                action.status = "in_progress"
            if not payload.get("started_at"):
                payload["started_at"] = now_iso
            if payload.get("learning_state") == LEARNING_IN_SESSION:
                payload["last_heartbeat_at"] = now_iso

    action.payload = payload
    if body.note and not mark_done:
        prev = (action.note or "").strip()
        suffix = body.note.strip()[:500]
        action.note = f"{prev} | {suffix}" if prev else suffix
        action.note = action.note[-2000:]
    db.add(action)
    db.commit()
    db.refresh(action)
    return action
