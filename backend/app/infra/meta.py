# app/infra/meta.py
import json, time, hashlib
from typing import List, Optional
from sqlmodel import SQLModel, Field, create_engine, Session, select
from sqlalchemy.exc import IntegrityError
from app.core.config import settings

class SessionRow(SQLModel, table=True):
    session_id: str = Field(primary_key=True, index=True)
    head_node_id: str | None = None
    updated_at: int = 0

class Artifact(SQLModel, table=True):
    artifact_id: str = Field(primary_key=True, index=True)
    kind: str
    format: str
    uri: str
    bytes: int
    rows: int
    cols: int
    created_at: int
    session_id: str

class Node(SQLModel, table=True):
    node_id: str = Field(primary_key=True, index=True)
    op_type: str
    op_params: str          # JSON
    parent_node_ids: str    # JSON array
    primary_artifact_id: Optional[str] = None
    created_at: int
    session_id: str

engine = create_engine(f"sqlite:///{settings.META_DB}")
SQLModel.metadata.create_all(engine)

# ---------------- helpers ----------------

def _normalize_parents(parents: list[str]) -> list[str]:
    # stable, unique, sorted
    return sorted({p for p in (parents or []) if p})

def _normalize_op_params(op_params: dict) -> dict:
    # ensure dict, no None; keep JSON-serializable, stable key order via dumps(sort_keys=True)
    return op_params or {}

def _hash_node(session_id: str, parents: list[str], op_type: str, op_params: dict) -> str:
    """
    Include session_id so identical operations in different sessions do not collide.
    """
    payload = {
        "s": session_id,
        "p": _normalize_parents(parents),
        "t": op_type,
        "o": _normalize_op_params(op_params),
    }
    s = json.dumps(payload, separators=(",", ":"), sort_keys=True, default=str)
    return hashlib.sha256(s.encode()).hexdigest()

# ---------------- history & head ----------------

def list_history(session_id: str, limit: int = 50) -> List["Node"]:
    with Session(engine) as db:
        stmt = (
            select(Node)
            .where(Node.session_id == session_id)
            .order_by(Node.created_at.desc())
            .limit(limit)
        )
        return list(db.exec(stmt).all())

def set_session_head(session_id: str, node_id: str) -> SessionRow:
    with Session(engine) as db:
        row = db.get(SessionRow, session_id)
        now = int(time.time())
        if not row:
            row = SessionRow(session_id=session_id, head_node_id=node_id, updated_at=now)
        else:
            row.head_node_id = node_id
            row.updated_at = now
        db.add(row)
        db.commit()
        db.refresh(row)
        return row

def get_session_head(session_id: str) -> str | None:
    with Session(engine) as db:
        row = db.get(SessionRow, session_id)
        return row.head_node_id if row else None

# ---------------- inserts (idempotent) ----------------

def insert_artifact(
    *,
    artifact_id: str,
    session_id: str,
    kind: str,
    format: str,
    uri: str,
    bytes_: int,
    rows: int,
    cols: int,
) -> Artifact:
    """
    Idempotent insert: if artifact_id already exists, return the existing row.
    """
    now = int(time.time())
    with Session(engine) as db:
        try:
            row = Artifact(
                artifact_id=artifact_id,
                kind=kind,
                format=format,
                uri=uri,
                bytes=bytes_,
                rows=rows,
                cols=cols,
                created_at=now,
                session_id=session_id,
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            return row
        except IntegrityError:
            db.rollback()
            # Return existing artifact
            existing = db.get(Artifact, artifact_id)
            if existing:
                return existing
            # Extremely unlikely race: try again
            raise

def insert_node(
    *,
    session_id: str,
    op_type: str,
    op_params: dict,
    parent_node_ids: list[str],
    primary_artifact_id: Optional[str],
) -> Node:
    """
    Node ID is a hash of (session_id, parents, op_type, op_params) so the same
    operation in different sessions yields different node_ids.

    Also idempotent: if the PK exists, return the existing node.
    """
    parents_norm = _normalize_parents(parent_node_ids or [])
    params_norm = _normalize_op_params(op_params or {})
    nid = _hash_node(session_id, parents_norm, op_type, params_norm)
    now = int(time.time())

    with Session(engine) as db:
        try:
            row = Node(
                node_id=nid,
                op_type=op_type,
                op_params=json.dumps(params_norm, separators=(",", ":"), sort_keys=True, default=str),
                parent_node_ids=json.dumps(parents_norm, separators=(",", ":"), sort_keys=True),
                primary_artifact_id=primary_artifact_id,
                created_at=now,
                session_id=session_id,
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            return row
        except IntegrityError:
            db.rollback()
            # Return existing node
            existing = db.get(Node, nid)
            if existing:
                return existing
            # Extremely unlikely race: try again
            raise

# ---------------- lookups ----------------

def get_node_by_artifact(artifact_id: str) -> Optional[Node]:
    with Session(engine) as db:
        stmt = select(Node).where(Node.primary_artifact_id == artifact_id)
        return db.exec(stmt).first()
