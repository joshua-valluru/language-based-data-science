# app/infra/meta.py
import json, time, hashlib
from typing import List, Optional
from sqlmodel import SQLModel, Field, create_engine, Session, select
from sqlalchemy.exc import IntegrityError  # sqlmodel depends on sqlalchemy
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
    session_id: str  # creator session (artifacts can still be shared globally)

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

# --- history & head helpers ---

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

# IMPORTANT: include session in the node hash to avoid cross-session collisions
def _hash_node(session_id: str, parents: list[str], op_type: str, op_params: dict) -> str:
    payload = {"s": session_id, "p": sorted(parents), "t": op_type, "o": op_params}
    s = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(s.encode()).hexdigest()

def insert_artifact(
    *, artifact_id: str, session_id: str, kind: str, format: str, uri: str,
    bytes_: int, rows: int, cols: int
) -> Artifact:
    with Session(engine) as db:
        existing = db.get(Artifact, artifact_id)
        if existing:
            # keep the original row (artifacts are global by content hash)
            return existing
        row = Artifact(
            artifact_id=artifact_id,
            kind=kind, format=format, uri=uri, bytes=bytes_,
            rows=rows, cols=cols, created_at=int(time.time()), session_id=session_id
        )
        db.add(row); db.commit(); db.refresh(row)
        return row

def insert_node(
    *, session_id: str, op_type: str, op_params: dict,
    parent_node_ids: list[str], primary_artifact_id: Optional[str]
) -> Node:
    nid = _hash_node(session_id, parent_node_ids, op_type, op_params)
    row = Node(
        node_id=nid, op_type=op_type,
        op_params=json.dumps(op_params, separators=(",", ":")),
        parent_node_ids=json.dumps(parent_node_ids),
        primary_artifact_id=primary_artifact_id,
        created_at=int(time.time()), session_id=session_id
    )
    with Session(engine) as db:
        try:
            db.add(row); db.commit(); db.refresh(row)
        except IntegrityError:
            db.rollback()
            # idempotent within the same session/op graph
            row = db.get(Node, nid)
        return row

# Scope parent lookup by session to prevent cross-session edges
def get_node_by_artifact(artifact_id: str, session_id: str) -> Optional[Node]:
    with Session(engine) as db:
        stmt = select(Node).where(
            Node.primary_artifact_id == artifact_id,
            Node.session_id == session_id
        )
        return db.exec(stmt).first()
