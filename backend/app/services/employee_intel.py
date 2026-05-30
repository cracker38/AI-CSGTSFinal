"""Employee dashboard intelligence from CV extraction, HR role, optional target role, and selected opportunities."""

from __future__ import annotations

import uuid

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.ai.gap import compute_skill_gaps
from app.ai.sklearn_signals import blended_alignment_pct, cv_role_semantic_similarity
from app.models.employee_profile import EmployeeProfile
from app.models.manager_project import (
    ManagerProject,
    ProjectAssignment,
    ProjectJobTitleRequirement,
    ProjectSkillRequirement,
    ProjectStatus,
)
from app.models.skill import Skill
from app.models.user import User
from app.models.user_skill import UserSkill
from app.services.employee_competency import (
    build_employee_cv_competency,
    competency_summary_for_employee,
    employee_context_document,
)
from app.services.required_skill_profile import required_skill_levels_for
from app.services.skill_normalization import normalize_skill_level_map, normalize_skill_name


def _norm_title(value: str | None) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _employee_current_skill_map(db: Session, user_id: uuid.UUID) -> dict[str, int]:
    rows = (
        db.query(Skill.name, UserSkill.level)
        .join(UserSkill, Skill.id == UserSkill.skill_id)
        .filter(UserSkill.user_id == user_id)
        .all()
    )
    return normalize_skill_level_map({str(name): int(level) for name, level in rows})


def _readiness_band(weighted_impact_avg: float) -> tuple[str, str]:
    """Return machine band + HR-friendly label from average weighted_gap_impact."""
    if weighted_impact_avg <= 0.35:
        return "strong", "Strong alignment — maintain edge skills"
    if weighted_impact_avg <= 0.85:
        return "developing", "On track — close priority gaps to unlock next level"
    return "focus_required", "Priority development — address high-impact gaps first"


def _gap_averages(current: dict[str, int], required: dict[str, int], weights: dict[str, float]) -> tuple[float, float]:
    gaps = compute_skill_gaps(
        current=current,
        required=required,
        importance_weights=weights,
        confidence_base=0.65,
    )
    if not gaps:
        return 0.0, 0.0
    gap_avg = sum(max(0.0, float(g.gap)) for g in gaps) / len(gaps)
    w_avg = sum(float(g.weighted_gap_impact) for g in gaps) / len(gaps)
    return round(gap_avg, 3), round(w_avg, 3)


def project_skill_fit(db: Session, user_id: uuid.UUID, project_id: uuid.UUID) -> dict:
    req_rows = (
        db.query(Skill.name, ProjectSkillRequirement.required_level, ProjectSkillRequirement.weight)
        .join(ProjectSkillRequirement, Skill.id == ProjectSkillRequirement.skill_id)
        .filter(ProjectSkillRequirement.project_id == project_id)
        .all()
    )
    if not req_rows:
        return {"fit_pct": None, "has_skill_requirements": False}

    cur = _employee_current_skill_map(db, user_id)
    earned = 0.0
    total_w = sum(float(w) for _, _, w in req_rows) or 1.0
    for name, rlevel, weight in req_rows:
        sn = normalize_skill_name(str(name))
        need = max(1, int(rlevel))
        have = int(cur.get(sn, 0))
        w = float(weight)
        ratio = min(1.0, float(have) / float(need))
        earned += w * ratio
    fit_pct = round(100.0 * earned / total_w, 1)
    return {"fit_pct": fit_pct, "has_skill_requirements": True}


