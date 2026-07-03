# --- builder: ставим зависимости в venv ---
FROM python:3.12-slim AS builder

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /venv
ENV PATH="/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install -r requirements.txt

# --- runtime: только рантайм-библиотеки ---
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PATH="/venv/bin:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

WORKDIR /code
COPY --from=builder /venv /venv
COPY . .

EXPOSE 8000
# Прод-запуск: миграции + uvicorn с воркерами. Dev-режим (--reload)
# переопределяется командой в docker-compose.dev.yml.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2"]
