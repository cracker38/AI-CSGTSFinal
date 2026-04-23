from app.models.audit_log import AuditLog  # noqa: F401
from app.models.backup_job import BackupJob  # noqa: F401
from app.models.cv_document import CvDocument  # noqa: F401
from app.models.hr_action import HrAction  # noqa: F401
from app.models.employee_profile import EmployeeProfile  # noqa: F401
from app.models.integration import Integration  # noqa: F401
from app.models.manager_project import (  # noqa: F401
    ManagerProject,
    ProjectAssignment,
    ProjectJobTitleRequirement,
    ProjectSkillRequirement,
)
from app.models.master_data import CatalogRequest, DepartmentCatalog, JobTitleCatalog  # noqa: F401
from app.models.skill import Skill  # noqa: F401
from app.models.system_setting import SystemSetting  # noqa: F401
from app.models.user import User  # noqa: F401
from app.models.user_skill import UserSkill  # noqa: F401
