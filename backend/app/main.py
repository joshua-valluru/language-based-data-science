from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.ingest import router as ingest_router
from app.api.query_sql import router as sql_router
from app.api.plot import router as plot_router
from app.api.ask import router as ask_router
from app.api.history import router as history_router
from app.api.checkout import router as checkout_router
from app.api.artifacts import router as artifacts_router
from app.api.auth import router as auth_router

app = FastAPI(title="AIDO Backend", version="0.1.0")

@app.get("/health")
def health(): return {"status": "ok"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest_router)
app.include_router(sql_router)
app.include_router(plot_router)
app.include_router(ask_router)
app.include_router(history_router)
app.include_router(checkout_router)
app.include_router(artifacts_router)
app.include_router(auth_router)
