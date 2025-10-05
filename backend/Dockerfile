# backend/Dockerfile
FROM python:3.10-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# System deps (build tools often needed for scientific libs; adjust as needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl \
  && rm -rf /var/lib/apt/lists/*

# Copy requirements first for cache
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy the backend code
COPY backend /app

# Create data mounts for SQLite + artifacts (filled by volumes)
RUN mkdir -p /data /artifacts

# Recommended: configure via env (compose will override)
ENV META_DB=/data/meta.sqlite \
    AIDO_ARTIFACT_DIR=/artifacts \
    UVICORN_WORKERS=1

EXPOSE 8000
CMD ["bash", "-lc", "uvicorn app.main:app --host 0.0.0.0 --port 8000"]