def build_open_opportunities(db: Session, user: User, *, target_job_title: str | None) -> list[dict]:
    """Projects with headcount room, matched to employee / target job title signals."""
    projects = (
        db.query(ManagerProject)
        .filter(ManagerProject.status.in_([ProjectStatus.active, ProjectStatus.draft]))
        .order_by(ManagerProject.created_at.desc())
        .limit(100)
        .all()
    )
    cand_titles = {_norm_title(user.job_title), _norm_title(target_job_title)}
    cand_titles.discard("")
    out: list[dict] = []
    for p in projects:
        assigns = (
            db.query(func.count(ProjectAssignment.id)).filter(ProjectAssignment.project_id == p.id).scalar() or 0
        )
        if assigns >= int(p.required_employees or 1):
            continue

        jt_rows = [
            r[0]
            for r in db.query(ProjectJobTitleRequirement.job_title)
            .filter(ProjectJobTitleRequirement.project_id == p.id)
            .all()
        ]
        norm_req = {_norm_title(j) for j in jt_rows}
        eligible = False
        if not norm_req:
            eligible = True
        elif cand_titles & norm_req:
            eligible = True
        else:
            tokens: set[str] = set()
            for ct in cand_titles:
                tokens |= {t for t in ct.replace("/", " ").replace("-", " ").split() if len(t) > 1}
            for r in norm_req:
                rtoks = {t for t in r.replace("/", " ").replace("-", " ").split() if len(t) > 1}
                if tokens & rtoks:
                    eligible = True
                    break
        if not eligible:
            continue

        manager_name = db.query(User.full_name).filter(User.id == p.manager_id).scalar()
        slots = max(0, int(p.required_employees or 1) - int(assigns))
        fit = project_skill_fit(db, user.id, p.id)
        out.append(
            {
                "project_id": str(p.id),
                "name": p.name,
                "description": (p.description or "")[:320],
                "deadline": p.deadline.isoformat() if p.deadline else None,
                "status": p.status.value if hasattr(p.status, "value") else str(p.status),
                "open_slots": slots,
                "required_job_titles": list(jt_rows),
                "manager_name": manager_name,
                "project_skill_fit_pct": fit.get("fit_pct"),
                "project_has_skill_grid": fit.get("has_skill_requirements", False),
            }
        )
    return out


def _project_row_by_id(db: Session, pid: uuid.UUID) -> ManagerProject | None:
    return db.query(ManagerProject).filter(ManagerProject.id == pid).one_or_none()


def _titles_for_story(user: User, ai: dict, cv: dict) -> tuple[str, str]:
    target = (ai.get("target_job_title") or user.job_title or "your assigned role").strip()
    headline = "Competency intelligence from your résumé and priorities"
    nlp = cv.get("nlp") or {}
    pipe = str(nlp.get("pipeline") or "cv_deep_nlp_v4")
    deep = cv.get("deep_intel") if isinstance(cv.get("deep_intel"), dict) else {}
    subtitle = (
        f"Signals are calibrated for '{target}'. Parsing engine: {pipe}. "
        "Deep extraction reads work history, education, certifications, and skill evidence "
        "before scoring readiness, gaps, and project fit."
    )
    if deep.get("latest_role"):
        subtitle += f" Latest role detected: {deep['latest_role']}"
        if deep.get("latest_company"):
            subtitle += f" at {deep['latest_company']}."
    return headline, subtitle


def build_story_bullets(db: Session | None, user: User, profile: EmployeeProfile) -> tuple[str, str, list[str]]:
    ai = dict(profile.ai_profile or {})
    from app.services.cv import cv_extract_for_user

    cv = cv_extract_for_user(db, user, profile) if db is not None else (profile.cv_extract or {})
    headline, subtitle = _titles_for_story(user, ai, cv)

    bullets: list[str] = []
    validated = ai.get("primary_skill_validated")
    if validated is True:
        bullets.append(
            f"Your declared primary skill ({user.primary_skill}) aligns with competencies detected from the CV — good calibration anchor."
        )
    elif validated is False:
        bullets.append(
            f"Declared primary ({user.primary_skill}) was not auto-detected in the CV text — align résumé keywords or enrich your inventory."
        )

    n_skills = len(cv.get("skills") or [])
    deep = cv.get("deep_intel") if isinstance(cv.get("deep_intel"), dict) else {}
    bullets.append(
        f"Structured extraction mapped {n_skills} catalog skills from your résumé "
        f"({deep.get('skills_in_work_history_count', 0)} substantiated in work history)."
    )

    summary = str(cv.get("profile_summary") or "").strip()
    if summary:
        bullets.append(f"Professional summary captured ({min(len(summary), 1200)} chars) — used for semantic role alignment.")

    yrs = cv.get("experience_years") or deep.get("experience_span_years")
    if isinstance(yrs, int) and yrs > 0:
        bullets.append(f"Career depth estimated at ~{yrs} years from work-history timelines and résumé narrative.")

    exp_entries = cv.get("experience") or []
    if exp_entries:
        latest = exp_entries[0] if isinstance(exp_entries[0], dict) else {}
        role = latest.get("title") or "Role"
        org = latest.get("company") or "organization"
        bullets.append(f"Most recent position parsed: {role} at {org}.")

    edu_entries = cv.get("education_entries") or cv.get("education") or []
    if edu_entries:
        bullets.append(f"Education block parsed ({len(edu_entries)} entry/entries) — strengthens credential credibility.")

    cert_entries = cv.get("certification_entries") or cv.get("certifications") or []
    if cert_entries:
        bullets.append(f"Certifications detected ({len(cert_entries)}) — compliance and training views use these signals.")

    conf = ai.get("confidence")
    if conf is not None:
        pct = round(float(conf) * 100, 1)
        sec = cv.get("nlp") or {}
        boost = bool(sec.get("skills_section_detected"))
        bullets.append(
            f"Document confidence ~{pct}%"
            + (" (skills section detected → higher reliability)." if boost else ".")
        )

    sug = ai.get("suggested_skills") or []
    if sug:
        show = ", ".join(str(s) for s in sug[:8])
        more = len(sug) - 8
        bullets.append(
            f"Dominant adjunct signals vs. primary anchor: {show}" + (f" (+{more} more)" if more > 0 else "") + "."
        )

    sel_raw = ai.get("selected_project_ids") or []
    if sel_raw and db is not None:
        names: list[str] = []
        for sid in sel_raw[:12]:
            try:
                pu = uuid.UUID(str(sid))
            except ValueError:
                continue
            pr = _project_row_by_id(db, pu)
            if pr:
                names.append(pr.name)
        if names:
            bullets.append(f"Shortlisted opportunities: {', '.join(names)} — dashboards weight their published skill grids in fit summaries.")

    if not bullets:
        bullets.append(
            "Upload a PDF résumé to unlock structured competency detection, readiness scoring, and opportunity fit views."
        )

    return headline, subtitle, bullets


