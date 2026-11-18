# PolicyForge. Targets grow phase by phase; P8 adds the frontend and docker.
PY := backend/.venv/Scripts/python
ifeq ($(OS),)
PY := backend/.venv/bin/python
endif

.PHONY: test lint typecheck schemas check

test:
	cd backend && ../$(PY) -m pytest -o addopts="" -q --cov=core --cov-report=term

lint:
	cd backend && ../$(PY) -m ruff check core tests

typecheck:
	cd backend && ../$(PY) -m mypy

schemas:
	cd backend && ../$(PY) -m core.domain.schema_export

check: lint typecheck test
