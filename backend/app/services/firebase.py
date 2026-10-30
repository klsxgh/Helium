"""Firebase / Google Cloud integration for Helium.

Two jobs, both done with the lightweight ``google-cloud-firestore`` and
``google-auth`` packages instead of the much heavier ``firebase-admin`` SDK:

1. Provide a Firestore client authenticated with the Firebase service account
   (``FIREBASE_SERVICE_ACCOUNT_JSON`` or ``FIREBASE_SERVICE_ACCOUNT_PATH``).
2. Verify Firebase ID tokens so each request can be scoped to one user.

If the packages or credentials are missing the helpers degrade gracefully and
Helium falls back to local SQLite storage.
"""

from __future__ import annotations

import json
import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger("helium.firebase")

# Cache for a successfully created Firestore client. Failures are never cached
# so transient init errors can be retried on the next call.
_firestore_client_cache: dict[str, Any] = {}


def _service_account_info() -> dict[str, Any] | None:
    raw = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
    if raw:
        try:
            info = json.loads(raw)
            if isinstance(info, dict):
                return info
        except json.JSONDecodeError as exc:
            logger.error("Invalid FIREBASE_SERVICE_ACCOUNT_JSON: %s", exc)
            return None
    path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH")
    if path and Path(path).exists():
        try:
            info = json.loads(Path(path).read_text(encoding="utf-8"))
            if isinstance(info, dict):
                return info
        except Exception as exc:  # noqa: BLE001 - surface as a warning only
            logger.error("Could not read service account file %s: %s", path, exc)
    return None


def project_id() -> str | None:
    info = _service_account_info()
    if info and info.get("project_id"):
        return str(info["project_id"])
    return os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("GCLOUD_PROJECT")


def get_firestore_client() -> Any | None:
    """Return a Firestore client, or None when Firebase is not configured.

    Transient init failures are NOT cached, so a later call can retry.
    """
    # Fast path: reuse a successfully created client.
    cached = _firestore_client_cache.get("client")
    if cached is not None:
        return cached
    try:
        from google.cloud import firestore  # type: ignore
    except ImportError:
        logger.warning("google-cloud-firestore is not installed; Firebase storage disabled.")
        return None

    info = _service_account_info()
    try:
        if info:
            client = firestore.Client.from_service_account_info(info)
        else:
            client = firestore.Client()
    except Exception as exc:  # noqa: BLE001 - treat any init failure as "disabled"
        logger.error("Firestore client initialisation failed: %s", exc)
        return None
    _firestore_client_cache["client"] = client
    return client


def firebase_enabled() -> bool:
    return get_firestore_client() is not None and project_id() is not None


def verify_id_token(token: str) -> dict[str, Any] | None:
    """Verify a Firebase ID token and return its claims, or None."""
    audience = project_id()
    if not audience:
        return None
    try:
        from google.auth.transport import requests as google_requests  # type: ignore
        from google.oauth2 import id_token  # type: ignore

        claims = id_token.verify_firebase_token(
            token, google_requests.Request(), audience=audience
        )
        return claims
    except Exception as exc:  # noqa: BLE001 - invalid tokens are expected
        logger.debug("ID token verification failed: %s", exc)
        return None


def storage_bucket_name() -> str | None:
    return os.getenv("FIREBASE_STORAGE_BUCKET") or None


def _storage_client() -> Any | None:
    try:
        from google.cloud import storage  # type: ignore
    except ImportError:
        logger.warning("google-cloud-storage is not installed; durable file storage disabled.")
        return None
    info = _service_account_info()
    try:
        if info:
            return storage.Client.from_service_account_info(info)
        return storage.Client()
    except Exception as exc:  # noqa: BLE001
        logger.error("Cloud Storage client initialisation failed: %s", exc)
        return None


def upload_file_bytes(
    uid: str, document_id: str, extension: str, content: bytes, content_type: str | None = None
) -> str | None:
    """Upload raw file bytes to Firebase Storage. Returns the blob path or None."""
    bucket_name = storage_bucket_name()
    if not bucket_name:
        return None
    client = _storage_client()
    if client is None:
        return None
    blob_path = f"users/{uid}/documents/{document_id}{extension}"
    try:
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_path)
        blob.upload_from_string(content, content_type=content_type or "application/octet-stream")
        return blob_path
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to upload %s to Storage: %s", blob_path, exc)
        return None


def download_file_bytes(blob_path: str) -> bytes | None:
    """Download raw file bytes from Firebase Storage. Returns None on failure."""
    bucket_name = storage_bucket_name()
    if not bucket_name or not blob_path:
        return None
    client = _storage_client()
    if client is None:
        return None
    try:
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_path)
        return blob.download_as_bytes()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to download %s from Storage: %s", blob_path, exc)
        return None


def delete_file_bytes(blob_path: str) -> None:
    """Delete a blob from Firebase Storage (best-effort)."""
    bucket_name = storage_bucket_name()
    if not bucket_name or not blob_path:
        return
    client = _storage_client()
    if client is None:
        return
    try:
        bucket = client.bucket(bucket_name)
        bucket.blob(blob_path).delete()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to delete %s from Storage: %s", blob_path, exc)


def get_uid_from_request(request: Any) -> str | None:
    """Extract and verify the Bearer token from a FastAPI Request."""
    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        return None
    token = auth_header.split(" ", 1)[1].strip()
    if not token:
        return None
    claims = verify_id_token(token)
    if not claims:
        return None
    return claims.get("uid") or claims.get("user_id") or claims.get("sub")
