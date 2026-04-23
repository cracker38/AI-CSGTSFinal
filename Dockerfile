FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
ENV VITE_API_BASE="/api/v1"
RUN npm run build

FROM python:3.11-slim

RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:${PATH}"

WORKDIR /app/backend

COPY --chown=user backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir --upgrade -r /app/backend/requirements.txt

COPY --chown=user backend /app/backend
COPY --from=frontend-build --chown=user /app/frontend/dist /app/backend/app/static

# Hugging Face Docker Spaces must listen on port 7860.
ENV DATABASE_URL="sqlite:///./aicsgts_dev.db"
ENV CORS_ORIGINS="https://huggingface.co,https://*.hf.space"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
