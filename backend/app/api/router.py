from fastapi import APIRouter

from app.api.routes import (
    admin_system,
    analytics,
    auth,
    hr_actions,
    hr_analytics,
    master_data,
    manager_dashboard,
    org_analytics,
    registration,
    users_admin,
)


api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(registration.router, prefix="/registration", tags=["registration"])
api_router.include_router(users_admin.router, prefix="/admin/users", tags=["admin-users"])
api_router.include_router(admin_system.router, prefix="/admin/system", tags=["admin-system"])
api_router.include_router(analytics.router, prefix="/analytics", tags=["analytics"])
api_router.include_router(org_analytics.router, prefix="/analytics", tags=["org-analytics"])
api_router.include_router(hr_analytics.router, prefix="/analytics", tags=["hr-analytics"])
api_router.include_router(hr_actions.router, prefix="/analytics", tags=["hr-actions"])
api_router.include_router(manager_dashboard.router, prefix="/manager", tags=["manager"])
api_router.include_router(master_data.router, prefix="/master-data", tags=["master-data"])
