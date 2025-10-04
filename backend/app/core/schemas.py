from typing import Any, List, Optional
from pydantic import BaseModel, Field

class ColumnSchema(BaseModel):
    name: str
    dtype: str

class ArtifactOut(BaseModel):
    artifact_id: str
    kind: str
    format: str
    uri: str
    bytes: int
    rows: int
    cols: int

class NodeOut(BaseModel):
    node_id: str
    op_type: str
    parent_node_ids: list[str] = []
    primary_artifact_id: Optional[str] = None

class UploadResponse(BaseModel):
    session_id: str
    node: NodeOut
    artifact: ArtifactOut
    columns: List[ColumnSchema]
    preview: list[dict]

class SQLRequest(BaseModel):
    session_id: str
    artifact_id: str        # seed table to query
    sql: str                # user/LLM SQL; should reference view name 'seed'

class SQLResponse(BaseModel):
    session_id: str
    parent_node_id: str
    node: NodeOut
    artifact: ArtifactOut
    columns: List[ColumnSchema]
    preview: list[dict]

class PlotRequest(BaseModel):
    session_id: str
    artifact_id: str           # table artifact to plot
    kind: str = Field(pattern="^(bar|line|scatter)$")
    x: str
    y: str

class PlotResponse(BaseModel):
    session_id: str
    parent_node_id: str | None = None
    node: NodeOut
    artifact: ArtifactOut

class AskRequest(BaseModel):
    session_id: str
    artifact_id: str
    message: str

class AskResponse(BaseModel):
    intent: dict  # the JSON plan produced by the LLM (or heuristic)
    result: Any   # the response from /v1/sql or /v1/plot (we keep it untyped for MVP)

class HistoryItem(BaseModel):
    node_id: str
    op_type: str
    created_at: int
    parent_node_ids: List[str]
    primary_artifact_id: Optional[str] = None

class HistoryResponse(BaseModel):
    session_id: str
    items: List[HistoryItem]

class CheckoutRequest(BaseModel):
    session_id: str
    node_id: str

class CheckoutResponse(BaseModel):
    session_id: str
    head_node_id: str
