# PolicyForge. Targets grow phase by phase; P8 adds docker.
PY := backend/.venv/Scripts/python
ifeq ($(OS),)
PY := backend/.venv/bin/python
endif

.PHONY: test lint typecheck schemas check serve studio studio-dev studio-test e2e

test:
	cd backend && ../$(PY) -m pytest -o addopts="" -q --cov=core --cov=api --cov-report=term

lint:
	cd backend && ../$(PY) -m ruff check core api tests examples

typecheck:
	cd backend && ../$(PY) -m mypy

schemas:
	cd backend && ../$(PY) -m core.domain.schema_export

check: lint typecheck test

serve:
	cd backend && ../$(PY) -m uvicorn api.app:app --reload

# The Network Studio (frontend/): build it once and `make serve` serves it at http://127.0.0.1:8000/app/
studio:
	cd frontend && npm ci && npm run build

studio-dev:
	cd frontend && npm run dev

studio-test:
	cd frontend && npx tsc --noEmit -p . && npx vitest run

e2e:
	cd frontend && npm run e2e
