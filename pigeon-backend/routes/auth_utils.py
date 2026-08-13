"""Authentication utility functions"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import os
import uuid
from dotenv import load_dotenv
from jose import jwt
from passlib.context import CryptContext

ROOT_DIR = Path(__file__).parent.parent
load_dotenv(ROOT_DIR / '.env')

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# JWT configuration (shared for users and admin)
JWT_SECRET = os.getenv("JWT_SECRET", "your-secret-key-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24 * 7  # 7 days

def normalize_email(email: str) -> str:
    """Normalize email for case-insensitive lookups and storage."""
    if not email or not isinstance(email, str):
        return (email or "").strip()
    return email.strip().lower()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash"""
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    """Hash a password"""
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None, jti: Optional[str] = None) -> str:
    """Create a JWT access token for regular users. If jti is provided (or generated), the token is tied to a session."""
    to_encode = data.copy()
    if jti is None:
        jti = str(uuid.uuid4())
    to_encode["jti"] = jti
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return encoded_jwt


def create_impersonation_token(user_id: str, expires_delta: Optional[timedelta] = None) -> str:
    """Create a short-lived JWT for admin impersonation. Valid for 1 hour by default. Only accepted by /auth/impersonate."""
    delta = expires_delta or timedelta(hours=1)
    return create_access_token(
        data={"sub": user_id, "type": "impersonation"},
        expires_delta=delta,
    )


def create_admin_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token for admin users."""
    to_encode = data.copy()
    # Mark this token as an admin token so we can distinguish it
    to_encode.setdefault("type", "admin")
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return encoded_jwt