def sync_ai_cv_story(db: Session | None, profile: EmployeeProfile, user: User) -> None:
    """Persist narrative cache on profile after CV ingestion or preference updates."""
    headline, subtitle, bullets = build_story_bullets(db, user, profile)
    ai = dict(profile.ai_profile or {})
    ai["cv_story_headline"] = headline
    ai["cv_story_subtitle"] = subtitle
    ai["cv_analysis_bullets"] = bullets
    profile.ai_profile = ai


def selected_projects_detail(db: Session, user: User, profile: EmployeeProfile) -> list[dict]:
    ai = dict(profile.ai_profile or {})
    out: list[dict] = []
    for sid in ai.get("selected_project_ids") or []:
        try:
            pu = uuid.UUID(str(sid))
        except ValueError:
            continue
        p = _project_row_by_id(db, pu)
        if not p:
            continue
        fit = project_skill_fit(db, user.id, p.id)
        assigns = (
            db.query(func.count(ProjectAssignment.id)).filter(ProjectAssignment.project_id == p.id).scalar() or 0
        )
        out.append(
            {
                "project_id": str(p.id),
                "name": p.name,
                "status": p.status.value if hasattr(p.status, "value") else str(p.status),
                "open_slots": max(0, int(p.required_employees or 1) - int(assigns)),
                "project_skill_fit_pct": fit.get("fit_pct"),
                "project_has_skill_grid": fit.get("has_skill_requirements", False),
            }
        )
    return out


