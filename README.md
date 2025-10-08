# GenBio AIDO

Lightweight, fast, and opinionated **chat + data** workbench. Upload a CSV, query it in plain English, and get back **tables**, **plots**, or a short **report**. Every step is tracked in a per-session **DAG** so you can see lineage and switch context easily.

---

## Overview

- **Ingestion**: CSV files are uploaded via the UI and stored as **Parquet** artifacts on disk. DuckDB reads Parquet directly (zero ETL).
- **Compute**: A **DuckDB** connection executes SQL; results are materialized as Parquet artifacts (for preview + lineage).
- **Visualization**: Plots rendered server-side with **matplotlib** (dark theme) and returned as PNG artifacts.
- **LLM Planning**: Natural-language requests are routed to one of:
  - `sql` → build a table via SELECT-only SQL,
  - `plot` → generate a chart (bar/line/scatter on two variables),
  - `answer` → descriptive text,
  - `report` → concise HTML summary card.
- **Sessions & DAG**: Each session is a linear or branching chain of nodes:
  - Upload → SQL → Plot/Report …
  - Nodes reference parent nodes and primary artifacts for lineage.

> **Why DuckDB + Parquet?**  
> It’s fast, file-native, and keeps the architecture simple: no external database server to manage.

---

## User Flow

1. **Upload a CSV** (one CSV per session).  
2. Ask a question:  
   - “Total revenue by region” → **SQL** result table.  
   - “Bar chart of revenue by region” → **Plot**.  
   - “Explain this dataset” → **Answer**.  
   - “Executive summary report” → **Report** (HTML card).
3. The UI shows your assistant message (“Here’s your table/graph/report.”) followed by a **card**:
   - **NiceTable**: sticky header, horizontal scroll when wide, CSV download.
   - **Plot Card**: title, download button, artifact footer.
   - **NiceReport**: themed card, metrics “pills,” clean typography.
4. The **DAG** (left panel) updates to reflect each step. You can click nodes to switch context.

---

## Architecture

### Frontend
- **React + Vite** single-page app served by **nginx**.
- Components:
  - `NiceTable` — standardized width, scroll for many columns, CSV download.
  - `NiceReport` — styled like NiceTable, HTML subset only (`h2/h3/p/ul/li/pre/code`), metrics grid.
  - Plot card — mirrors NiceTable styling, with download + artifact footer.
  - `HistoryDag` — renders session lineage; selecting a node checks out that context.
- Session state initially used **localStorage (namespaced per user)** to iterate quickly; backend persists artifacts, nodes, and metadata.

### Backend
- **FastAPI** app in Docker.
- **DuckDB** in-process for SQL and Parquet I/O.
- **SQLite** (file) for metadata:
  - `artifacts` (id, kind, format, uri, bytes, rows, cols)
  - `nodes` (node id, op type, params JSON, parent edges, primary artifact)
  - `sessions` (id, title, created_at, updated_at)
- Plotting with **matplotlib** (Agg/headless) using a dark theme (axes off or subtle grid depending on kind).
- **LLM** (OpenAI) is only a **planner**:
  - Very strict routing:
    - Anything “table / drop / filter / group / select / sort / join” ⇒ **SQL**
    - Only “report/executive summary” ⇒ **Report**
    - Only explicit “chart/plot/bar/line/scatter” ⇒ **Plot**
    - “Explain/describe/what…” ⇒ **Answer**
  - Validates plans and degrades gracefully (friendly error messages).

---

## Design Choices (User Interaction)

- **Familiar chat** but output is **card-first**: “Here’s your table/graph/report.” + a consistent card UI.
- **Standardized content width** so text and cards line up; tables with many columns scroll horizontally without collapsing other content.
- **DAG-first mental model**: every step is explicit and reproducible. You can switch to any node to continue exploration from there.
- **Downloads**: tables export to CSV; plots export PNG.

---

## Current Limitations

- **SQL**: only **SELECT** queries are allowed (no DDL/DML).  
- **Plots**: only **bar**, **line**, **scatter**; exactly **two variables** (`x`, `y`).  
- **One CSV per session** (simple, clear lineage).  
- **Report**: concise HTML subset; no embedded images/charts (yet).
- **Auth**: cookie-based session label only; no SSO (Okta/IAM) in this POC.
- **Clipboard**: “Copy CSV” requires HTTPS or `localhost` (browser security). On plain HTTP deployments the Copy button is hidden/disabled to avoid confusion.

---

## Getting Started

### Prerequisites
- Docker & docker-compose
- OpenAI API key (for planning)

### Environment
Backend respects:
- `META_DB=/data/meta.sqlite` — SQLite path
- `AIDO_ARTIFACT_DIR=/artifacts` — Parquet/PNG store
- `OPENAI_API_KEY=<your key>`
- `OPENAI_MODEL=gpt-4o-mini` (default)
- (optional) `TMP_DIR` for transient files

Frontend:
- `VITE_API_BASE_URL=/api` (set at build time)

### Build & Run

```bash
# from repo root
docker compose up --build -d
# open http://localhost
```

**Common ops**

```bash
# view logs
docker compose logs -f backend
docker compose logs -f frontend

# pull latest changes and rebuild
git pull
docker compose down
docker compose up --build -d
```

Volumes keep `/data` (SQLite) and `/artifacts` persisted across restarts.

---

## API (high level)

- `POST /v1/ask` → LLM planning + dispatch  
  - returns `{ intent: {type}, result: {...} }`  
- Internals called by `ask`:
  - `run_sql` → executes SELECT on DuckDB, writes Parquet artifact, returns preview + schema.
  - `plot_from_artifact` → renders PNG from seed artifact and parameters.

> The UI talks to `/v1/ask` almost exclusively; SQL/plot endpoints are wrapped server-side for lineage and consistent artifacts.

---

## Further Expansion

This is purposely a **POC optimized for iteration**:

- **State**: localStorage (namespaced) was used initially for session UI state to ship fast; DAG/artifacts/nodes are in SQL.  
  - Next step: **fully server-backed sessions** and deletion/retention policies.
- **Auth**: move from cookie label to real **SSO** (Okta/IAM) with JWT session management.
- **HTTPS by default** using a reverse proxy + automatic certs; then enable **Copy** everywhere.
- **Richer plots** (facets, color encoding, small multiples) and **more chart types**.
- **More SQL** (joins across multiple artifacts, views, parameterized filters with safe guards).
- **Scheduling** or “save as dashboard” from the DAG.
- **Model-free mode** (skip LLM) for power users; or a hybrid “suggested SQL” experience.

---

## Development Notes

- Keep UI cards visually consistent (table/report/plot) to reduce cognitive load.
- The LLM is a **planner**, not an executor. All heavy lifting happens in DuckDB/matplotlib with strict validation.
- Friendly error surfacing: backend normalizes exceptions into readable messages so the chat never shows stack traces.

---

## Contributing

PRs welcome for:
- New card types
- Plot presets
- Server-backed session store
- Auth/SSO integration
- DAG UX improvements
