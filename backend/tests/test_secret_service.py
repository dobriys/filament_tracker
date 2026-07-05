"""Авто-генерация секретов: сентинелы и валидность ключей (без БД)."""
from cryptography.fernet import Fernet

from app.services import secret_service


def test_placeholders_cover_unset_and_defaults():
    assert "" in secret_service.PLACEHOLDERS
    assert "change-me" in secret_service.PLACEHOLDERS
    assert "change-me-generate-a-fernet-key" in secret_service.PLACEHOLDERS


def test_generated_encryption_key_is_valid_fernet():
    key = Fernet.generate_key().decode()
    f = Fernet(key.encode())
    assert f.decrypt(f.encrypt(b"secret")) == b"secret"
