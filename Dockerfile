# syntax=docker/dockerfile:1
# CartChef: one container for Cloud Run. Stage 1 builds the React app; stage 2 is the
# Python runtime that serves the API and the built files (no Node or node_modules in it).

# ---- Stage 1: build the frontend (Node LTS, same version that produced package-lock.json) ----
FROM node:24.13.0-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: Python runtime ----
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080 \
    TRUST_PROXY_HOPS=1
WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY app.py database.py gcp.py ingredients.py shopping.py ./
COPY --from=frontend /build/dist ./frontend/dist

RUN useradd --create-home --uid 10001 cartchef \
    && mkdir instance && chown cartchef:cartchef instance
USER cartchef

EXPOSE 8080
# One worker: SQLite, the in-memory rate limiter and the Cloud Storage backup assume a
# single process. Threads give concurrency. Cloud Run sets PORT.
CMD exec gunicorn --workers 1 --threads 8 --timeout 60 --bind "0.0.0.0:${PORT}" "app:create_app()"
