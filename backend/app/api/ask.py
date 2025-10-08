from fastapi import APIRouter, HTTPException
from pathlib import Path
from typing import Tuple
from sqlmodel import Session as DBSession
import logging

from app.core.schemas import AskRequest, AskResponse, SQLRequest, PlotRequest
from app.infra.llm import LLMService
from app.infra.duck import connect_db
from app.infra.meta import engine, Artifact as ArtifactRow
from app.api.query_sql import run_sql
from app.api.plot import plot_from_artifact
from app.infra.profile import compute_profile_summary  # profiling context

router = APIRouter(prefix="/v1", tags=["ask"])
llm = LLMService()  # uses OPENAI_API_KEY / OPENAI_MODEL from env
logger = logging.getLogger("aido.ask")  # add a dedicated logger


def _columns_and_path(artifact_id: str) -> Tuple[list[dict], Path]:
  with DBSession(engine) as db:
    seed_art = db.get(ArtifactRow, artifact_id)
    if not seed_art:
      raise HTTPException(status_code=404, detail="artifact_id not found")
    parquet_path = Path(seed_art.uri)
  with connect_db() as con:
    df0 = con.execute(f"SELECT * FROM parquet_scan('{parquet_path.as_posix()}') LIMIT 0;").fetchdf()
  cols = [{"name": str(c), "dtype": str(dt)} for c, dt in zip(df0.columns, df0.dtypes)]
  return cols, parquet_path


def _basic_context(artifact_id: str, parquet_path: Path) -> dict:
  duck_uri = parquet_path.as_posix().replace("'", "''")
  with connect_db() as con:
    rows = int(con.execute(f"SELECT COUNT(*) FROM parquet_scan('{duck_uri}');").fetchone()[0])
    preview = con.execute(f"SELECT * FROM parquet_scan('{duck_uri}') LIMIT 8;").fetchdf().to_dict("records")
  profile = compute_profile_summary(artifact_id)
  return {"rows": rows, "preview": preview, "profile": profile}


@router.post("/ask", response_model=AskResponse)
def ask(req: AskRequest):
  # 1) discover columns and parquet path
  columns, parquet_path = _columns_and_path(req.artifact_id)

  # 2) build compact context (rows/preview/profile) for descriptive answers
  try:
    context = _basic_context(req.artifact_id, parquet_path)
  except Exception:
    context = {"rows": None, "preview": [], "profile": {}}

  # 3) get a strict JSON plan from the LLM (may return "answer"|"sql"|"plot"|"report")
  try:
    plan = llm.plan(req.message, columns, context=context)
  except Exception as e:
    logger.exception("LLM planning failed")
    # Friendly + concise message to users, full stacktrace in logs
    raise HTTPException(status_code=400, detail="I couldn't understand that request yet. Please try rephrasing.")

  t = plan.get("type")

  # 4) dispatch — wrap each branch so we never leak a 500
  try:
    if t == "answer":
      text = (plan.get("text") or "").strip() or "Here’s a quick description of the data."
      return AskResponse(intent={"type": "answer"}, result={"text": text})

    if t == "sql":
      sql = plan.get("sql")
      if not sql:
        raise HTTPException(status_code=400, detail="I couldn't generate a query for that yet. Try another phrasing.")
      try:
        # forward current node id so lineage is explicit
        result = run_sql(SQLRequest(
          session_id=req.session_id,
          artifact_id=req.artifact_id,
          sql=sql,
          parent_node_id=getattr(req, "parent_node_id", None)
        ))
      except Exception:
        logger.exception("SQL execution failed")
        raise HTTPException(
          status_code=400,
          detail="I couldn't run that query yet. Please try a simpler request or different columns."
        )
      return AskResponse(intent=plan, result=result.model_dump())

    if t == "report":
      title = (plan.get("title") or "Report").strip()
      html = (plan.get("html") or "<p>No content.</p>").strip()
      return AskResponse(
        intent={"type": "report"},
        result={
          "title": title,
          "html": html,
          "artifact": {"artifact_id": req.artifact_id}
        },
      )

    if t == "plot":
      spec = plan.get("plot") or {}
      kind, x, y = spec.get("kind"), spec.get("x"), spec.get("y")

      seed_cols = {c["name"] for c in columns}
      if x not in seed_cols or y not in seed_cols:
        raise HTTPException(
          status_code=400,
          detail=f"Those columns aren’t available for plotting (x={x}, y={y}). Try running a table step first."
        )
      try:
        result = plot_from_artifact(PlotRequest(
          session_id=req.session_id,
          artifact_id=req.artifact_id,
          kind=kind, x=x, y=y,
          parent_node_id=getattr(req, "parent_node_id", None)
        ))
      except Exception:
        logger.exception("Plot creation failed")
        raise HTTPException(
          status_code=400,
          detail="I couldn't create that chart yet. Try another chart type or columns."
        )
      return AskResponse(intent=plan, result=result.model_dump())

    # Unknown plan type
    raise HTTPException(
      status_code=400,
      detail="That operation isn’t supported yet. Try asking for a table, chart, or a summary."
    )

  except HTTPException:
    # forward friendly errors as-is
    raise
  except Exception:
    # final safety net — never leak a 500
    logger.exception("Unhandled error in /ask")
    raise HTTPException(
      status_code=400,
      detail="Something went wrong processing your request. Please try again."
    )
