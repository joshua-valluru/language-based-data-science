# app/infra/profile.py
from __future__ import annotations
from pathlib import Path
from typing import Any, Dict, List
import math

from app.infra.duck import connect_db
from sqlmodel import Session as DBSession
from app.infra.meta import engine, Artifact as ArtifactRow


def _artifact_uri(artifact_id: str) -> Path:
    with DBSession(engine) as db:
        art = db.get(ArtifactRow, artifact_id)
        if not art:
            raise ValueError("artifact_id not found")
        p = Path(art.uri)
        if not p.exists():
            raise FileNotFoundError(p)
        return p


def compute_profile_summary(artifact_id: str, top_k: int = 10) -> Dict[str, Any]:
    """
    Small, fast profile for the current TABLE (parquet) artifact:
    - rows, columns (name + dtype)
    - per-column missing + distinct
    - numeric: min, max, mean, stddev_samp, p25/p50/p75, IQR, Tukey outlier_count
    - categorical: top-k counts + distinct
    """
    parquet_path = _artifact_uri(artifact_id)
    duck_uri = parquet_path.as_posix().replace("'", "''")
    out: Dict[str, Any] = {"artifact_id": artifact_id}

    with connect_db() as con:
        # schema & rows
        df0 = con.execute(f"SELECT * FROM parquet_scan('{duck_uri}') LIMIT 0;").fetchdf()
        col_names = [str(c) for c in df0.columns]
        dtypes = [str(dt) for dt in df0.dtypes]
        out["columns"] = [{"name": n, "dtype": t} for n, t in zip(col_names, dtypes)]
        rows = int(con.execute(f"SELECT COUNT(*) FROM parquet_scan('{duck_uri}');").fetchone()[0])
        out["rows"] = rows

        # missing & distinct
        missing, distinct = {}, {}
        for c in col_names:
            c_esc = c.replace('"', '""')
            notnull = int(con.execute(
                f'SELECT COUNT("{c_esc}") FROM parquet_scan(\'{duck_uri}\');'
            ).fetchone()[0])
            missing[c] = rows - notnull
            dcnt = int(con.execute(
                f'SELECT COUNT(DISTINCT "{c_esc}") FROM parquet_scan(\'{duck_uri}\');'
            ).fetchone()[0])
            distinct[c] = dcnt
        out["missing"] = missing
        out["distinct"] = distinct

        # classify
        numeric_cols: List[str] = []
        categorical_cols: List[str] = []
        for name, dt in zip(col_names, dtypes):
            s = dt.lower()
            if any(k in s for k in ["int", "double", "float", "decimal"]):
                numeric_cols.append(name)
            else:
                categorical_cols.append(name)

        # numeric stats
        numeric: Dict[str, Any] = {}
        for c in numeric_cols:
            c_esc = c.replace('"', '""')
            mn, mx, mean, std, p25, p50, p75 = con.execute(
                f"""
                SELECT
                  MIN("{c_esc}"), MAX("{c_esc}"),
                  AVG("{c_esc}"),
                  STDDEV_SAMP("{c_esc}"),
                  QUANTILE_CONT("{c_esc}", 0.25),
                  QUANTILE_CONT("{c_esc}", 0.50),
                  QUANTILE_CONT("{c_esc}", 0.75)
                FROM parquet_scan('{duck_uri}');
                """
            ).fetchone()
            std = None if (std is None or (isinstance(std, float) and math.isnan(std))) else std
            if p25 is not None and p75 is not None:
                iqr = float(p75) - float(p25)
                lo = float(p25) - 1.5 * iqr
                hi = float(p75) + 1.5 * iqr
                outliers = int(con.execute(
                    f"""
                    SELECT COUNT(*) FROM parquet_scan('{duck_uri}')
                    WHERE "{c_esc}" < {lo} OR "{c_esc}" > {hi};
                    """
                ).fetchone()[0])
            else:
                iqr, lo, hi, outliers = None, None, None, 0

            numeric[c] = {
                "min": mn, "max": mx, "mean": mean, "std": std,
                "p25": p25, "p50": p50, "p75": p75,
                "iqr": iqr, "tukey_low": lo, "tukey_high": hi,
                "outlier_count": outliers,
            }
        out["numeric"] = numeric

        # categorical top-k
        categorical: Dict[str, Any] = {}
        for c in categorical_cols:
            c_esc = c.replace('"', '""')
            top = con.execute(
                f"""
                SELECT "{c_esc}" AS value, COUNT(*) AS c
                FROM parquet_scan('{duck_uri}')
                GROUP BY 1
                ORDER BY c DESC NULLS LAST
                LIMIT {int(top_k)};
                """
            ).fetchdf()
            categorical[c] = {
                "distinct": distinct[c],
                "top": [] if top.empty else [
                    {"value": (None if (isinstance(v, float) and math.isnan(v)) else v), "count": int(cnt)}
                    for v, cnt in zip(top["value"], top["c"])
                ],
            }
        out["categorical"] = categorical

    return out
