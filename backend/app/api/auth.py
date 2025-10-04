# app/api/auth.py
from fastapi import APIRouter, HTTPException, Response, Depends, Request
from pydantic import BaseModel, EmailStr
from sqlmodel import Session
from app.infra.meta import engine
from app.infra.users import get_user_by_email, create_user, get_user_by_id
from app.infra.auth import hash_password, verify_password, create_access_token, decode_token

router = APIRouter(prefix="/v1/auth", tags=["auth"])
COOKIE_NAME = "aido_token"

# ---- Schemas ----
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class MeResponse(BaseModel):
    id: str
    email: EmailStr

# ---- DB dep ----
def _db():
    with Session(engine) as db:
        yield db

# ---- Cookie helpers (robust for cross-origin dev) ----
def _set_session_cookie(resp: Response, token: str):
    # For local dev with FE on :5173 and BE on :8000, you need SameSite=None; Secure; credentials: include on fetch.
    resp.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,      # required when SameSite=None (Chrome). Works on localhost.
        samesite="none",  # allow cross-site requests from Vite dev server
        path="/",
        max_age=7 * 24 * 3600,  # 7 days
    )

def _clear_session_cookie(resp: Response):
    resp.delete_cookie(
        key=COOKIE_NAME,
        path="/",
        samesite="none",
    )

def _user_from_cookie(token: str | None, db: Session):
    if not token:
        return None
    data = decode_token(token)
    if not data or "sub" not in data:
        return None
    return get_user_by_id(db, data["sub"])

# ---- Routes ----
@router.post("/register", response_model=MeResponse)
def register(req: RegisterRequest, response: Response, db: Session = Depends(_db)):
    if len(req.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")
    if get_user_by_email(db, req.email):
        raise HTTPException(400, "Email already registered.")
    u = create_user(db, req.email, hash_password(req.password))
    # Auto-login on register
    token = create_access_token(u.id, {"email": u.email})
    _set_session_cookie(response, token)
    return MeResponse(id=u.id, email=u.email)

@router.post("/login", response_model=MeResponse)
def login(req: LoginRequest, response: Response, db: Session = Depends(_db)):
    u = get_user_by_email(db, req.email)
    if not u or not verify_password(req.password, u.password_hash):
        raise HTTPException(401, "Invalid credentials.")
    token = create_access_token(u.id, {"email": u.email})
    _set_session_cookie(response, token)
    return MeResponse(id=u.id, email=u.email)

@router.post("/logout")
def logout(response: Response):
    _clear_session_cookie(response)
    return {"ok": True}

@router.get("/me", response_model=MeResponse)
def me(request: Request, db: Session = Depends(_db)):
    token = request.cookies.get(COOKIE_NAME)
    u = _user_from_cookie(token, db)
    if not u:
        raise HTTPException(401, "Not authenticated.")
    return MeResponse(id=u.id, email=u.email)
