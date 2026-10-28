"""Document upload, repository, and ingestion endpoints."""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, UploadFile, status
from fastapi.concurrency import run_in_threadpool

from ..auth import CurrentUser
from ..config import ALLOWED_EXTENSIONS, get_settings
from ..db import get_repository
from ..schemas import (
    ChunkOut,
    DocumentList,
    DocumentOut,
    SeedResult,
    UploadResult,
)
from ..services.embedder import get_index
from ..services.ingestion import (
    delete_document,
    process_documents,
    reindex_document,
    register_file,
    seed_demo_corpus,
)
from ..utils import safe_filename

logger = logging.getLogger("helium.ingest")
router = APIRouter(tags=["Documents"])


def _validate_signature(extension: str, content: bytes) -> None:
    if extension == ".pdf" and not content.startswith(b"%PDF"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The file extension is .pdf but the content is not a valid PDF.",
        )
    if extension == ".docx" and not content.startswith(b"PK"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The file extension is .docx but the content is not a valid DOCX archive.",
        )


@router.post(
    "/ingest",
    response_model=UploadResult,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Upload and queue documents for indexing",
)
async def ingest_documents(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(..., description="PDF, DOCX, or TXT files"),
    uid: str = CurrentUser,
) -> UploadResult:
    settings = get_settings()
    if not files:
        raise HTTPException(status_code=400, detail="No files were provided.")
    if len(files) > settings.max_files_per_upload:
        raise HTTPException(
            status_code=400,
            detail=f"A maximum of {settings.max_files_per_upload} files can be uploaded at once.",
        )

    prepared: list[dict[str, Any]] = []
    total_bytes = 0
    for upload in files:
        original_name = safe_filename(upload.filename or "document.txt")
        extension = Path(original_name).suffix.lower()
        if extension not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=415,
                detail=f"{original_name}: only PDF, DOCX, and TXT files are supported.",
            )
        content = bytearray()
        digest = hashlib.sha256()
        while chunk := await upload.read(1024 * 1024):
            content.extend(chunk)
            digest.update(chunk)
            if len(content) > settings.max_upload_mb * 1024 * 1024:
                raise HTTPException(
                    status_code=413,
                    detail=f"{original_name} exceeds the {settings.max_upload_mb} MB limit.",
                )
        if not content:
            raise HTTPException(status_code=400, detail=f"{original_name} is empty.")
        _validate_signature(extension, bytes(content))
        total_bytes += len(content)
        prepared.append(
            {
                "filename": original_name,
                "extension": extension,
                "content": bytes(content),
                "sha256": digest.hexdigest(),
                "content_type": upload.content_type or "application/octet-stream",
            }
        )
        await upload.close()

    if total_bytes > settings.max_upload_mb * 1024 * 1024 * 2:
        raise HTTPException(
            status_code=413,
            detail="The batch is too large. Upload fewer files or increase the configured limit.",
        )

    repository = get_repository(uid)
    created: list[dict[str, Any]] = []
    queued: list[str] = []
    duplicate_count = 0
    for item in prepared:
        existing = repository.find_document_by_hash(item["sha256"], uid=uid)
        if existing:
            created.append(existing)
            duplicate_count += 1
            continue
        document = register_file(
            uid=uid,
            filename=item["filename"],
            content=item["content"],
            content_type=item["content_type"],
            extension=item["extension"],
            sha256=item["sha256"],
            repository=repository,
        )
        created.append(document)
        queued.append(document["id"])

    if queued:
        background_tasks.add_task(process_documents, queued, uid=uid)

    if queued and duplicate_count:
        message = (
            f"Queued {len(queued)} new document(s). {duplicate_count} duplicate(s) were skipped."
        )
    elif queued:
        message = f"Queued {len(queued)} document(s) for background indexing."
    else:
        message = "All uploaded documents are already indexed."
    return UploadResult(
        documents=[DocumentOut(**document) for document in created],
        duplicate=not queued,
        message=message,
    )


@router.get("/documents", response_model=DocumentList, summary="List repository documents")
async def list_documents(
    limit: int = Query(default=200, ge=1, le=1000), uid: str = CurrentUser
) -> DocumentList:
    repository = get_repository(uid)
    docs = repository.list_documents(limit=limit, uid=uid)
    return DocumentList(
        documents=[DocumentOut(**doc) for doc in docs],
        stats=repository.stats(),
    )


@router.delete("/documents/{document_id}", summary="Delete a document and rebuild the index")
async def remove_document(document_id: str, uid: str = CurrentUser) -> dict[str, Any]:
    deleted = await run_in_threadpool(delete_document, document_id, uid=uid)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found.")
    return {"deleted": True, "document_id": document_id}


@router.post(
    "/documents/{document_id}/reindex",
    response_model=DocumentOut,
    summary="Re-run parsing and indexing for a document",
)
async def reindex(document_id: str, uid: str = CurrentUser) -> DocumentOut:
    document = get_repository(uid).get_document(document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found.")
    await run_in_threadpool(reindex_document, document_id, uid=uid)
    updated = get_repository(uid).get_document(document_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Document not found.")
    return DocumentOut(**updated)


@router.get(
    "/documents/{document_id}/chunks",
    response_model=list[ChunkOut],
    summary="Inspect the generated chunks for a document",
)
async def document_chunks(document_id: str, uid: str = CurrentUser) -> list[ChunkOut]:
    repository = get_repository(uid)
    document = repository.get_document(document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found.")
    chunks = repository.list_chunks(document_id)
    return [ChunkOut(**chunk) for chunk in chunks]


@router.get("/chunks/{chunk_id}", summary="Fetch a full source chunk for citation review")
async def get_chunk(chunk_id: str, uid: str = CurrentUser) -> dict[str, Any]:
    repository = get_repository(uid)
    chunk = repository.get_chunk(chunk_id)
    if not chunk:
        raise HTTPException(status_code=404, detail="Source chunk not found.")
    return chunk


@router.post(
    "/demo/seed",
    response_model=SeedResult,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Load the demonstration policy corpus",
)
async def seed_demo(background_tasks: BackgroundTasks, uid: str = CurrentUser) -> SeedResult:
    documents, queued = await run_in_threadpool(seed_demo_corpus)
    if queued:
        background_tasks.add_task(process_documents, queued, uid=uid)
        message = f"Queued {len(queued)} demonstration policy documents for indexing."
    else:
        message = "The demonstration corpus is already loaded."
    return SeedResult(
        documents=[DocumentOut(**document) for document in documents],
        message=message,
    )


@router.get("/index/status", summary="Inspect vector index health")
async def index_status() -> dict[str, Any]:
    return get_index().status()
