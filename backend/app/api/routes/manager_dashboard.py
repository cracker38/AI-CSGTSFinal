from __future__ import annotations

import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.manager_project import (
    EmployeeProjectDailyReport,
    ManagerProject,
    ProjectAssignment,
    ProjectJobTitleRequirement,
    ProjectSkillRequirement,
    ProjectStatus,
)
from app.models.hr_action import HrAction
from app.models.master_data import DepartmentCatalog, JobTitleCatalog
from app.models.skill import Skill
from app.models.user import AccountStatus, User, UserRole
from app.models.user_skill import UserSkill
from app.services.skill_normalization import normalize_skill_name
from app.services.job_matching import _normalize_title, build_project_match_report
from app.services.training_assignments import refresh_stale_training_sessions_global, training_assignment_to_progress_item
from app.services.workforce_analytics import manager_employee_performance, team_weighted_gap_score

router = APIRouter()


def _team_query(db: Session, manager_id: uuid.UUID):
    return db.query(User).filter(
        User.role == UserRole.employee,
        User.status == AccountStatus.active,
        User.manager_id == manager_id,
    )


def _workload_by_employee(db: Session, manager_id: uuid.UUID) -> dict[uuid.UUID, float]:
    rows = (
        db.query(ProjectAssignment.employee_id, ProjectAssignment.allocation_pct)
        .join(ManagerProject, ManagerProject.id == ProjectAssignment.project_id)
        .filter(ManagerProject.manager_id == manager_id, ManagerProject.status == ProjectStatus.active)
        .all()
    )
    totals: dict[uuid.UUID, float] = defaultdict(float)
    for employee_id, allocation in rows:
        totals[employee_id] += float(allocation or 0)
    return totals


