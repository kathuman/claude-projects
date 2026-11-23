# PolicyForge. `make up` runs it in Docker; `make test` runs every check there is.
# Local development needs backend/.venv (see README) and, for the frontend, Node 22 with `npm ci` in frontend/.
# PY: the backend's Python (override with `make test PY=python` when the packages are installed elsewhere)
ifeq ($(OS),Windows_NT)
PY ?= $(CURDIR)/backend/.venv/Scripts/python
else
PY ?= $(CURDIR)/backend/.venv/bin/python
endif
COMPOSE ?= docker compose

.PHONY: help up down logs build test test-backend test-frontend lint typecheck coverage schemas check \
        serve demo studio studio-dev studio-test e2e e2e-docker

help:
	@echo "make up            start the API (:8000) and the app (:8080) in Docker"
	@echo "make down          stop them (the database volume stays; 'make down V=1' drops it)"
	@echo "make test          everything: lint, types, backend tests with coverage, frontend tests, browser tests"
	@echo "make demo          the command-line examples (stress test, report, compile, monitoring)"
	@echo "make serve         the API locally on :8000, the app at http://127.0.0.1:8000/app/"

# ---------------------------------------------------------------- Docker
up:
	$(COMPOSE) up -d --build
	@echo "PolicyForge: http://localhost:8080/  (API docs: http://localhost:8000/docs)"

down:
	$(COMPOSE) down $(if $(V),-v,)

logs:
	$(COMPOSE) logs -f

build:
	$(COMPOSE) build

# ---------------------------------------------------------------- tests
test: lint typecheck coverage test-frontend e2e

test-backend: lint typecheck coverage

lint:
	cd backend && $(PY) -m ruff check core api tests examples

typecheck:
	cd backend && $(PY) -m mypy

coverage:
	cd backend && $(PY) -m pytest -o addopts="" -q --cov=core --cov=api --cov-report=term --cov-fail-under=80

test-frontend:
	cd frontend && npx tsc --noEmit -p . && npx vitest run

e2e:
	cd frontend && npm run e2e

# the browser tests against a stack started with `make up`
e2e-docker:
	cd frontend && PF_BASE_URL=http://localhost:8080 npx playwright test

check: test-backend

schemas:
	cd backend && $(PY) -m core.domain.schema_export

# ---------------------------------------------------------------- running locally
serve:
	cd backend && $(PY) -m uvicorn api.app:app --reload

demo:
	cd backend && $(PY) -m examples.first_stress_test
	cd backend && $(PY) -m examples.compile_intent
	cd backend && $(PY) -m examples.monitor_demo

studio:
	cd frontend && npm ci && npm run build

studio-dev:
	cd frontend && npm run dev

studio-test: test-frontend
