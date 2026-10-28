"""FastAPI authentication dependency for Helium.

When Firebase is configured, every data endpoint requires a valid Firebase ID
token in the ``Authorization: Bearer <token>`` header. The decoded ``uid``
scopes all data access. When Firebase is not configured (local dev without
credentials) a shared ``"local"`` user is used so the app keeps working.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status

from .services.firebase import firebase_enabled, get_uid_from_request


async def current_user_uid(request: Request) -> str:
    if not firebase_enabled():
        return "local"
    uid = get_uid_from_request(request)
    if not uid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in with Google to access your workspace.",
        )
    return uid


CurrentUser = Depends(current_user_uid)
