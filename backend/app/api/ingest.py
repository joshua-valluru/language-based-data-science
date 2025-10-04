from fastapi import APIRouter, UploadFile, File
from pathlib import Path
from tempfile import NamedTemporaryFile
from uuid import uuid4

from app.core.config import settings
from app.core.schemas import UploadResponse, ArtifactOut, NodeOut, ColumnSchema
from app.infra.duck import connect_db
from app.infra.artifacts import ArtifactStore
from app.infra.meta import insert_artifact, insert_node

router = APIRouter(prefix="/v1", tags=["ingest"])
art = ArtifactStore()

@router.post("/upload", response_model=UploadResponse)
async def upload_csv(file: UploadFile = File(...), session_id: str = "demo"):
    # 1) Save CSV to a temp file
    temp_csv = Path(NamedTemporaryFile(delete=False, dir=settings.TMP_DIR, suffix=".csv").name)
    temp_csv.write_bytes(await file.read())

    # 2) Convert CSV -> Parquet via DuckDB (let DuckDB create the file)
    temp_parquet = (settings.TMP_DIR / f"{uuid4().hex}.parquet").resolve()
    with connect_db() as con:
        con.execute(f"CREATE TABLE t AS SELECT * FROM read_csv_auto('{temp_csv.as_posix()}');")
        out_path = temp_parquet.as_posix().replace("'", "''")
        con.execute(f"COPY t TO '{out_path}' (FORMAT PARQUET);")

    # 3) Basic stats + preview from the temp parquet
    with connect_db() as con:
        cols_df = con.execute(f"SELECT * FROM parquet_scan('{temp_parquet.as_posix()}') LIMIT 0;").fetchdf()
        rows = int(con.execute(f"SELECT COUNT(*) FROM parquet_scan('{temp_parquet.as_posix()}');").fetchone()[0])
        preview = con.execute(f"SELECT * FROM parquet_scan('{temp_parquet.as_posix()}') LIMIT 20;").fetchdf().to_dict("records")

    # 4) Move into content-addressed artifact store + persist metadata + node
    digest, final_parquet = art.store_parquet(temp_parquet)
    a = insert_artifact(
        artifact_id=digest,
        session_id=session_id,
        kind="table",
        format="parquet",
        uri=final_parquet.as_posix(),
        bytes_=final_parquet.stat().st_size,
        rows=rows,
        cols=len(cols_df.columns),
    )
    n = insert_node(
        session_id=session_id,
        op_type="upload",
        op_params={"filename": file.filename},
        parent_node_ids=[],
        primary_artifact_id=a.artifact_id,
    )

    schema = [ColumnSchema(name=str(c), dtype=str(dt)) for c, dt in zip(cols_df.columns, cols_df.dtypes)]
    return UploadResponse(
        session_id=session_id,
        node=NodeOut(node_id=n.node_id, op_type=n.op_type, parent_node_ids=[], primary_artifact_id=a.artifact_id),
        artifact=ArtifactOut(artifact_id=a.artifact_id, kind=a.kind, format=a.format, uri=a.uri,
                             bytes=a.bytes, rows=a.rows, cols=a.cols),
        columns=schema,
        preview=preview,
    )
