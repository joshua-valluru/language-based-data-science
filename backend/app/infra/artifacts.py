import hashlib
from pathlib import Path
from typing import Tuple
from app.core.config import settings

CHUNK = 1 << 20

class ArtifactStore:
    def __init__(self, root: Path | None = None):
        self.root = (root or settings.ARTIFACTS_DIR).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _hash_file(self, path: Path) -> str:
        h = hashlib.sha256()
        with path.open("rb") as f:
            while b := f.read(CHUNK):
                h.update(b)
        return h.hexdigest()

    def _dst_for(self, digest: str, suffix: str) -> Path:
        return self.root / digest[:2] / digest[2:4] / f"{digest}.{suffix}"

    def store_parquet(self, temp_parquet: Path) -> Tuple[str, Path]:
        digest = self._hash_file(temp_parquet)
        dst = self._dst_for(digest, "parquet")
        dst.parent.mkdir(parents=True, exist_ok=True)
        if not dst.exists():
            temp_parquet.replace(dst)
        else:
            temp_parquet.unlink(missing_ok=True)
        return digest, dst

    def store_file(self, temp_path: Path, ext: str) -> tuple[str, Path]:
        """Content-addressed move for any file type (e.g., png)."""
        digest = self._hash_file(temp_path)
        dst = self._dst_for(digest, ext)
        dst.parent.mkdir(parents=True, exist_ok=True)
        if not dst.exists():
            temp_path.replace(dst)
        else:
            temp_path.unlink(missing_ok=True)
        return digest, dst
