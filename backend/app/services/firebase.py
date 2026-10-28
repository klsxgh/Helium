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


@lru_cache(maxsize=1)
def get_firestore_client() -> Any | None:
    """Return a Firestore client, or None when Firebase is not configured."""
    try:
        from google.cloud import firestore  # type: ignore
    except ImportError:
        logger.warning("google-cloud-firestore is not installed; Firebase storage disabled.")
        return None

    info = _service_account_info()
    try:
        if info:
            return firestore.Client.from_service_account_info(info)
        return firestore.Client()
    except Exception as exc:  # noqa: BLE001 - treat any init failure as "disabled"
        logger.error("Firestore client initialisation failed: %s", exc)
        return None


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
