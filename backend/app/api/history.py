from fastapi import APIRouter, HTTPException
import json
from app.core.schemas import HistoryResponse, HistoryItem
from app.infra.meta import list_history

router = APIRouter(prefix="/v1", tags=["history"])

@router.get("/history", response_model=HistoryResponse)
def get_history(session_id: str, limit: int = 50):
    if limit <= 0 or limit > 500:
        raise HTTPException(status_code=400, detail="limit must be 1..500")
    rows = list_history(session_id=session_id, limit=limit)
    items = []
    for n in rows:
        parents = json.loads(n.parent_node_ids or "[]")
        items.append(HistoryItem(
            node_id=n.node_id,
            op_type=n.op_type,
            created_at=n.created_at,
            parent_node_ids=parents,
            primary_artifact_id=n.primary_artifact_id
        ))
    return HistoryResponse(session_id=session_id, items=items)
