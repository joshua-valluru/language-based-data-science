# app/infra/auth.py
import os, bcrypt, jwt
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")  # set in prod
ALGO = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def create_access_token(sub: str, extra: Optional[Dict[str, Any]] = None,
                        expires_minutes: Optional[int] = None) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=expires_minutes or ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": sub, "exp": exp}
    if extra:
        payload.update(extra)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGO)

def decode_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGO])
    except jwt.PyJWTError:
        return None
