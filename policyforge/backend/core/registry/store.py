"""The registry's tables (SQLModel on SQLite) and the append-only, hash-chained audit log.

Content is stored as canonical JSON text. A version's content never changes once written; only a policy's status
moves. The audit table is protected by SQLite triggers that refuse UPDATE and DELETE, and every entry carries a
SHA-256 hash over its own fields and the previous entry's hash, so an edit made around the triggers is still found
by `verify_chain`.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import event, text
from sqlalchemy.engine import Engine
from sqlalchemy.pool import StaticPool
from sqlmodel import Field, Session, SQLModel, create_engine, select

GENESIS = "0" * 64


def canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def content_hash(obj: Any) -> str:
    return hashlib.sha256(canonical(obj).encode("utf-8")).hexdigest()


def utcnow() -> datetime:
    return datetime.now(UTC)


class NetworkRow(SQLModel, table=True):
    __tablename__ = "networks"
    network_id: str = Field(primary_key=True)
    version: int = Field(primary_key=True)
    content_hash: str
    body: str
    actor: str
    created_at: datetime


class ConstitutionRow(SQLModel, table=True):
    __tablename__ = "constitutions"
    constitution_id: str = Field(primary_key=True)
    version: int = Field(primary_key=True)
    content_hash: str
    body: str
    active: bool = False
    actor: str
    created_at: datetime


class PolicyRow(SQLModel, table=True):
    __tablename__ = "policies"
    policy_id: str = Field(primary_key=True)
    version: int = Field(primary_key=True)
    status: str
    content_hash: str
    agent_id: str = Field(index=True)
    owner: str
    expires_at: datetime
    network_ref: str  # network id@version the version was written for
    body: str
    actor: str
    created_at: datetime
    updated_at: datetime


class EvaluationRow(SQLModel, table=True):
    __tablename__ = "evaluations"
    id: int | None = Field(default=None, primary_key=True)
    report_id: str
    policy_id: str = Field(index=True)
    policy_version: int
    policy_hash: str
    network_ref: str
    constitution_ref: str
    verdict: str
    replications: int
    body: str
    actor: str
    created_at: datetime


class AuditRow(SQLModel, table=True):
    __tablename__ = "audit"
    seq: int | None = Field(default=None, primary_key=True)
    ts: str
    actor: str
    action: str
    object_type: str
    object_ref: str
    payload: str
    prev_hash: str
    hash: str


AUDIT_TRIGGERS = (
    "CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit "
    "BEGIN SELECT RAISE(ABORT, 'the audit log is append-only'); END",
    "CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit "
    "BEGIN SELECT RAISE(ABORT, 'the audit log is append-only'); END",
)


def make_engine(url: str = "sqlite://") -> Engine:
    """An engine with the schema and the audit triggers. `sqlite://` is in memory (one shared connection)."""
    kwargs: dict[str, Any] = {"connect_args": {"check_same_thread": False}}
    if url in ("sqlite://", "sqlite:///:memory:"):
        kwargs["poolclass"] = StaticPool
    engine = create_engine(url, **kwargs)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn: Any, _: Any) -> None:  # pragma: no cover - trivial pragma
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    SQLModel.metadata.create_all(engine)
    with engine.begin() as conn:
        for sql in AUDIT_TRIGGERS:
            conn.execute(text(sql))
    return engine


# ---------------------------------------------------------------- the hash chain
def entry_hash(seq: int, ts: str, actor: str, action: str, object_type: str, object_ref: str, payload: str,
               prev_hash: str) -> str:
    blob = canonical({"seq": seq, "ts": ts, "actor": actor, "action": action, "object_type": object_type,
                      "object_ref": object_ref, "payload": payload, "prev_hash": prev_hash})
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def append_audit(session: Session, actor: str, action: str, object_type: str, object_ref: str,
                 payload: dict[str, Any] | None = None, now: datetime | None = None) -> AuditRow:
    last = session.exec(select(AuditRow).order_by(AuditRow.seq.desc()).limit(1)).first()  # type: ignore[union-attr]
    seq = (last.seq or 0) + 1 if last else 1
    prev = last.hash if last else GENESIS
    ts = (now or utcnow()).isoformat()
    body = canonical(payload or {})
    row = AuditRow(seq=seq, ts=ts, actor=actor, action=action, object_type=object_type, object_ref=object_ref,
                   payload=body, prev_hash=prev,
                   hash=entry_hash(seq, ts, actor, action, object_type, object_ref, body, prev))
    session.add(row)
    session.flush()
    return row


def verify_chain(rows: list[AuditRow]) -> tuple[bool, int | None, str]:
    """Recompute the chain. Returns (ok, first bad seq, reason)."""
    prev = GENESIS
    expected_seq = 1
    for r in rows:
        if r.seq != expected_seq:
            return False, r.seq, f"entry {expected_seq} is missing (found {r.seq})"
        if r.prev_hash != prev:
            return False, r.seq, f"entry {r.seq} does not link to the entry before it"
        h = entry_hash(r.seq or 0, r.ts, r.actor, r.action, r.object_type, r.object_ref, r.payload, r.prev_hash)
        if h != r.hash:
            return False, r.seq, f"entry {r.seq} was altered after it was written"
        prev = r.hash
        expected_seq += 1
    return True, None, "the chain is intact"
