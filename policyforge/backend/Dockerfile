# PolicyForge API: FastAPI on Python 3.12. Built from the policyforge/ folder (see docker-compose.yml).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    POLICYFORGE_DB=sqlite:////data/policyforge.db \
    LLM_PROVIDER=mock

WORKDIR /srv/backend

# Dependencies first, so code changes do not reinstall them
COPY backend/pyproject.toml ./
RUN mkdir -p core api && touch core/__init__.py api/__init__.py \
    && pip install -e . \
    && rm -rf core api

# The code, the synthetic data, the schemas and the recorded intents (the offline compiler replays them)
COPY backend/ ./
RUN pip install -e . --no-deps \
    && mkdir -p /data \
    && useradd --create-home --uid 10001 policyforge \
    && chown -R policyforge /data
USER policyforge
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=12 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status == 200 else 1)"

CMD ["uvicorn", "api.app:app", "--host", "0.0.0.0", "--port", "8000"]
