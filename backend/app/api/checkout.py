from fastapi import APIRouter, HTTPException
from sqlmodel import Session as DBSession
from app.core.schemas import CheckoutRequest, CheckoutResponse
from app.infra.meta import engine, Node, set_session_head

router = APIRouter(prefix="/v1", tags=["checkout"])

@router.post("/checkout", response_model=CheckoutResponse)
def checkout(req: CheckoutRequest):
    # validate node exists
    with DBSession(engine) as db:
        node = db.get(Node, req.node_id)
        if not node:
            raise HTTPException(status_code=404, detail="node_id not found")

    row = set_session_head(req.session_id, req.node_id)
    return CheckoutResponse(session_id=req.session_id, head_node_id=row.head_node_id)
