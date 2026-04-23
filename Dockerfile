FROM python:3.11-slim

RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:${PATH}"

WORKDIR /app/backend

COPY --chown=user backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir --upgrade -r /app/backend/requirements.txt

COPY --chown=user backend /app/backend

# Hugging Face Docker Spaces must listen on port 7860.
ENV DATABASE_URL="sqlite:///./aicsgts_dev.db"
ENV CORS_ORIGINS="https://huggingface.co"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
