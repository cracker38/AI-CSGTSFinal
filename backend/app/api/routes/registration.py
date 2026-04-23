from __future__ import annotations

import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.master_data import DepartmentCatalog, JobTitleCatalog
from app.models.skill import Skill
from app.schemas.user import UserPublic
from app.services.audit import write_audit_log
from app.services.cv import save_and_process_cv
from app.services.users import create_employee_pending


router = APIRouter()


@router.get("/options")
def registration_options(db: Session = Depends(get_db)) -> dict:
    departments = [row[0] for row in db.query(DepartmentCatalog.name).filter(DepartmentCatalog.active.is_(True)).all()]
    job_titles = [row[0] for row in db.query(JobTitleCatalog.name).filter(JobTitleCatalog.active.is_(True)).all()]
    primary_skills = [row[0] for row in db.query(Skill.name).order_by(Skill.name.asc()).all()]
    return {
        "departments": departments,
        "job_titles": job_titles,
        "primary_skills": primary_skills,
    }


@router.post("/employee", response_model=UserPublic)
async def register_employee(
    request: Request,
    db: Session = Depends(get_db),
    full_name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    phone_number: str = Form(...),
    country: str = Form(...),
    department: str = Form(...),
    job_title: str = Form(...),
    experience_level: str = Form(...),
    primary_skill: str = Form(...),
    cv: UploadFile = File(...),
) -> UserPublic:
    opts = registration_options(db)
    if department not in opts["departments"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Department must be selected from the catalog")
    if job_title not in opts["job_titles"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Job title must be selected from the catalog")
    if primary_skill not in opts["primary_skills"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Primary skill must be selected from the catalog")
    if cv.content_type not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CV must be a PDF")
    pdf_bytes = await cv.read()
    if len(pdf_bytes) > 8 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CV too large (max 8MB)")

    try:
        user = create_employee_pending(
            db,
            full_name=full_name,
            email=email,
            password=password,
            phone_number=phone_number,
            country=country,
            department=department,
            job_title=job_title,
            experience_level=experience_level,
            primary_skill=primary_skill,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    upload_dir = os.path.join(os.getcwd(), "uploads")
    save_and_process_cv(db, user=user, original_filename=cv.filename or "cv.pdf", pdf_bytes=pdf_bytes, upload_dir=upload_dir)

    write_audit_log(
        db,
        request=request,
        actor_user_id=None,
        action="registration.employee_submitted",
        entity_type="user",
        entity_id=str(user.id),
        meta={"email": user.email},
    )

    return UserPublic(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        phone_number=user.phone_number,
        country=user.country,
        department=user.department,
        job_title=user.job_title,
        experience_level=user.experience_level,
        primary_skill=user.primary_skill,
        role=user.role.value,
        status=user.status.value,
        must_change_password=user.must_change_password,
        created_at=user.created_at,
    )
