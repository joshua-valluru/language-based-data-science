# app/api/query_sql.py
from __future__ import annotations

import json
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import APIRouter, HTTPException
from sqlmodel import Session as DBSession, select

from app.core.schemas import SQLRequest, SQLResponse, ColumnSchema, ArtifactOut, NodeOut
from app.core.config import settings
from app.infra.duck import connect_db
from app.infra.meta import (
    engine,
    Artifact as ArtifactRow,
    Node as NodeRow,            # <-- we query nodes to infer parent
    insert_artifact,
    insert_node,
)
from app.infra.artifacts import ArtifactStore

router = APIRouter(prefix="/v1", tags=["sql"])
art = ArtifactStore()


def _seed_parquet_path(artifact_id: str) -> Path:
    with DBSession(engine) as db:
        seed_art = db.get(ArtifactRow, artifact_id)
        if not seed_art:
            raise HTTPException(status_code=404, detail="artifact_id not found")
        p = Path(seed_art.uri)
        if not p.exists():
            raise HTTPException(status_code=404, detail="seed parquet not found on disk")
        return p


def _as_list(value):
    """Coerce possible JSON-string / None / list into a list."""
    if isinstance(value, list):
        return value
    if value is None:
        return []
    if isinstance(value, str):
        try:
            v = value.strip()
            if not v:
                return []
            return json.loads(v)
        except Exception:
            return []
    return []


def _infer_parent_node_id(session_id: str, seed_artifact_id: str) -> str | None:
    """
    If the client didn't provide parent_node_id, infer the parent by finding
    the most recent node in this session that produced the seed artifact.
    """
    with DBSession(engine) as db:
        stmt = (
            select(NodeRow)
            .where(
                NodeRow.session_id == session_id,
                NodeRow.primary_artifact_id == seed_artifact_id,
            )
            .order_by(NodeRow.created_at.desc())
        )
        row = db.exec(stmt).first()
        return row.node_id if row else None


@router.post("/sql", response_model=SQLResponse)
def run_sql(req: SQLRequest) -> SQLResponse:
    # Locate seed parquet
    seed_path = _seed_parquet_path(req.artifact_id)
    duck_uri = seed_path.as_posix().replace("'", "''")

    # Sanitize & validate SQL
    sql_clean = (req.sql or "").strip().rstrip(";")
    if not sql_clean.lower().startswith("select"):
        raise HTTPException(status_code=400, detail="Only SELECT queries are allowed.")

    # Wrapped subqueries so LIMIT / semicolons / CTEs are safe
    wrapped_limit0 = f"SELECT * FROM ({sql_clean}) AS _t LIMIT 0"
    wrapped_preview = f"SELECT * FROM ({sql_clean}) AS _t LIMIT 20"
    wrapped_count = f"SELECT COUNT(*) FROM ({sql_clean}) AS _t"

    # Prepare a temp parquet sink
    temp_parquet = Path(
        NamedTemporaryFile(delete=False, dir=settings.TMP_DIR, suffix=".parquet").name
    )

    with connect_db() as con:
        # Expose the seed view for LLM-generated queries
        con.execute(
            f"CREATE OR REPLACE VIEW seed AS SELECT * FROM parquet_scan('{duck_uri}');"
        )

        # Persist full result to parquet using cleaned SQL
        out_path = temp_parquet.as_posix().replace("'", "''")
        con.execute(f"COPY ({sql_clean}) TO '{out_path}' (FORMAT PARQUET);")

        # Columns / dtypes
        cols_df = con.execute(wrapped_limit0).fetchdf()
        columns = [
            ColumnSchema(name=str(c), dtype=str(dt))
            for c, dt in zip(cols_df.columns, cols_df.dtypes)
        ]

        # Rows
        rows = int(con.execute(wrapped_count).fetchone()[0])

        # Preview
        preview = con.execute(wrapped_preview).fetchdf().to_dict("records")

    # Store artifact content-addressed
    artifact_id, final_parquet = art.store_parquet(temp_parquet)

    # Record artifact + node in meta store
    a = insert_artifact(
        artifact_id=artifact_id,
        session_id=req.session_id,
        kind="table",
        format="parquet",
        uri=final_parquet.as_posix(),
        bytes_=final_parquet.stat().st_size,
        rows=rows,
        cols=len(columns),
    )

    # Determine parent(s)
    explicit_parent = getattr(req, "parent_node_id", None)
    if explicit_parent:
        parent_ids_for_insert = [explicit_parent]
        parent_node_id_str = explicit_parent
    else:
        # Try to infer from the seed artifact's producing node (upload or prior step)
        inferred = _infer_parent_node_id(req.session_id, req.artifact_id)
        if inferred:
            parent_ids_for_insert = [inferred]
            parent_node_id_str = inferred
        else:
            parent_ids_for_insert = []  # no parent; first node in session or orphan
            parent_node_id_str = ""

    n = insert_node(
        session_id=req.session_id,
        op_type="sql",
        op_params={"sql": sql_clean},
        parent_node_ids=parent_ids_for_insert,  # list (never None) to avoid earlier crash
        primary_artifact_id=a.artifact_id,
    )

    return SQLResponse(
        session_id=req.session_id,
        parent_node_id=parent_node_id_str,           # schema expects string
        node=NodeOut(
            node_id=n.node_id,
            op_type=n.op_type,
            parent_node_ids=_as_list(n.parent_node_ids),
            primary_artifact_id=a.artifact_id,
        ),
        artifact=ArtifactOut(
            artifact_id=a.artifact_id,
            kind=a.kind,
            format=a.format,
            uri=a.uri,
            bytes=a.bytes,
            rows=a.rows,
            cols=a.cols,
        ),
        columns=columns,
        preview=preview,
    )
