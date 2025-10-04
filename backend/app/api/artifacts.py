from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path
from sqlmodel import Session as DBSession
from app.infra.meta import engine, Artifact as ArtifactRow
from app.core.config import settings

router = APIRouter(prefix="/v1", tags=["artifacts"])

def _safe_under(root: Path, path: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except Exception:
        return False

@router.get("/artifacts/{artifact_id}")
def fetch_artifact(artifact_id: str):
    # lookup file path by artifact_id
    with DBSession(engine) as db:
        art = db.get(ArtifactRow, artifact_id)
        if not art:
            raise HTTPException(status_code=404, detail="artifact not found")
        p = Path(art.uri)

    # basic safety: ensure file lives under ARTIFACTS_DIR
    if not _safe_under(settings.ARTIFACTS_DIR, p):
        raise HTTPException(status_code=403, detail="forbidden path")

    if not p.exists():
        raise HTTPException(status_code=404, detail="file missing on disk")

    ext = p.suffix.lower()
    media = (
        "image/png" if ext == ".png"
        else "application/octet-stream"
    )
    # inline for images; attachment for everything else is fine too
    return FileResponse(p, media_type=media, filename=p.name)
