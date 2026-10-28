"""Cross-document contradiction scanning endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..auth import CurrentUser
from ..schemas import ScanRequest, ScanResult
from ..services.scan import get_scan_result, scan_documents

router = APIRouter(tags=["Scan"])


@router.post(
    "/scan",
    response_model=ScanResult,
    summary="Compare the selected documents and list contradictions between them",
)
async def create_scan(request: ScanRequest, uid: str = CurrentUser) -> ScanResult:
    try:
        result = scan_documents(request.document_ids, uid=uid)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ScanResult(**result)


@router.get(
    "/scan/{scan_id}",
    response_model=ScanResult,
    summary="Reopen a saved cross-document scan",
)
async def read_scan(scan_id: str, uid: str = CurrentUser) -> ScanResult:
    result = get_scan_result(scan_id, uid=uid)
    if not result:
        raise HTTPException(status_code=404, detail="Scan not found.")
    return ScanResult(**result)
