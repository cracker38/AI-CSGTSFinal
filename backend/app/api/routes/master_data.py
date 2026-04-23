from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.master_data import (
    CatalogRequest,
    CatalogRequestStatus,
    CatalogRequestType,
    DepartmentCatalog,
    JobTitleCatalog,
)
from app.models.manager_project import ProjectJobTitleRequirement, ProjectSkillRequirement
from app.models.skill import Skill
from app.models.user import User, UserRole
from app.models.user_skill import UserSkill

router = APIRouter()


class CatalogUpsertPayload(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    active: bool = True


class CatalogRequestPayload(BaseModel):
    request_type: CatalogRequestType
    value: str = Field(min_length=2, max_length=120)


class CatalogReviewPayload(BaseModel):
    status: CatalogRequestStatus


@router.get("/catalog")
def get_catalog(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.employee, UserRole.manager, UserRole.hr_admin, UserRole.system_admin, UserRole.executive)),
) -> dict:
    departments = db.query(DepartmentCatalog).filter(DepartmentCatalog.active.is_(True)).order_by(DepartmentCatalog.name.asc()).all()
    job_titles = db.query(JobTitleCatalog).filter(JobTitleCatalog.active.is_(True)).order_by(JobTitleCatalog.name.asc()).all()
    skills = db.query(Skill).order_by(Skill.name.asc()).all()
    return {
        "departments": [d.name for d in departments],
        "job_titles": [j.name for j in job_titles],
        "primary_skills": [s.name for s in skills],
    }


@router.get("/catalog-admin")
def get_catalog_admin(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.hr_admin, UserRole.system_admin)),
) -> dict:
    departments = db.query(DepartmentCatalog).order_by(DepartmentCatalog.name.asc()).all()
    job_titles = db.query(JobTitleCatalog).order_by(JobTitleCatalog.name.asc()).all()
    skills = db.query(Skill).order_by(Skill.name.asc()).all()
    return {
        "departments": [{"id": str(d.id), "name": d.name, "active": d.active} for d in departments],
        "job_titles": [{"id": str(j.id), "name": j.name, "active": j.active} for j in job_titles],
        "primary_skills": [{"id": str(s.id), "name": s.name} for s in skills],
    }


@router.post("/departments")
def upsert_department(
    payload: CatalogUpsertPayload,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.hr_admin, UserRole.system_admin)),
) -> dict:
    row = db.query(DepartmentCatalog).filter(DepartmentCatalog.name == payload.name).one_or_none()
    if not row:
        row = DepartmentCatalog(name=payload.name, active=payload.active)
        db.add(row)
    else:
        row.active = payload.active
    db.commit()
    return {"ok": True}


@router.patch("/departments/{department_id}")
def update_department(
    department_id: uuid.UUID,
    payload: CatalogUpsertPayload,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.hr_admin, UserRole.system_admin)),
) -> dict:
    row = db.query(DepartmentCatalog).filter(DepartmentCatalog.id == department_id).one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")
    existing = db.query(DepartmentCatalog).filter(DepartmentCatalog.name == payload.name, DepartmentCatalog.id != department_id).one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Department already exists")
    row.name = payload.name
    row.active = payload.active
    db.commit()
    return {"ok": True}


@router.delete("/departments/{department_id}")
def delete_department(
    department_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.hr_admin, UserRole.system_admin)),
) -> dict:
    row = db.query(DepartmentCatalog).filter(DepartmentCatalog.id == department_id).one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")
    in_use = db.query(User).filter(User.department == row.name).first()
    if in_use:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete department in use by users")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/job-titles")
def upsert_job_title(
    payload: CatalogUpsertPayload,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.hr_admin, UserRole.system_admin)),
) -> dict:
    row = db.query(JobTitleCatalog).filter(JobTitleCatalog.name == payload.name).one_or_none()
    if not row:
        row = JobTitleCatalog(name=payload.name, active=payload.active)
        db.add(row)
    else:
        row.active = payload.active
    db.commit()
    return {"ok": True}


@router.patch("/job-titles/{job_title_id}")
def update_job_title(
    job_title_id: uuid.UUID,
    payload: CatalogUpsertPayload,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.hr_admin, UserRole.system_admin)),
) -> dict:
    row = db.query(JobTitleCatalog).filter(JobTitleCatalog.id == job_title_id).one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job title not found")
    existing = db.query(JobTitleCatalog).filter(JobTitleCatalog.name == payload.name, JobTitleCatalog.id != job_title_id).one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Job title already exists")
    row.name = payload.name
    row.active = payload.active
    db.commit()
    return {"ok": True}


