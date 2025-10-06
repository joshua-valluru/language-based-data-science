from fastapi import APIRouter, HTTPException
from pathlib import Path
from uuid import uuid4
import matplotlib as mpl
mpl.use("Agg")  # headless
import matplotlib.pyplot as plt
import duckdb
import pandas as pd
from sqlmodel import Session as DBSession

from app.core.config import settings
from app.core.schemas import PlotRequest, PlotResponse, ArtifactOut, NodeOut
from app.infra.artifacts import ArtifactStore
from app.infra.meta import (
    insert_artifact, insert_node, get_node_by_artifact,
    engine, Artifact as ArtifactRow
)

router = APIRouter(prefix="/v1", tags=["plot"])
art = ArtifactStore()

# ---- AIDO dark theme palette (kept subtle to match your UI) ----
DARK_BG  = "#0b1014"   # page background
PANEL_BG = "#10161b"   # card/panel background
FG       = "#E6EEF9"   # primary text
MUTED    = "#B8C2D9"   # tick/secondary text
GRID     = "#2b3844"   # grid/spine
ACCENT   = "#1bd8a0"   # brand accent
EDGE     = "#23303b"   # bar/marker edges

# Global defaults (safe for headless)
mpl.rcParams.update({
    "figure.facecolor": DARK_BG,
    "savefig.facecolor": DARK_BG,
    "axes.facecolor": PANEL_BG,
    "axes.edgecolor": GRID,
    "axes.labelcolor": FG,
    "text.color": FG,
    "xtick.color": MUTED,
    "ytick.color": MUTED,
    "axes.grid": False,
    "grid.color": GRID,
    "grid.linewidth": 0.8,
    "grid.alpha": 0.5,
    "legend.frameon": False,
})

def style_ax(ax):
    """Apply AIDO dark style to an axes."""
    # Panel/background cohesion
    ax.set_facecolor(PANEL_BG)
    ax.figure.set_facecolor(DARK_BG)

    # Clean spines
    for spine in ax.spines.values():
        spine.set_color(GRID)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    # Ticks/text sizes & color already covered by rcParams, just ensure readable
    ax.tick_params(labelsize=10)
    ax.title.set_fontweight("bold")

@router.post("/plot", response_model=PlotResponse)
def plot_from_artifact(req: PlotRequest):
    # 1) resolve parquet path for the table artifact
    with DBSession(engine) as db:
        seed_art = db.get(ArtifactRow, req.artifact_id)
        if not seed_art:
            raise HTTPException(status_code=404, detail="artifact_id not found")
        parquet_path = Path(seed_art.uri)

    # 2) load to pandas (via DuckDB) and basic validation
    with duckdb.connect(database=":memory:") as con:
        df = con.execute(f"SELECT * FROM parquet_scan('{parquet_path.as_posix()}')").fetchdf()

    if req.x not in df.columns or req.y not in df.columns:
        raise HTTPException(status_code=400, detail=f"Columns not found: x={req.x}, y={req.y}")

    x = req.x; y = req.y

    # 3) minimal plotting logic

    # choose a friendly title
    if req.kind == "bar":
        plot_title = f"{y} by {x}"
    else:
        plot_title = f"{y} vs {x}"

    fig = plt.figure(figsize=(8, 4.6), dpi=144)
    ax = fig.add_subplot(111)

    if req.kind == "bar":
        # if multiple rows per x, aggregate sum(y)
        agg = df.groupby(x, dropna=False)[y].sum().reset_index()
        ax.bar(agg[x].astype(str), agg[y])
        ax.set_xlabel(x); ax.set_ylabel(y); ax.set_title(f"{y} by {x}")
    elif req.kind == "line":
        # try sorting by x
        try:
            s = pd.to_datetime(df[x])
            df_sorted = df.assign(_x=s).sort_values("_x")
            ax.plot(df_sorted[x], df_sorted[y])
        except Exception:
            df_sorted = df.sort_values(x)
            ax.plot(df_sorted[x].astype(str), df_sorted[y])
        ax.set_xlabel(x); ax.set_ylabel(y); ax.set_title(f"{y} vs {x}")
    else:  # scatter
        ax.scatter(df[x], df[y])
        ax.set_xlabel(x); ax.set_ylabel(y); ax.set_title(f"{y} vs {x}")

    ax.set_title(plot_title)
    fig.tight_layout()

    # 4) write PNG to temp, move into artifact store
    tmp_png = (settings.TMP_DIR / f"{uuid4().hex}.png").resolve()
    fig.savefig(tmp_png)  # default DPI is fine
    plt.close(fig)

    digest, final_png = art.store_file(tmp_png, "png")

    # 5) persist artifact + node
    a = insert_artifact(
        artifact_id=digest,
        session_id=req.session_id,
        kind="plot",
        format="png",
        uri=final_png.as_posix(),
        bytes_=final_png.stat().st_size,
        rows=0, cols=0,
    )
    parent = get_node_by_artifact(req.artifact_id)
    parent_id = parent.node_id if parent else None
    n = insert_node(
        session_id=req.session_id,
        op_type="plot",
        op_params={"kind": req.kind, "x": x, "y": y, "source_artifact": req.artifact_id},
        parent_node_ids=[parent_id] if parent_id else [],
        primary_artifact_id=a.artifact_id,
    )

    return PlotResponse(
        session_id=req.session_id,
        parent_node_id=parent_id,
        node=NodeOut(
            node_id=n.node_id, op_type=n.op_type,
            parent_node_ids=[parent_id] if parent_id else [],
            primary_artifact_id=a.artifact_id
        ),
        artifact=ArtifactOut(
            artifact_id=a.artifact_id, kind=a.kind, format=a.format, uri=a.uri,
            bytes=a.bytes, rows=a.rows, cols=a.cols
        ),
        title=plot_title,
    )
