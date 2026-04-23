from __future__ import annotations

import os
import uuid
from typing import Any

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.models.hr_action import HrAction

# PDF and common video types only.
ALLOWED_CONTENT_TYPES: dict[str, str] = {
    "application/pdf": "pdf",
    "video/mp4": "video",
    "video/webm": "video",
    "video/quicktime": "video",
}
MAX_MATERIAL_BYTES = 80 * 1024 * 1024


def _training_materials_dir(upload_root: str) -> str:
    d = os.path.join(upload_root, "training_materials")
    os.makedirs(d, exist_ok=True)
    return d


def _legacy_text_keys() -> tuple[str, ...]:
    return ("provider", "course_url", "syllabus")


def _strip_legacy_material_fields(payload: dict) -> None:
    for k in _legacy_text_keys():
        payload.pop(k, None)


def material_upload_subdir() -> str:
    return "training_materials"


def resolve_material_path(upload_root: str, stored_basename: str) -> str | None:
    """Return absolute path if basename is safe and file exists."""
    if not stored_basename or "/" in stored_basename or "\\" in stored_basename or ".." in stored_basename:
        return None
    if not stored_basename.startswith("training-"):
        return None
    path = os.path.join(upload_root, material_upload_subdir(), stored_basename)
    if not os.path.isfile(path):
        return None
    return path


async def save_training_course_material(
    db: Session,
    action: HrAction,
    upload_root: str,
    file: UploadFile,
) -> HrAction:
    """Replace any previous file; store only PDF or video. Updates action.payload."""
    if action.action_type != "training_assign":
        raise ValueError("Not a training assignment")
    if action.status in ("cancelled",):
        raise ValueError("Assignment is not active")

    ct = (file.content_type or "").split(";")[0].strip().lower()
    kind = ALLOWED_CONTENT_TYPES.get(ct)
    if not kind and ct in ("application/octet-stream", "binary/octet-stream"):
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext == ".pdf":
            kind, ct = "pdf", "application/pdf"
        elif ext in (".mp4", ".webm", ".mov"):
            kind = "video"
            ct = {".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime"}.get(ext, "video/mp4")
    if not kind:
        raise ValueError("Only PDF or video uploads are allowed (PDF, MP4, WebM, MOV).")

    raw = await file.read()
    if len(raw) > MAX_MATERIAL_BYTES:
        raise ValueError(f"File too large (max {MAX_MATERIAL_BYTES // (1024 * 1024)} MB).")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if kind == "pdf":
        suffix = ".pdf"
    elif ext in (".mp4", ".webm", ".mov"):
        suffix = ext
    else:
        suffix = ".mp4"

    stored_name = f"training-{uuid.uuid4().hex}{suffix}"
    dest_dir = _training_materials_dir(upload_root)
    dest_path = os.path.join(dest_dir, stored_name)

    payload: dict[str, Any] = dict(action.payload or {})
    _strip_legacy_material_fields(payload)
    old_stored = (payload.get("course_material_stored") or "").strip()
    if old_stored:
        old_path = resolve_material_path(upload_root, old_stored)
        if old_path:
            try:
                os.remove(old_path)
            except OSError:
                pass

    with open(dest_path, "wb") as f:
        f.write(raw)

    orig_name = (file.filename or ("material.pdf" if kind == "pdf" else "material.mp4")).strip()[:240]
    payload["course_material_stored"] = stored_name
    payload["course_material_kind"] = kind
    payload["course_material_filename"] = orig_name
    payload["course_material_bytes"] = len(raw)
    payload["course_material_content_type"] = ct
    action.payload = payload
    db.add(action)
    db.commit()
    db.refresh(action)
    return action


def get_material_download_path(action: HrAction, upload_root: str) -> tuple[str, str, str]:
    """Returns (absolute_path, download_filename, media_type) or raises HTTPException."""
    payload = dict(action.payload or {})
    stored = (payload.get("course_material_stored") or "").strip()
    if not stored:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No course material uploaded")
    path = resolve_material_path(upload_root, stored)
    if not path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course file missing on server")
    fname = (payload.get("course_material_filename") or "course-material").strip()[:240]
    kind = str(payload.get("course_material_kind") or "pdf")
    ct = (payload.get("course_material_content_type") or "").strip().lower()
    if ct and "/" in ct:
        media_type = ct
    elif kind == "pdf":
        media_type = "application/pdf"
    else:
        media_type = "video/mp4"
    return path, fname, media_type