@router.delete("/job-titles/{job_title_id}")
def delete_job_title(
    job_title_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.hr_admin, UserRole.system_admin)),
) -> dict:
    row = db.query(JobTitleCatalog).filter(JobTitleCatalog.id == job_title_id).one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job title not found")
    in_use_user = db.query(User).filter(User.job_title == row.name).first()
    in_use_project = db.query(ProjectJobTitleRequirement).filter(ProjectJobTitleRequirement.job_title == row.name).first()
    if in_use_user or in_use_project:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete job title in use")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/skills")
def upsert_skill(
    payload: CatalogUpsertPayload,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.hr_admin, UserRole.system_admin)),
) -> dict:
    row = db.query(Skill).filter(Skill.name == payload.name).one_or_none()
    if not row:
        db.add(Skill(name=payload.name, category="general"))
    db.commit()
    return {"ok": True}


@router.patch("/skills/{skill_id}")
def update_skill(
    skill_id: uuid.UUID,
    payload: CatalogUpsertPayload,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.hr_admin, UserRole.system_admin)),
) -> dict:
    row = db.query(Skill).filter(Skill.id == skill_id).one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found")
    existing = db.query(Skill).filter(Skill.name == payload.name, Skill.id != skill_id).one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Skill already exists")
    row.name = payload.name
    db.commit()
    return {"ok": True}


@router.delete("/skills/{skill_id}")
def delete_skill(
    skill_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.hr_admin, UserRole.system_admin)),
) -> dict:
    row = db.query(Skill).filter(Skill.id == skill_id).one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found")
    in_use_user_primary = db.query(User).filter(User.primary_skill == row.name).first()
    in_use_user_skills = db.query(UserSkill).filter(UserSkill.skill_id == row.id).first()
    in_use_project_skills = db.query(ProjectSkillRequirement).filter(ProjectSkillRequirement.skill_id == row.id).first()
    if in_use_user_primary or in_use_user_skills or in_use_project_skills:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete skill in use")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/requests")
def create_catalog_request(
    payload: CatalogRequestPayload,
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> dict:
    req = CatalogRequest(
        requested_by_user_id=manager.id,
        request_type=payload.request_type,
        value=payload.value,
        status=CatalogRequestStatus.pending,
    )
    db.add(req)
    db.commit()
    return {"ok": True}


@router.get("/requests")
def list_catalog_requests(
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.manager, UserRole.hr_admin, UserRole.system_admin)),
) -> list[dict]:
    q = db.query(CatalogRequest)
    if actor.role == UserRole.manager:
        q = q.filter(CatalogRequest.requested_by_user_id == actor.id)
    rows = q.order_by(CatalogRequest.created_at.desc()).all()
    return [
        {
            "id": str(r.id),
            "request_type": r.request_type.value,
            "value": r.value,
            "status": r.status.value,
            "requested_by_user_id": str(r.requested_by_user_id),
        }
        for r in rows
    ]


@router.post("/requests/{request_id}/review")
def review_catalog_request(
    request_id: uuid.UUID,
    payload: CatalogReviewPayload,
    db: Session = Depends(get_db),
    reviewer: User = Depends(require_roles(UserRole.hr_admin, UserRole.system_admin)),
) -> dict:
    req = db.query(CatalogRequest).filter(CatalogRequest.id == request_id).one_or_none()
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    req.status = payload.status
    req.reviewed_by_user_id = reviewer.id
    if payload.status == CatalogRequestStatus.approved:
        if req.request_type == CatalogRequestType.department:
            row = db.query(DepartmentCatalog).filter(DepartmentCatalog.name == req.value).one_or_none()
            if not row:
                db.add(DepartmentCatalog(name=req.value, active=True))
        elif req.request_type == CatalogRequestType.job_title:
            row = db.query(JobTitleCatalog).filter(JobTitleCatalog.name == req.value).one_or_none()
            if not row:
                db.add(JobTitleCatalog(name=req.value, active=True))
        elif req.request_type == CatalogRequestType.skill:
            row = db.query(Skill).filter(Skill.name == req.value).one_or_none()
            if not row:
                db.add(Skill(name=req.value, category="general"))
    db.commit()
    return {"ok": True}