@router.get("/overview")
def manager_overview(
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> dict:
    team = _team_query(db, manager.id).all()
    team_ids = [u.id for u in team]
    active_projects = (
        db.query(ManagerProject).filter(ManagerProject.manager_id == manager.id, ManagerProject.status == ProjectStatus.active).count()
    )
    workloads = _workload_by_employee(db, manager.id)
    overloaded = sum(1 for uid in team_ids if workloads.get(uid, 0.0) > 100.0)
    available = sum(1 for uid in team_ids if workloads.get(uid, 0.0) < 100.0)

    skills = (
        db.query(Skill.name, UserSkill.level)
        .join(UserSkill, UserSkill.skill_id == Skill.id)
        .filter(UserSkill.user_id.in_(team_ids) if team_ids else False)
        .all()
    )
    team_gap_score = team_weighted_gap_score(db, team)

    skill_distribution = Counter([sname for sname, _ in skills]).most_common(8)
    workload_distribution = [
        {"name": u.full_name, "workload_pct": round(workloads.get(u.id, 0.0), 1)}
        for u in sorted(team, key=lambda x: x.full_name.lower())
    ]
    return {
        "kpis": {
            "total_team_members": len(team),
            "active_projects": active_projects,
            "team_skill_gap_score": team_gap_score,
            "available_employees": available,
            "overloaded_employees": overloaded,
        },
        "skill_distribution": [{"skill": k, "count": v} for k, v in skill_distribution],
        "workload_distribution": workload_distribution,
    }


@router.get("/team-members")
def team_members(
    skill: str | None = Query(default=None),
    availability: str | None = Query(default=None),
    q: str | None = Query(default=None),
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> list[dict]:
    team = _team_query(db, manager.id).all()
    workloads = _workload_by_employee(db, manager.id)
    result = []
    for employee in team:
        user_skills = (
            db.query(Skill.name, UserSkill.level)
            .join(UserSkill, UserSkill.skill_id == Skill.id)
            .filter(UserSkill.user_id == employee.id)
            .all()
        )
        skills = [{"name": name, "level": level} for name, level in user_skills]
        workload = round(workloads.get(employee.id, 0.0), 1)
        availability_state = "available" if workload < 100 else "overloaded"
        perf = manager_employee_performance(db, employee, workload)
        row = {
            "id": str(employee.id),
            "name": employee.full_name,
            "role": employee.job_title,
            "department": employee.department,
            "skills": skills,
            "availability": availability_state,
            "workload_pct": workload,
            "performance": perf["performance_score"],
            "training_completion_pct": perf["training_completion_pct"],
            "project_progress_pct": perf["task_completion_rate"],
        }
        result.append(row)

    if skill:
        result = [r for r in result if any(skill.lower() in s["name"].lower() for s in r["skills"])]
    if availability:
        result = [r for r in result if r["availability"] == availability]
    if q:
        sq = q.lower()
        result = [r for r in result if sq in r["name"].lower() or sq in r["role"].lower()]
    return result


@router.get("/skills/overview")
def skills_overview(
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> dict:
    team = _team_query(db, manager.id).all()
    team_ids = [u.id for u in team]
    skill_rows = (
        db.query(UserSkill.user_id, Skill.name, UserSkill.level)
        .join(Skill, Skill.id == UserSkill.skill_id)
        .filter(UserSkill.user_id.in_(team_ids) if team_ids else False)
        .all()
    )
    by_employee: dict[uuid.UUID, dict[str, int]] = defaultdict(dict)
    by_skill_count: Counter = Counter()
    for uid, skill_name, level in skill_rows:
        by_employee[uid][skill_name] = int(level)
        by_skill_count[skill_name] += 1

    heatmap = []
    for member in team:
        row = {"employee": member.full_name}
        row.update(by_employee.get(member.id, {}))
        heatmap.append(row)

    total_members = max(len(team), 1)
    coverage = [
        {"skill": s, "coverage_pct": round((count / total_members) * 100, 1)}
        for s, count in by_skill_count.most_common()
    ]
    return {"heatmap": heatmap, "coverage": coverage}


@router.get("/skills/gaps")
def skills_gaps(
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> list[dict]:
    projects = db.query(ManagerProject).filter(ManagerProject.manager_id == manager.id).all()
    project_ids = [p.id for p in projects]
    req_rows = (
        db.query(Skill.name, ProjectSkillRequirement.required_level)
        .join(Skill, Skill.id == ProjectSkillRequirement.skill_id)
        .filter(ProjectSkillRequirement.project_id.in_(project_ids) if project_ids else False)
        .all()
    )
    required_by_skill: dict[str, float] = defaultdict(float)
    for skill_name, required in req_rows:
        key = normalize_skill_name(skill_name)
        if key:
            required_by_skill[key] = max(required_by_skill[key], float(required))

    team = _team_query(db, manager.id).all()
    team_ids = [u.id for u in team]
    team_size = max(len(team_ids), 1)
    current_rows = (
        db.query(UserSkill.user_id, Skill.name, UserSkill.level)
        .join(Skill, Skill.id == UserSkill.skill_id)
        .filter(UserSkill.user_id.in_(team_ids) if team_ids else False)
        .all()
    )
    # Canonical skill → max level per employee (matches gap analysis normalization).
    by_member_skill: dict[uuid.UUID, dict[str, int]] = defaultdict(dict)
    for uid, skill_name, lvl in current_rows:
        key = normalize_skill_name(skill_name)
        if key:
            m = by_member_skill[uid]
            m[key] = max(m.get(key, 0), int(lvl))

    items = []
    for skill_name, required in required_by_skill.items():
        sum_levels = sum(by_member_skill[uid].get(skill_name, 0) for uid in team_ids)
        team_avg = round(sum_levels / team_size, 2)
        gap = round(float(required) - team_avg, 2)
        severity = "critical" if gap >= 2 else "moderate" if gap > 0 else "good"
        positive_gap_sum = sum(max(0, int(required) - by_member_skill[uid].get(skill_name, 0)) for uid in team_ids)
        items.append(
            {
                "skill": skill_name,
                "required": round(required, 2),
                "current": team_avg,
                "gap": gap,
                "severity": severity,
                "team_positive_gap_sum": int(positive_gap_sum),
            }
        )
    return sorted(items, key=lambda x: (x["team_positive_gap_sum"], x["gap"]), reverse=True)


class ProjectSkillInput(BaseModel):
    skill_id: uuid.UUID
    required_level: int = Field(ge=1, le=5)
    weight: float = Field(gt=0, le=3.0, default=1.0)


class ProjectCreateInput(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    department: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=1000)
    deadline: date | None = None
    required_employees: int = Field(ge=1, le=100, default=1)
    status: ProjectStatus = ProjectStatus.draft
    requirements: list[ProjectSkillInput] = Field(min_length=1)
    required_job_titles: list[str] = Field(default_factory=list)


def _active_department_names(db: Session) -> set[str]:
    return {
        name
        for (name,) in db.query(DepartmentCatalog.name).filter(DepartmentCatalog.active.is_(True)).all()
    }


def _job_titles_for_department(db: Session, department: str) -> list[str]:
    catalog = [
        name
        for (name,) in db.query(JobTitleCatalog.name)
        .filter(JobTitleCatalog.active.is_(True))
        .order_by(JobTitleCatalog.name.asc())
        .all()
    ]
    if not department:
        return catalog
    dept_titles = {
        jt
        for (jt,) in db.query(User.job_title)
        .filter(User.department == department, User.job_title.isnot(None), User.job_title != "")
        .distinct()
        .all()
        if jt
    }
    if dept_titles:
        filtered = [jt for jt in catalog if jt in dept_titles]
        if filtered:
            return filtered
        return sorted(dept_titles)
    return catalog


@router.post("/projects")
def create_project(
    payload: ProjectCreateInput,
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> dict:
    if not payload.required_job_titles:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one required job title is required")
    active_departments = _active_department_names(db)
    if payload.department not in active_departments:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Department must be selected from the catalog")
    allowed_job_titles = set(_job_titles_for_department(db, payload.department))
    active_job_titles = allowed_job_titles or {
        jt for (jt,) in db.query(JobTitleCatalog.name).filter(JobTitleCatalog.active.is_(True)).all()
    }
    invalid_job_titles = [jt for jt in payload.required_job_titles if jt not in active_job_titles]
    if invalid_job_titles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown job title(s): {', '.join(invalid_job_titles)}",
        )
    # Allow planning in draft mode even when immediate capacity is unavailable.
    # Strict workforce-capacity checks apply only when creating directly as active.
    if payload.status == ProjectStatus.active:
        team = _team_query(db, manager.id).all()
        workloads = _workload_by_employee(db, manager.id)
        available_team = [u for u in team if workloads.get(u.id, 0.0) < 100]
        if len(available_team) < payload.required_employees:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Not enough available employees for required headcount",
            )
        available_job_titles = {_normalize_title(u.job_title) for u in available_team}
        missing_titles = [jt for jt in payload.required_job_titles if _normalize_title(jt) not in available_job_titles]
        if missing_titles:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"No available employees for required job title(s): {', '.join(missing_titles)}",
            )
        dept_team = [u for u in available_team if _normalize_title(u.department) == _normalize_title(payload.department)]
        if len(dept_team) < payload.required_employees:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Not enough available employees in department '{payload.department}'",
            )

    project = ManagerProject(
        manager_id=manager.id,
        name=payload.name,
        department=payload.department,
        description=payload.description,
        deadline=payload.deadline,
        required_employees=payload.required_employees,
        status=payload.status,
    )
    db.add(project)
    db.flush()
    for req in payload.requirements:
        db.add(
            ProjectSkillRequirement(
                project_id=project.id,
                skill_id=req.skill_id,
                required_level=req.required_level,
                weight=req.weight,
            )
        )
    for job_title in payload.required_job_titles:
        db.add(ProjectJobTitleRequirement(project_id=project.id, job_title=job_title))
    db.commit()
    return {"id": str(project.id), "ok": True}


@router.get("/projects")
def list_projects(
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> list[dict]:
    projects = db.query(ManagerProject).filter(ManagerProject.manager_id == manager.id).order_by(ManagerProject.created_at.desc()).all()
    out = []
    for p in projects:
        assigned = db.query(ProjectAssignment).filter(ProjectAssignment.project_id == p.id).count()
        required_jobs = [
            row[0]
            for row in db.query(ProjectJobTitleRequirement.job_title)
            .filter(ProjectJobTitleRequirement.project_id == p.id)
            .all()
        ]
        out.append(
            {
                "id": str(p.id),
                "name": p.name,
                "department": p.department,
                "description": p.description,
                "status": p.status.value,
                "deadline": p.deadline.isoformat() if p.deadline else None,
                "required_employees": p.required_employees,
                "assigned_employees": assigned,
                "required_job_titles": required_jobs,
            }
        )
    return out


@router.get("/projects/{project_id}/assignments")
def project_assignments(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> list[dict]:
    project = db.query(ManagerProject).filter(ManagerProject.id == project_id, ManagerProject.manager_id == manager.id).one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    rows = (
        db.query(ProjectAssignment, User)
        .join(User, User.id == ProjectAssignment.employee_id)
        .filter(ProjectAssignment.project_id == project.id)
        .all()
    )
    return [
        {
            "employee_id": str(user.id),
            "employee": user.full_name,
            "allocation_pct": float(assignment.allocation_pct or 0),
        }
        for assignment, user in rows
    ]


@router.get("/projects/{project_id}/daily-reports")
def project_daily_reports_for_manager(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> list[dict]:
    project = db.query(ManagerProject).filter(ManagerProject.id == project_id, ManagerProject.manager_id == manager.id).one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    rows = (
        db.query(EmployeeProjectDailyReport, User)
        .join(User, User.id == EmployeeProjectDailyReport.employee_id)
        .filter(EmployeeProjectDailyReport.project_id == project.id)
        .order_by(EmployeeProjectDailyReport.work_date.desc(), EmployeeProjectDailyReport.created_at.desc())
        .all()
    )
    return [
        {
            "report_id": str(report.id),
            "employee_id": str(employee.id),
            "employee": employee.full_name,
            "work_date": report.work_date.isoformat(),
            "hours_spent": float(report.hours_spent or 0),
            "progress_pct": float(report.progress_pct or 0),
            "status": report.status,
            "summary": report.summary,
            "blockers": report.blockers,
            "next_plan": report.next_plan,
            "updated_at": report.updated_at.isoformat() if report.updated_at else None,
        }
        for report, employee in rows
    ]


@router.get("/projects/{project_id}/match")
def match_employees(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> dict:
    project = db.query(ManagerProject).filter(ManagerProject.id == project_id, ManagerProject.manager_id == manager.id).one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    workloads = _workload_by_employee(db, manager.id)
    team = _team_query(db, manager.id).all()
    return build_project_match_report(db, project=project, manager=manager, team=team, workloads=workloads)


class AssignmentInput(BaseModel):
    employee_id: uuid.UUID
    allocation_pct: float = Field(ge=1, le=100, default=100)


@router.post("/projects/{project_id}/assign")
def assign_employee(
    project_id: uuid.UUID,
    payload: AssignmentInput,
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> dict:
    project = db.query(ManagerProject).filter(ManagerProject.id == project_id, ManagerProject.manager_id == manager.id).one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if project.status == ProjectStatus.cancelled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Archived project cannot receive new assignments")
    required_titles = {
        row[0]
        for row in db.query(ProjectJobTitleRequirement.job_title)
        .filter(ProjectJobTitleRequirement.project_id == project.id)
        .all()
    }
    normalized_required_titles = {_normalize_title(title) for title in required_titles}
    employee = _team_query(db, manager.id).filter(User.id == payload.employee_id).one_or_none()
    if not employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not in your team")
    if normalized_required_titles and _normalize_title(employee.job_title) not in normalized_required_titles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Employee job title '{employee.job_title}' is not in project required job titles",
        )
    if project.department and _normalize_title(employee.department) != _normalize_title(project.department):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Employee department '{employee.department}' does not match project department '{project.department}'",
        )
    current = _workload_by_employee(db, manager.id).get(employee.id, 0.0)
    existing = (
        db.query(ProjectAssignment)
        .filter(ProjectAssignment.project_id == project.id, ProjectAssignment.employee_id == employee.id)
        .one_or_none()
    )
    existing_allocation = float(existing.allocation_pct or 0) if existing else 0.0
    projected = current - existing_allocation + float(payload.allocation_pct)
    if projected > 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Allocation would exceed 100% workload (current {round(current, 1)}%, requested {payload.allocation_pct}%).",
        )
    if existing:
        existing.allocation_pct = payload.allocation_pct
    else:
        db.add(ProjectAssignment(project_id=project.id, employee_id=employee.id, allocation_pct=payload.allocation_pct))
    if project.status == ProjectStatus.draft:
        project.status = ProjectStatus.active
    db.commit()
    return {"ok": True}


@router.delete("/projects/{project_id}/assignments/{employee_id}")
def unassign_employee_from_project(
    project_id: uuid.UUID,
    employee_id: uuid.UUID,
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> dict:
    project = db.query(ManagerProject).filter(ManagerProject.id == project_id, ManagerProject.manager_id == manager.id).one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    row = (
        db.query(ProjectAssignment)
        .filter(ProjectAssignment.project_id == project.id, ProjectAssignment.employee_id == employee_id)
        .one_or_none()
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.delete("/projects/{project_id}")
def delete_project(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> dict:
    project = db.query(ManagerProject).filter(ManagerProject.id == project_id, ManagerProject.manager_id == manager.id).one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    # Explicitly clear linked rows for SQLite/local compatibility.
    db.query(ProjectAssignment).filter(ProjectAssignment.project_id == project.id).delete(synchronize_session=False)
    db.query(ProjectSkillRequirement).filter(ProjectSkillRequirement.project_id == project.id).delete(synchronize_session=False)
    db.query(ProjectJobTitleRequirement).filter(ProjectJobTitleRequirement.project_id == project.id).delete(synchronize_session=False)
    db.query(EmployeeProjectDailyReport).filter(EmployeeProjectDailyReport.project_id == project.id).delete(synchronize_session=False)
    db.delete(project)
    db.commit()
    return {"ok": True}


@router.post("/projects/{project_id}/archive")
def archive_project(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> dict:
    project = db.query(ManagerProject).filter(ManagerProject.id == project_id, ManagerProject.manager_id == manager.id).one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if project.status == ProjectStatus.cancelled:
        return {"ok": True, "status": "cancelled"}
    project.status = ProjectStatus.cancelled
    db.add(project)
    db.commit()
    return {"ok": True, "status": "cancelled"}


@router.post("/team-members/{employee_id}/unassign")
def unassign_team_member(
    employee_id: uuid.UUID,
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> dict:
    employee = (
        db.query(User)
        .filter(User.id == employee_id, User.role == UserRole.employee, User.manager_id == manager.id)
        .one_or_none()
    )
    if not employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not in your team")

    project_ids = [
        pid
        for (pid,) in db.query(ManagerProject.id).filter(ManagerProject.manager_id == manager.id).all()
    ]
    removed = 0
    if project_ids:
        removed = (
            db.query(ProjectAssignment)
            .filter(ProjectAssignment.employee_id == employee.id, ProjectAssignment.project_id.in_(project_ids))
            .delete(synchronize_session=False)
        )
    employee.manager_id = None
    db.add(employee)
    db.commit()
    return {"ok": True, "removed_project_assignments": int(removed or 0)}


@router.get("/workload")
def workload(
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> list[dict]:
    team = _team_query(db, manager.id).all()
    workloads = _workload_by_employee(db, manager.id)
    return [
        {
            "employee_id": str(u.id),
            "employee": u.full_name,
            "workload_pct": round(workloads.get(u.id, 0.0), 1),
            "availability": "available" if workloads.get(u.id, 0.0) < 100 else "overloaded",
        }
        for u in sorted(team, key=lambda x: x.full_name.lower())
    ]


@router.get("/performance")
def performance(
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> list[dict]:
    team = _team_query(db, manager.id).all()
    workloads = _workload_by_employee(db, manager.id)
    items = []
    for u in team:
        workload_pct = workloads.get(u.id, 0.0)
        perf = manager_employee_performance(db, u, workload_pct)
        items.append(
            {
                "employee_id": str(u.id),
                "employee": u.full_name,
                "performance_score": perf["performance_score"],
                "task_completion_rate": perf["task_completion_rate"],
                "skill_improvement": perf["skill_improvement"],
                "training_completion_pct": perf["training_completion_pct"],
                "projects_tracked": perf["projects_tracked"],
                "engine": "workforce_db_v1",
            }
        )
    return sorted(items, key=lambda x: x["performance_score"], reverse=True)


@router.get("/team-training")
def team_training(
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> list[dict]:
    """Active and pending training assignments for employees on this manager's team."""
    team = _team_query(db, manager.id).all()
    team_ids = [u.id for u in team]
    if not team_ids:
        return []
    refresh_stale_training_sessions_global(db)
    rows = (
        db.query(HrAction, User)
        .join(User, User.id == HrAction.target_user_id)
        .filter(
            HrAction.target_user_id.in_(team_ids),
            HrAction.action_type == "training_assign",
            HrAction.status.in_(["pending", "assigned", "in_progress"]),
        )
        .order_by(HrAction.updated_at.desc())
        .limit(200)
        .all()
    )
    out = []
    for action, employee in rows:
        item = training_assignment_to_progress_item(action)
        out.append(
            {
                "id": item["id"],
                "employee_id": str(employee.id),
                "employee_name": employee.full_name,
                "employee_email": employee.email,
                "department": employee.department,
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
                "updated_at": action.updated_at.isoformat() if action.updated_at else None,
            }
        )
    return out


@router.get("/alerts")
def alerts(
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> list[dict]:
    workloads = _workload_by_employee(db, manager.id)
    team = _team_query(db, manager.id).all()
    out = []
    for u in team:
        workload_pct = workloads.get(u.id, 0.0)
        if workload_pct > 100:
            out.append({"type": "overload", "severity": "critical", "message": f"{u.full_name} is overloaded ({workload_pct:.1f}%)."})
        elif workload_pct > 85:
            out.append({"type": "overload", "severity": "moderate", "message": f"{u.full_name} nearing overload ({workload_pct:.1f}%)."})
        if workload_pct < 10:
            out.append({"type": "capacity", "severity": "info", "message": f"{u.full_name} has low utilization."})

    for gap in skills_gaps(db, manager):
        if gap["severity"] in ("critical", "moderate"):
            out.append(
                {
                    "type": "skill_gap",
                    "severity": gap["severity"],
                    "message": f"Skill shortage in {gap['skill']} (gap {gap['gap']}).",
                }
            )
    active_projects = db.query(ManagerProject).filter(
        ManagerProject.manager_id == manager.id,
        ManagerProject.status.in_([ProjectStatus.active, ProjectStatus.draft]),
    ).all()
    today = date.today()
    for p in active_projects:
        team_rows = db.query(ProjectAssignment.employee_id).filter(ProjectAssignment.project_id == p.id).all()
        for (employee_id,) in team_rows:
            latest_report = (
                db.query(EmployeeProjectDailyReport.work_date, User.full_name)
                .join(User, User.id == EmployeeProjectDailyReport.employee_id)
                .filter(
                    EmployeeProjectDailyReport.project_id == p.id,
                    EmployeeProjectDailyReport.employee_id == employee_id,
                )
                .order_by(EmployeeProjectDailyReport.work_date.desc())
                .first()
            )
            if not latest_report:
                employee = db.query(User.full_name).filter(User.id == employee_id).first()
                out.append(
                    {
                        "type": "missing_daily_report",
                        "severity": "moderate",
                        "message": f"{employee[0] if employee else 'Employee'} has no daily report for project {p.name}.",
                    }
                )
                continue
            days_since = (today - latest_report[0]).days
            if days_since >= 2:
                out.append(
                    {
                        "type": "overdue_daily_report",
                        "severity": "moderate" if days_since < 4 else "critical",
                        "message": f"{latest_report[1]} last reported {days_since} day(s) ago on project {p.name}.",
                    }
                )
    return out


@router.get("/skills")
def skills_list(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.manager)),
) -> list[dict]:
    rows = db.query(Skill).order_by(Skill.name.asc()).all()
    return [{"id": str(s.id), "name": s.name} for s in rows]


@router.get("/departments")
def departments_list(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.manager)),
) -> list[str]:
    return [
        name
        for (name,) in db.query(DepartmentCatalog.name)
        .filter(DepartmentCatalog.active.is_(True))
        .order_by(DepartmentCatalog.name.asc())
        .all()
    ]


@router.get("/job-titles")
def job_titles_list(
    department: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.manager)),
) -> list[str]:
    if department:
        active_departments = _active_department_names(db)
        if department not in active_departments:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown department")
    return _job_titles_for_department(db, department or "")