def build_employee_dashboard_intel(db: Session, user: User, profile: EmployeeProfile) -> dict:
    """Read-only bundle for the employee home dashboard (no DB writes)."""
    ai = dict(profile.ai_profile or {})
    from app.services.cv import cv_extract_for_user

    cv = cv_extract_for_user(db, user, profile)
    target_jt = (ai.get("target_job_title") or user.job_title or "").strip()
    hr_jt = (user.job_title or "").strip()

    cur = _employee_current_skill_map(db, user.id)
    req_hr, w_hr = required_skill_levels_for(user.primary_skill, hr_jt, user.department)
    gap_hr, w_imp_hr = _gap_averages(cur, req_hr, w_hr)
    band_hr, label_hr = _readiness_band(w_imp_hr)

    same_target = _norm_title(target_jt) == _norm_title(hr_jt) and bool(hr_jt)
    if same_target:
        gap_tgt, w_imp_tgt, band_tgt, label_tgt = gap_hr, w_imp_hr, band_hr, label_hr
        req_tgt = req_hr
    else:
        req_tgt, w_tgt = required_skill_levels_for(user.primary_skill, target_jt, user.department)
        gap_tgt, w_imp_tgt = _gap_averages(cur, req_tgt, w_tgt)
        band_tgt, label_tgt = _readiness_band(w_imp_tgt)

    competency = build_employee_cv_competency(db, user, profile)
    cv_comp = competency_summary_for_employee(db, user, profile, competency)
    context_doc = employee_context_document(user, profile, competency.cv_text)
    ml_cos_tgt = cv_role_semantic_similarity(context_doc if len(context_doc) >= 24 else None, req_tgt)

    openness = build_open_opportunities(db, user, target_job_title=target_jt or None)

    alignment_gap_math = round(max(0.0, min(100.0, 100.0 - min(100.0, w_imp_tgt * 42.0))), 1)
    alignment_blended = blended_alignment_pct(alignment_gap_math, ml_cos_tgt, semantic_weight=0.45)

    headline, subtitle, bullets = build_story_bullets(db, user, profile)
    bullets_ext = list(bullets)
    if ml_cos_tgt is not None:
        bullets_ext.append(
            f"Machine-learning signal (scikit-learn TF–IDF vs target-role profile cosine similarity ≈ {int(round(ml_cos_tgt * 100))}%). "
            "This augments deterministic taxonomy tagging where wording varies."
        )

    cv_skills = [normalize_skill_name(str(s)) for s in (cv.get("skills") or []) if str(s).strip()]
    inv_overlap = sum(1 for s in cv_skills if cur.get(s, 0) >= 2)

    nlp_meta = cv.get("nlp") or {}
    pdf_meta = cv.get("pdf") or {}
    deep = cv.get("deep_intel") if isinstance(cv.get("deep_intel"), dict) else {}

    return {
        "narrative": {"headline": headline, "subtitle": subtitle, "bullets": bullets_ext},
        "positions": {"hr_job_title": hr_jt or None, "target_job_title": target_jt or None, "targets_match_hr_record": same_target},
        "cv_competency": cv_comp,
        "cv_signal": {
            "skill_mentions_catalog": len(cv_skills),
            "inventory_overlap_at_working_level": inv_overlap,
            "certifications_preview": (cv.get("certifications") or [])[:5],
            "education_preview": (cv.get("education") or [])[:5],
            "experience_years_hint": cv.get("experience_years") or deep.get("experience_span_years"),
            "experience_timeline": (cv.get("experience") or [])[:6],
            "profile_summary_preview": (cv.get("profile_summary") or "")[:320],
            "deep_intel": deep,
            "text_preview_tail": (cv.get("text_preview") or "")[:400],
            "quality_tier": cv_comp.get("quality_tier"),
            "quality_score": cv_comp.get("quality_score"),
            "nlp": {
                "pipeline": nlp_meta.get("pipeline"),
                "document_confidence": nlp_meta.get("document_confidence"),
                "skills_section_detected": nlp_meta.get("skills_section_detected"),
                "char_count": nlp_meta.get("char_count") or cv_comp.get("cv_text_length"),
                "experience_section_detected": cv_comp.get("structure", {}).get("experience_section_detected"),
                "bullet_count": cv_comp.get("structure", {}).get("bullet_count"),
            },
            "semantic_similarity_cosine": ml_cos_tgt,
            "semantic_similarity_engine": "sklearn_tfidf_cosine_v2" if ml_cos_tgt is not None else None,
            "pdf_extract_ok": pdf_meta.get("pdf_ok"),
            "pdf_pages": pdf_meta.get("pages"),
        },
        "readiness": {
            "vs_hr_record_role": {
                "gap_avg": gap_hr,
                "weighted_impact_avg": w_imp_hr,
                "band": band_hr,
                "label": label_hr,
            },
            "vs_target_role": {
                "gap_avg": gap_tgt,
                "weighted_impact_avg": w_imp_tgt,
                "band": band_tgt,
                "label": label_tgt,
                "derived_required_skill_count": len(req_tgt),
            },
        },
        "alignment_score_target_role": alignment_blended,
        "alignment_score_target_role_gap_math": alignment_gap_math,
        "selected_projects": selected_projects_detail(db, user, profile),
        "open_opportunities": openness[:24],
        "engine": {"version": "employee_intel_4_cv_deep", "sklearn_signals": ml_cos_tgt is not None},
    }
