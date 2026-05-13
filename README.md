---
title: AI-CSGTS
emoji: "🤖"
colorFrom: indigo
colorTo: blue
sdk: docker
short_description: Workforce Intelligence Platform
app_port: 7860
---

# AI-CSGTS (AI-Powered Competency & Skill Gap Tracking System)

Enterprise Workforce Intelligence Platform (MVP scaffold).

## What’s included (today)

- FastAPI backend with **RBAC**, JWT auth, bcrypt passwords
- Required **default System Admin** seed:
  - Email: `it.elias38@gmail.com`
  - Password: `Shema@123`
  - **First login forces password change**
- Employee registration with exactly **10 inputs** + **CV PDF upload**
- CV processing (starter NLP): extract skills/education/certifications + enrich skill profile
- Approval workflow: employee accounts start **Pending Approval**; HR/System Admin/Manager can approve (MVP)
- Audit logging (core events)
- React frontend with role-aware dashboard shell + registration/login flows

## Prerequisites

- Docker Desktop (for Postgres) **or** a local PostgreSQL server
- Python 3.11+
- Node.js 18+

## 1) Start PostgreSQL

From the repo root:

```bash
docker compose up -d
```

If you don’t have Docker installed, install Docker Desktop (Windows) or run a local PostgreSQL and update `backend/.env` `DATABASE_URL`.

## 2) Backend (FastAPI)

```bash
cd backend
copy .env.example .env
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8010
```

API base URL: `http://localhost:8010/api/v1`

## 3) Frontend (React)

```bash
cd frontend
copy .env.example .env
npm install
npm run dev
```

Open: `http://localhost:5173`

## MVP Flow to try

1. Login as System Admin -> forced password change
2. Register an employee (10 fields + CV PDF)
3. Login as System Admin → Approve pending employee
4. Login as employee -> View AI skill gaps + explainable recommendations

## Notes / Next steps

This is a functional foundation intended to be expanded into the full platform modules (training, project staffing, forecasting, integrations, etc.).
