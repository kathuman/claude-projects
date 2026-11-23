"""Background jobs (P7): evaluations and re-tests run in a worker thread and report their progress.

Jobs live in memory: they are for the screens' progress bars, while their results (evaluations, re-tests) are
stored in the registry like any other. One worker runs them in order, so two long evaluations never compete for the
CPU, and SQLite sees one writer at a time from here.
"""

from __future__ import annotations

import threading
import traceback
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import Field

from core.domain.common import Model

JobStatus = Literal["queued", "running", "done", "failed"]
Progress = Callable[[float, str], None]


class Job(Model):
    id: str
    kind: str
    title: str
    status: JobStatus = "queued"
    progress: float = Field(default=0.0, ge=0, le=1)
    message: str = ""
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: datetime
    updated_at: datetime


class Jobs:
    def __init__(self, workers: int = 1) -> None:
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="policyforge-job")
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def _set(self, jid: str, **kw: Any) -> None:
        with self._lock:
            self._jobs[jid] = self._jobs[jid].model_copy(update={**kw, "updated_at": datetime.now(UTC)})

    def submit(self, kind: str, title: str, work: Callable[[Progress], dict[str, Any]]) -> Job:
        """Queue `work(progress)`; it returns the job's result (ids of what it stored)."""
        now = datetime.now(UTC)
        job = Job(id=uuid.uuid4().hex[:12], kind=kind, title=title, created_at=now, updated_at=now)
        with self._lock:
            self._jobs[job.id] = job

        def run() -> None:
            self._set(job.id, status="running", message="started")

            def progress(fraction: float, message: str) -> None:
                self._set(job.id, progress=round(min(1.0, max(0.0, fraction)), 4), message=message)

            try:
                result = work(progress)
                self._set(job.id, status="done", progress=1.0, message="done", result=result)
            except Exception as e:  # the job reports any failure; the server keeps running
                self._set(job.id, status="failed", error=f"{type(e).__name__}: {e}",
                          message=traceback.format_exception_only(e)[-1].strip())

        self._pool.submit(run)
        return job

    def get(self, jid: str) -> Job | None:
        with self._lock:
            return self._jobs.get(jid)

    def all(self) -> list[Job]:
        with self._lock:
            return list(reversed(self._jobs.values()))  # newest first (submission order; clocks can tie)

    def wait(self, jid: str, timeout: float = 600) -> Job:
        """Block until the job ends (for tests and scripts)."""
        import time

        end = time.monotonic() + timeout
        while time.monotonic() < end:
            j = self.get(jid)
            if j is not None and j.status in ("done", "failed"):
                return j
            time.sleep(0.05)
        raise TimeoutError(jid)
