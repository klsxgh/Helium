"""Reviewer conflict-resolution endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from ..db import get_repository
from ..schemas import RelationshipOut, ResolveConflictRequest
from ..services.generator import RELATIONSHIP_LABEL
from ..services.embedder import get_index
from ..config import get_settings

router = APIRouter(tags=["Reviewer"])


def _sort_key(claim: dict[str, Any]) -> tuple[str, str, int]:
    return (
        str(claim.get("doc_date") or ""),
        str(claim.get("uploaded_at") or ""),
        int(claim.get("version") or 1),
    )


def _newest_claim(conflict: dict[str, Any]) -> dict[str, Any]:
    a = conflict["claim_a"]
    b = conflict["claim_b"]
    return b if _sort_key(b) > _sort_key(a) else a


def _oldest_claim(conflict: dict[str, Any]) -> dict[str, Any]:
    a = conflict["claim_a"]
    b = conflict["claim_b"]
    return a if _sort_key(a) <= _sort_key(b) else b


@router.get(
    "/admin/conflicts",
    response_model=list[RelationshipOut],
    summary="List conflicts and relationship records for review",
)
async def list_conflicts(
    status: str = Query(default="all", pattern="^(all|open|flagged|resolved)$"),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[RelationshipOut]:
    rows = get_repository().list_conflicts(status=status, limit=limit)
    return [RelationshipOut(**row) for row in rows]


@router.get(
    "/admin/conflicts/{conflict_id}",
    response_model=RelationshipOut,
    summary="Inspect a single conflict with claim snapshots",
)
async def get_conflict(conflict_id: str) -> RelationshipOut:
    row = get_repository().get_conflict(conflict_id)
    if not row:
        raise HTTPException(status_code=404, detail="Conflict not found.")
    return RelationshipOut(**row)


@router.post(
    "/admin/conflicts/{conflict_id}/resolve",
    response_model=RelationshipOut,
    summary="Resolve, flag, or reopen a conflict",
)
async def resolve_conflict(
    conflict_id: str, request: ResolveConflictRequest
) -> RelationshipOut:
    repository = get_repository()
    conflict = repository.get_conflict(conflict_id)
    if not conflict:
        raise HTTPException(status_code=404, detail="Conflict not found.")

    active_claim_id: str | None = None
    automatic_note = None
    if request.action == "accept_newest":
        active_claim_id = _newest_claim(conflict)["claim_id"]
        automatic_note = "Enforced the newest source revision."
    elif request.action == "keep_current":
        active_claim_id = _oldest_claim(conflict)["claim_id"]
        automatic_note = "Retained the older/current source."
    elif request.action == "flag_review":
        automatic_note = "Escalated to the policy owner for amendment."

    note = request.note or automatic_note
    try:
        updated = repository.resolve_conflict(
            conflict_id=conflict_id,
            action=request.action,
            reviewer=request.reviewer,
            note=note,
            active_claim_id=active_claim_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Conflict not found.")
    return RelationshipOut(**updated)


@router.get("/admin/stats", summary="Repository and review dashboard counters")
async def admin_stats() -> dict[str, Any]:
    repository = get_repository()
    stats = repository.stats()
    stats["relationship_labels"] = RELATIONSHIP_LABEL
    return stats


@router.post("/admin/reset", summary="Delete all documents, reports, and conflicts")
async def reset_workspace() -> dict[str, Any]:
    repository = get_repository()
    repository.reset_all()
    get_index().rebuild()
    settings = get_settings()
    upload_dir = settings.upload_dir
    if upload_dir.exists():
        for path in upload_dir.iterdir():
            if path.is_file() or path.is_symlink():
                try:
                    path.unlink()
                except OSError:
                    pass
            elif path.is_dir():
                import shutil

                shutil.rmtree(path, ignore_errors=True)
    return {"reset": True}
