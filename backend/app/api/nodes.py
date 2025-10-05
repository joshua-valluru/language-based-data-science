# app/api/nodes.py
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlmodel import Session
import json

from app.infra.meta import engine  # use your existing engine
from app.infra.meta import Node as NodeModel  # the SQLModel from your meta module

router = APIRouter(prefix="/v1/nodes", tags=["nodes"])

class NodeDetailOut(BaseModel):
    node_id: str
    op_type: str
    op_params: dict
    parent_node_ids: list[str]
    primary_artifact_id: str | None = None
    created_at: int
    session_id: str

def _db():
    with Session(engine) as db:
        yield db

@router.get("/{node_id}", response_model=NodeDetailOut)
def get_node(node_id: str, db: Session = Depends(_db)):
    row = db.get(NodeModel, node_id)
    if not row:
        raise HTTPException(status_code=404, detail="Node not found")

    try:
        params = json.loads(row.op_params) if row.op_params else {}
    except Exception:
        params = {}

    try:
        parents = json.loads(row.parent_node_ids) if row.parent_node_ids else []
    except Exception:
        parents = []

    return NodeDetailOut(
        node_id=row.node_id,
        op_type=row.op_type,
        op_params=params,
        parent_node_ids=parents,
        primary_artifact_id=row.primary_artifact_id,
        created_at=row.created_at,
        session_id=row.session_id,
    )
