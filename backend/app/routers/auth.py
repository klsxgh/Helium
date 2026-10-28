"""Authentication router for Helium.

Provides endpoints for authentication configuration and token validation.
Helium uses Firebase Authentication on the frontend, and the backend
verifies Firebase ID tokens using the Firebase service account.
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from ..services.firebase import firebase_enabled, get_uid_from_request, verify_id_token

router = APIRouter(tags=["Authentication"])


class TokenValidationRequest(BaseModel):
    """Request to validate a Firebase ID token."""
    token: str


class TokenValidationResponse(BaseModel):
    """Response from token validation."""
    valid: bool
    uid: str | None = None
    email: str | None = None
    error: str | None = None


@router.post("/auth/validate-token")
async def validate_firebase_token(request: TokenValidationRequest) -> TokenValidationResponse:
    """Validate a Firebase ID token.
    
    This endpoint can be used by the frontend to validate tokens
    or by external services to verify authentication.
    """
    if not firebase_enabled():
        return TokenValidationResponse(
            valid=False,
            error="Firebase is not configured on the backend."
        )
    
    claims = verify_id_token(request.token)
    if not claims:
        return TokenValidationResponse(
            valid=False,
            error="Invalid or expired token."
        )
    
    return TokenValidationResponse(
        valid=True,
        uid=claims.get("uid") or claims.get("user_id") or claims.get("sub"),
        email=claims.get("email"),
    )


@router.get("/auth/me")
async def get_current_user(request: Request) -> dict[str, Any]:
    """Get current user information from Firebase token in Authorization header."""
    uid = get_uid_from_request(request)
    if not uid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated. Please sign in with Google.",
        )
    
    return {
        "uid": uid,
        "authenticated": True,
        "provider": "firebase",
    }


@router.get("/auth/config")
async def get_auth_config() -> dict[str, Any]:
    """Get authentication configuration for frontend."""
    return {
        "firebase_enabled": firebase_enabled(),
        "requires_auth": firebase_enabled(),  # If Firebase is enabled, auth is required
        "auth_type": "firebase",
        "message": "Sign in with Google to access your private workspace." if firebase_enabled() else "Authentication is not configured. Using local development mode.",
    }


@router.get("/auth/health")
async def auth_health() -> dict[str, Any]:
    """Check authentication system health."""
    return {
        "status": "healthy" if firebase_enabled() else "disabled",
        "firebase_configured": firebase_enabled(),
        "service_account_loaded": os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH") is not None,
    }