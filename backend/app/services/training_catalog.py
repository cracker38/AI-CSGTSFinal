"""Curated official training programs mapped to canonical skills (no demo placeholders)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class OfficialCourse:
    course_id: str
    title: str
    provider: str
    url: str
    target_skills: tuple[str, ...]
    level: str  # beginner | intermediate | advanced
    duration_weeks: int
    delivery_mode: str
    certification: bool
    description: str


# Real vendor programs — titles and URLs are stable public learning paths.
OFFICIAL_COURSE_CATALOG: tuple[OfficialCourse, ...] = (
    OfficialCourse(
        "py-coursera-everybody",
        "Python for Everybody Specialization",
        "Coursera (University of Michigan)",
        "https://www.coursera.org/specializations/python",
        ("python",),
        "beginner",
        8,
        "Online",
        True,
        "Python fundamentals variables functions data structures web data with Python",
    ),
    OfficialCourse(
        "py-ms-learn",
        "Python basics for beginners",
        "Microsoft Learn",
        "https://learn.microsoft.com/en-us/training/paths/beginner-python/",
        ("python",),
        "beginner",
        4,
        "Online",
        True,
        "Python syntax data types control flow functions modules beginner programming",
    ),
    OfficialCourse(
        "sql-ibm-coursera",
        "Databases and SQL for Data Science with Python",
        "Coursera (IBM)",
        "https://www.coursera.org/learn/sql-data-science",
        ("sql", "python", "data analysis"),
        "intermediate",
        6,
        "Online",
        True,
        "relational databases SQL queries joins Python data science analytics",
    ),
    OfficialCourse(
        "sql-ms-learn",
        "Write basic T-SQL queries",
        "Microsoft Learn",
        "https://learn.microsoft.com/en-us/training/paths/write-basic-transact-sql-queries/",
        ("sql",),
        "beginner",
        3,
        "Online",
        True,
        "T-SQL SELECT filtering joins SQL Server relational data querying",
    ),
    OfficialCourse(
        "pandas-coursera",
        "Data Analysis with Python",
        "Coursera (IBM)",
        "https://www.coursera.org/learn/data-analysis-with-python",
        ("pandas", "python", "data analysis"),
        "intermediate",
        5,
        "Online",
        True,
        "pandas numpy data wrangling exploratory analysis Python data science",
    ),
    OfficialCourse(
        "ml-ng-coursera",
        "Machine Learning Specialization",
        "Coursera (DeepLearning.AI)",
        "https://www.coursera.org/specializations/machine-learning-introduction",
        ("machine learning", "python", "scikit-learn"),
        "intermediate",
        10,
        "Online",
        True,
        "supervised unsupervised learning neural networks scikit-learn regression classification",
    ),
    OfficialCourse(
        "dl-tensorflow",
        "TensorFlow Developer Certificate preparation",
        "TensorFlow / Coursera",
        "https://www.coursera.org/professional-certificates/tensorflow-in-practice",
        ("tensorflow", "deep learning", "python"),
        "advanced",
        12,
        "Online",
        True,
        "deep learning neural networks CNN NLP TensorFlow keras computer vision",
    ),
    OfficialCourse(
        "pytorch-meta",
        "PyTorch for Deep Learning",
        "Udacity / Meta",
        "https://www.udacity.com/course/deep-learning-pytorch--ud188",
        ("pytorch", "deep learning"),
        "advanced",
        8,
        "Online",
        True,
        "PyTorch tensors autograd neural networks deep learning training",
    ),
    OfficialCourse(
        "aws-cloud-practitioner",
        "AWS Cloud Practitioner Essentials",
        "AWS Skill Builder",
        "https://skillbuilder.aws/learn/6PNXJ9XBU1",
        ("aws", "cloud"),
        "beginner",
        4,
        "Online",
        True,
        "AWS cloud concepts IAM EC2 S3 billing architecture fundamentals certification",
    ),
    OfficialCourse(
        "aws-solutions-architect",
        "AWS Solutions Architect – Associate learning plan",
        "AWS Skill Builder",
        "https://aws.amazon.com/training/learn-about/architecting/",
        ("aws", "system design"),
        "advanced",
        10,
        "Online",
        True,
        "AWS architecture high availability scalability VPC security well-architected",
    ),
    OfficialCourse(
        "azure-fundamentals",
        "Microsoft Azure Fundamentals (AZ-900)",
        "Microsoft Learn",
        "https://learn.microsoft.com/en-us/credentials/certifications/azure-fundamentals/",
        ("azure",),
        "beginner",
        4,
        "Online",
        True,
        "Azure cloud services compute storage networking pricing governance fundamentals",
    ),
    OfficialCourse(
        "gcp-cloud-engineer",
        "Prepare for Google Cloud Associate Cloud Engineer",
        "Google Cloud Skills Boost",
        "https://www.cloudskillsboost.google/paths/11",
        ("gcp",),
        "intermediate",
        6,
        "Online",
        True,
        "Google Cloud Compute Engine Kubernetes IAM networking storage operations",
    ),
    OfficialCourse(
        "docker-foundations",
        "Docker Foundations",
        "Docker",
        "https://www.docker.com/training/",
        ("docker", "devops"),
        "beginner",
        3,
        "Online",
        True,
        "containers images Dockerfile compose containerization DevOps fundamentals",
    ),
    OfficialCourse(
        "k8s-linux-foundation",
        "Introduction to Kubernetes",
        "Linux Foundation (edX)",
        "https://www.edx.org/learn/kubernetes/linuxfoundation/introduction-to-kubernetes",
        ("kubernetes", "docker", "devops"),
        "intermediate",
        6,
        "Online",
        True,
        "Kubernetes pods deployments services scaling cluster administration",
    ),
    OfficialCourse(
        "terraform-hashicorp",
        "HashiCorp Terraform Associate preparation",
        "HashiCorp Learn",
        "https://developer.hashicorp.com/terraform/tutorials/certification-associate",
        ("terraform", "devops"),
        "intermediate",
        5,
        "Online",
        True,
        "Terraform infrastructure as code providers state modules cloud provisioning",
    ),
    OfficialCourse(
        "react-meta-coursera",
        "Meta Front-End Developer Professional Certificate",
        "Coursera (Meta)",
        "https://www.coursera.org/professional-certificates/meta-front-end-developer",
        ("react", "javascript", "html"),
        "intermediate",
        9,
        "Online",
        True,
        "React JavaScript HTML CSS front-end web development components hooks",
    ),
    OfficialCourse(
        "js-meta-coursera",
        "Programming with JavaScript",
        "Coursera (Meta)",
        "https://www.coursera.org/learn/programming-with-javascript",
        ("javascript",),
        "beginner",
        5,
        "Online",
        True,
        "JavaScript programming fundamentals functions objects arrays browser",
    ),
    OfficialCourse(
        "ts-ms-learn",
        "Build JavaScript applications with TypeScript",
        "Microsoft Learn",
        "https://learn.microsoft.com/en-us/training/paths/build-javascript-applications-typescript/",
        ("typescript", "javascript"),
        "intermediate",
        4,
        "Online",
        True,
        "TypeScript types interfaces generics JavaScript application development",
    ),
    OfficialCourse(
        "fastapi-docs",
        "FastAPI documentation tutorial path",
        "FastAPI (official)",
        "https://fastapi.tiangolo.com/tutorial/",
        ("fastapi", "python", "rest api"),
        "intermediate",
        3,
        "Online",
        False,
        "FastAPI Python async REST API OpenAPI dependency injection backend",
    ),
    OfficialCourse(
        "django-official",
        "Django documentation — Writing your first app",
        "Django Project (official)",
        "https://docs.djangoproject.com/en/stable/intro/",
        ("django", "python"),
        "intermediate",
        5,
        "Online",
        False,
        "Django Python web framework models views templates ORM admin",
    ),
    OfficialCourse(
        "git-github",
        "Introduction to Git and GitHub",
        "Coursera (Google)",
        "https://www.coursera.org/learn/introduction-git-github",
        ("git",),
        "beginner",
        3,
        "Online",
        True,
        "Git version control branching GitHub collaboration pull requests",
    ),
    OfficialCourse(
        "cicd-google",
        "Continuous Delivery & DevOps",
        "Coursera (University of Virginia)",
        "https://www.coursera.org/learn/uva-darden-continous-delivery-devops",
        ("ci/cd", "devops", "jenkins"),
        "intermediate",
        6,
        "Online",
        True,
        "continuous integration delivery DevOps pipelines automation deployment",
    ),
    OfficialCourse(
        "agile-atlassian",
        "Agile with Atlassian Jira",
        "Coursera (Atlassian)",
        "https://www.coursera.org/learn/agile-atlassian-jira",
        ("agile", "jira", "scrum"),
        "beginner",
        4,
        "Online",
        True,
        "Agile Scrum Kanban Jira boards sprints backlog project delivery",
    ),
    OfficialCourse(
        "pm-google",
        "Google Project Management Certificate",
        "Coursera (Google)",
        "https://www.coursera.org/professional-certificates/google-project-management",
        ("project management",),
        "beginner",
        8,
        "Online",
        True,
        "project management planning risk stakeholders agile foundations Google",
    ),
    OfficialCourse(
        "comm-coursera",
        "Improving Communication Skills",
        "Coursera (Wharton)",
        "https://www.coursera.org/learn/wharton-communication-skills",
        ("communication",),
        "beginner",
        4,
        "Online",
        True,
        "business communication presentations listening persuasion workplace skills",
    ),
    OfficialCourse(
        "powerbi-ms",
        "Get started with Microsoft Power BI",
        "Microsoft Learn",
        "https://learn.microsoft.com/en-us/training/paths/get-started-with-power-bi/",
        ("power bi", "data visualization"),
        "beginner",
        4,
        "Online",
        True,
        "Power BI dashboards reports DAX data modeling visualization analytics",
    ),
    OfficialCourse(
        "tableau-training",
        "Tableau Desktop Specialist learning path",
        "Tableau (Salesforce)",
        "https://www.tableau.com/learn/training",
        ("tableau", "data visualization"),
        "intermediate",
        5,
        "Online",
        True,
        "Tableau visualization dashboards charts analytics business intelligence",
    ),
    OfficialCourse(
        "nlp-huggingface",
        "NLP Course",
        "Hugging Face (official)",
        "https://huggingface.co/learn/nlp-course/chapter1/1",
        ("nlp", "machine learning", "python"),
        "intermediate",
        6,
        "Online",
        False,
        "natural language processing transformers tokenization Hugging Face models",
    ),
    OfficialCourse(
        "spark-databricks",
        "Apache Spark programming with Databricks",
        "Databricks Academy",
        "https://www.databricks.com/learn/training/home",
        ("spark", "python", "data analysis"),
        "advanced",
        8,
        "Online",
        True,
        "Apache Spark big data distributed computing Databricks SQL analytics",
    ),
    OfficialCourse(
        "mongodb-university",
        "MongoDB Basics",
        "MongoDB University",
        "https://learn.mongodb.com/learn/course/mongodb-basics",
        ("mongodb",),
        "beginner",
        3,
        "Online",
        True,
        "MongoDB NoSQL documents queries aggregation database fundamentals",
    ),
    OfficialCourse(
        "redis-university",
        "Redis University — RU101 Introduction to Redis",
        "Redis",
        "https://university.redis.com/courses/ru101/",
        ("redis",),
        "beginner",
        2,
        "Online",
        True,
        "Redis caching data structures key-value in-memory database",
    ),
    OfficialCourse(
        "linux-foundation",
        "Introduction to Linux",
        "Linux Foundation (edX)",
        "https://www.edx.org/learn/linux/linuxfoundation/introduction-to-linux",
        ("linux",),
        "beginner",
        4,
        "Online",
        True,
        "Linux command line shell filesystem permissions processes administration",
    ),
    OfficialCourse(
        "java-oracle",
        "Java Programming and Software Engineering Fundamentals",
        "Coursera (Duke)",
        "https://www.coursera.org/specializations/java-programming",
        ("java",),
        "beginner",
        8,
        "Online",
        True,
        "Java OOP programming software engineering problem solving",
    ),
    OfficialCourse(
        "angular-google",
        "Angular - Getting Started",
        "Angular (official)",
        "https://angular.dev/tutorials/learn-angular",
        ("angular", "typescript"),
        "intermediate",
        5,
        "Online",
        False,
        "Angular TypeScript components services routing front-end framework",
    ),
    OfficialCourse(
        "vue-official",
        "Vue.js - The official guide",
        "Vue.js",
        "https://vuejs.org/tutorial/",
        ("vue", "javascript"),
        "beginner",
        4,
        "Online",
        False,
        "Vue.js reactive components composition API front-end JavaScript",
    ),
    OfficialCourse(
        "graphql-apollo",
        "GraphQL with Apollo",
        "Apollo GraphQL (official)",
        "https://www.apollographql.com/tutorials/",
        ("graphql", "rest api"),
        "intermediate",
        4,
        "Online",
        False,
        "GraphQL schemas queries mutations Apollo client server APIs",
    ),
    OfficialCourse(
        "recruitment-linkedin",
        "Talent Acquisition",
        "LinkedIn Learning",
        "https://www.linkedin.com/learning/paths/become-a-talent-acquisition-specialist",
        ("recruitment",),
        "intermediate",
        5,
        "Online",
        True,
        "talent acquisition hiring recruiting interviewing employer branding HR",
    ),
    OfficialCourse(
        "people-analytics-coursera",
        "People Analytics",
        "Coursera (Wharton)",
        "https://www.coursera.org/learn/wharton-people-analytics",
        ("people analytics", "data analysis"),
        "intermediate",
        5,
        "Online",
        True,
        "HR analytics workforce data metrics talent decisions people science",
    ),
    OfficialCourse(
        "financial-analysis-coursera",
        "Introduction to Financial Accounting",
        "Coursera (Wharton)",
        "https://www.coursera.org/learn/wharton-accounting",
        ("financial analysis", "excel"),
        "beginner",
        6,
        "Online",
        True,
        "financial statements accounting balance sheet income statement analysis",
    ),
    OfficialCourse(
        "digital-marketing-google",
        "Google Digital Marketing & E-commerce Certificate",
        "Coursera (Google)",
        "https://www.coursera.org/professional-certificates/google-digital-marketing-ecommerce",
        ("digital marketing", "seo"),
        "beginner",
        8,
        "Online",
        True,
        "digital marketing SEO SEM e-commerce analytics Google campaigns",
    ),
    OfficialCourse(
        "statistics-coursera",
        "Statistics with Python",
        "Coursera (University of Michigan)",
        "https://www.coursera.org/specializations/statistics-with-python",
        ("statistics", "python", "data analysis"),
        "intermediate",
        7,
        "Online",
        True,
        "statistics probability inference hypothesis testing Python data science",
    ),
    OfficialCourse(
        "system-design-educative",
        "Grokking the System Design Interview",
        "Educative",
        "https://www.educative.io/courses/grokking-the-system-design-interview",
        ("system design",),
        "advanced",
        6,
        "Online",
        False,
        "system design scalability distributed systems architecture interviews",
    ),
    OfficialCourse(
        "risk-management-coursera",
        "Financial Risk Management",
        "Coursera",
        "https://www.coursera.org/learn/financial-risk-management",
        ("risk management",),
        "intermediate",
        5,
        "Online",
        True,
        "financial risk VaR credit market risk management portfolio",
    ),
    OfficialCourse(
        "scikit-learn-official",
        "Scikit-learn course",
        "INRIA / scikit-learn",
        "https://inria.github.io/scikit-learn-mooc/",
        ("scikit-learn", "machine learning", "python"),
        "intermediate",
        6,
        "Online",
        True,
        "scikit-learn supervised learning model selection pipelines machine learning Python",
    ),
)


def courses_for_skill(canonical_skill: str) -> list[OfficialCourse]:
    """Return catalog entries that explicitly target this canonical skill."""
    skill = (canonical_skill or "").strip().lower()
    if not skill:
        return []
    direct = [c for c in OFFICIAL_COURSE_CATALOG if skill in c.target_skills]
    if direct:
        return direct
    partial = [
        c
        for c in OFFICIAL_COURSE_CATALOG
        if skill in c.description.lower() or skill in c.title.lower()
    ]
    return partial


def course_by_id(course_id: str | None) -> OfficialCourse | None:
    cid = (course_id or "").strip()
    if not cid:
        return None
    for course in OFFICIAL_COURSE_CATALOG:
        if course.course_id == cid:
            return course
    return None


def course_by_title(program_name: str | None) -> OfficialCourse | None:
    title = (program_name or "").strip().lower()
    if not title:
        return None
    for course in OFFICIAL_COURSE_CATALOG:
        if course.title.strip().lower() == title:
            return course
    for course in OFFICIAL_COURSE_CATALOG:
        ct = course.title.strip().lower()
        if title in ct or ct in title:
            return course
    return None


def resolve_official_course_link(
    *,
    catalog_course_id: str | None = None,
    program_name: str | None = None,
    target_skill: str | None = None,
    official_url: str | None = None,
    provider: str | None = None,
) -> dict:
    """
    Resolve the AI/catalog official course link for a training assignment.
    Prefers stored payload values; falls back to catalog lookup by id, title, or skill.
    """
    url = (official_url or "").strip() or None
    prov = (provider or "").strip() or None
    cid = (catalog_course_id or "").strip() or None
    course: OfficialCourse | None = None

    if cid:
        course = course_by_id(cid)
    if not course and program_name:
        course = course_by_title(program_name)
    if not course and target_skill:
        matches = courses_for_skill((target_skill or "").strip().lower())
        if matches:
            course = matches[0]

    if course:
        cid = cid or course.course_id
        url = url or (course.url.strip() or None)
        prov = prov or course.provider

    return {
        "official_url": url,
        "provider": prov,
        "catalog_course_id": cid,
        "link_source": "catalog" if course else ("payload" if url else None),
    }
