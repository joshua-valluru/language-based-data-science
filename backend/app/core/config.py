import os
from pathlib import Path
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

class Settings(BaseModel):
    DATA_DIR: Path = Path(os.getenv("DATA_DIR", "./data")).resolve()
    ARTIFACTS_DIR: Path = Path(os.getenv("ARTIFACTS_DIR", "./data/artifacts")).resolve()
    META_DB: Path = Path(os.getenv("META_DB", "./data/meta/meta.db")).resolve()
    TMP_DIR: Path = Path(os.getenv("TMP_DIR", "") or (Path(os.getenv("DATA_DIR", "./data")) / "tmp")).resolve()

settings = Settings()
settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
settings.ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
settings.META_DB.parent.mkdir(parents=True, exist_ok=True)
settings.TMP_DIR.mkdir(parents=True, exist_ok=True)
