"""Shared encryption for sensitive values (e.g. user Google OAuth client secret)."""
import os
from cryptography.fernet import Fernet


def _get_fernet():
    key = os.getenv("ENCRYPTION_KEY")
    if not key:
        raise ValueError(
            "ENCRYPTION_KEY is required. Generate with: "
            'python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
        )
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_value(plain: str) -> str:
    """Encrypt a string value for storage."""
    return _get_fernet().encrypt(plain.encode()).decode()


def decrypt_value(encrypted: str) -> str:
    """Decrypt a stored value."""
    return _get_fernet().decrypt(encrypted.encode()).decode()
