# app/infra/users.py
from typing import Optional
from datetime import datetime, timezone
from uuid import uuid4
from sqlmodel import SQLModel, Field, Session, select
from app.infra.meta import engine

class User(SQLModel, table=True):
    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    created_at: int = Field(default_factory=lambda: int(datetime.now(timezone.utc).timestamp()))

# Ensure table exists
SQLModel.metadata.create_all(engine)

def get_user_by_email(db: Session, email: str) -> Optional[User]:
    return db.exec(select(User).where(User.email == email)).first()

def get_user_by_id(db: Session, uid: str) -> Optional[User]:
    return db.get(User, uid)

def create_user(db: Session, email: str, password_hash: str) -> User:
    u = User(email=email, password_hash=password_hash)
    db.add(u); db.commit(); db.refresh(u)
    return u
